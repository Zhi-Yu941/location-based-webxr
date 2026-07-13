/**
 * Landing-page bootstrap. Wires the DOM chapters to the 3D scroll story.
 *
 * Boot order matters: theme first (so the first rendered frame uses the
 * right palette), then capability detection (decides quality tier and
 * whether scroll-driven animation runs at all), then the 3D scene. Every
 * step degrades gracefully — the DOM copy must stand alone when WebGL or
 * motion is unavailable (see the plan doc's "Fallbacks" decision).
 */
import {
  applyCtaDeviceClaim,
  detectImmersiveArSupport,
  type XrSystemLike,
} from "./ar-support";
import { CHAPTERS, sectionElementId } from "./chapters";
import { heroVeilOpacity } from "./hero-veil";
import { computeScrollState, type SectionMetrics } from "./scroll-story";
import { createThemeController, type Theme } from "./theme";
import { decideQualityTier } from "./capability";
import {
  createSceneController,
  type SceneController,
} from "./scene/scene-controller";

function probeWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function collectSections(): HTMLElement[] {
  const sections: HTMLElement[] = [];
  for (const chapter of CHAPTERS) {
    const el = document.getElementById(sectionElementId(chapter.id));
    if (el) {
      sections.push(el);
    } else {
      // A missing section desynchronizes scroll mapping and story timeline;
      // fail loudly in the console but keep the rest of the page working.
      console.warn(
        `landing: missing chapter section #${sectionElementId(chapter.id)}`,
      );
    }
  }
  return sections;
}

/**
 * Section metrics in SCROLLER coordinates. `<main id="story">` is the
 * page's one and only scroller (the document never scrolls — that keeps
 * the mobile URL bar stationary and the scroll→progress mapping free of
 * URL-bar viewport-resize remaps).
 */
function measureSections(
  scroller: HTMLElement,
  sections: readonly HTMLElement[],
): SectionMetrics[] {
  const scrollerTop = scroller.getBoundingClientRect().top;
  return sections.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top - scrollerTop + scroller.scrollTop,
      height: rect.height,
    };
  });
}

/**
 * Hero extras: the veil that hides the 3D world at the top (round-2 R4)
 * and the "jump to demos" fast smooth scroll (R17b). Returns the per-
 * scroll updater for the veil opacity.
 */
function wireHeroExtras(scroller: HTMLElement): () => void {
  const veil = document.getElementById("hero-veil");
  document.getElementById("jump-demos")?.addEventListener("click", (event) => {
    event.preventDefault();
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  });
  return () => {
    if (veil) {
      // Keyed off the raw scroll offset (in viewport heights), NOT story
      // progress — the veil must be fully opaque exactly at the top.
      veil.style.opacity = String(
        heroVeilOpacity(
          scroller.scrollTop / Math.max(1, scroller.clientHeight),
        ),
      );
    }
  };
}

function markActiveChapter(
  sections: readonly HTMLElement[],
  activeIndex: number,
): void {
  sections.forEach((el, index) => {
    el.classList.toggle("active", index === activeIndex);
  });
}

function boot(): void {
  // Fire-and-forget (round-8 Z6): upgrade the CTA's device claim on
  // immersive-ar-capable devices; everyone else keeps the honest static
  // default already in the HTML.
  void detectImmersiveArSupport((navigator as { xr?: XrSystemLike }).xr).then(
    (supported) => applyCtaDeviceClaim(document, supported),
  );

  const scroller = document.getElementById("story");
  if (!scroller) {
    console.warn("landing: missing #story scroller; page stays static");
    document.body.classList.add("no-webgl");
    return;
  }
  const sections = collectSections();
  let metrics = measureSections(scroller, sections);

  const tier = decideQualityTier({
    webglSupported: probeWebgl(),
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    deviceMemoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
  });

  let scene: SceneController | null = null;
  const sceneRoot = document.getElementById("scene-root");
  if (tier.mode !== "static-dom" && sceneRoot) {
    scene = createSceneController({
      container: sceneRoot,
      tier,
      // The FOUC guard already stamped the resolved theme on <html>; the
      // theme controller below re-applies it right after construction.
      initialTheme:
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      onContextLost: () => {
        // GPU gave up mid-visit: degrade to the static DOM floor rather
        // than freezing the story on a dead canvas.
        document.body.classList.add("no-webgl");
      },
      onContextRestored: () => {
        document.body.classList.remove("no-webgl");
      },
    });
  }
  if (!scene) {
    document.body.classList.add("no-webgl");
  }

  const toggleButton = document.getElementById("theme-toggle");
  const applyTheme = (theme: Theme): void => {
    document.documentElement.dataset.theme = theme;
    scene?.applyTheme(theme);
    toggleButton?.setAttribute(
      "aria-label",
      `Color palette: ${theme} — click to switch`,
    );
  };
  const themeController = createThemeController({
    storage: safeLocalStorage(),
    prefersLight: () =>
      window.matchMedia("(prefers-color-scheme: light)").matches,
    applyTheme,
  });
  toggleButton?.addEventListener("click", () => themeController.cycle());

  const updateHeroExtras = wireHeroExtras(scroller);
  let lastChapterIndex = -1;
  const onScrollChanged = (): void => {
    const state = computeScrollState(
      scroller.scrollTop,
      scroller.clientHeight,
      metrics,
    );
    updateHeroExtras();
    if (state.chapterIndex !== lastChapterIndex) {
      lastChapterIndex = state.chapterIndex;
      markActiveChapter(sections, state.chapterIndex);
      if (tier.mode === "reduced-motion") {
        // Static compositions instead of scroll scrubbing.
        scene?.showChapterEndState(state.chapterIndex);
      }
    }
    if (tier.mode === "scroll") {
      scene?.setTargetProgress(state.overallProgress);
    }
  };

  let introRunning = false;
  if (scene && tier.mode === "scroll") {
    if (scroller.scrollTop < 40) {
      scene.playIntro();
      introRunning = true;
    }
    scene.start();
  } else if (scene) {
    scene.start();
  }

  scroller.addEventListener(
    "scroll",
    () => {
      if (introRunning && scroller.scrollTop > 40) {
        scene?.skipIntro();
        introRunning = false;
      }
      onScrollChanged();
    },
    { passive: true },
  );
  // Debounced: a collapsing/expanding mobile browser bar fires a resize
  // burst mid-gesture; re-measuring sections during it would remap scroll
  // progress under the user's finger (round-2 R2). One settle-time pass
  // is enough — the canvas itself is 100lvh-sized and needs no mid-burst
  // resize either.
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      metrics = measureSections(scroller, sections);
      if (sceneRoot) {
        scene?.handleResize(sceneRoot.clientWidth, sceneRoot.clientHeight);
      }
      onScrollChanged();
    }, 150);
  });

  onScrollChanged();
}

boot();
