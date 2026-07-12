import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import type { QualityTier } from "../capability";
import type { Theme } from "../theme";
import { applyPaletteToScene, getPalette } from "./palette";
import { buildClayWorld } from "./clay-world";
import { buildDotPerson } from "./dot-person";
import { buildMarkerPair } from "./markers";
import { buildPhoneFrame } from "./phone-frame";
import {
  buildIntroTimeline,
  buildStoryTimeline,
  chapterEndTime,
  createStoryStage,
  syncStage,
  type StoryStage,
} from "./story-timeline";
import type { Timeline } from "animejs";

/**
 * The stateful glue between scroll input, the anime.js story timeline and
 * the WebGL renderer. Design goals:
 *
 * - **Render on demand:** a frame renders only when something changed
 *   (scrub, intro, theme, resize) — an idle page burns no GPU.
 * - **Seek-driven animation:** both the story scrub AND the intro are
 *   driven by `tick(nowMs)` seeks, never by anime's own engine loop —
 *   one deterministic driver, trivially testable.
 * - **Smoothing:** scroll input sets a target progress; the displayed
 *   progress eases toward it exponentially, so wheel steps don't jump-cut.
 * - **Fallible construction:** renderer creation failures return `null`
 *   and the caller falls back to the static DOM floor.
 */

/** The renderer surface the controller needs (real: WebGLRenderer). */
export interface RendererLike {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
  readonly shadowMap: { enabled: boolean };
  readonly domElement: HTMLCanvasElement;
}

interface SceneContainer {
  readonly clientWidth: number;
  readonly clientHeight: number;
  appendChild(child: HTMLCanvasElement): unknown;
}

export interface SceneControllerOptions {
  readonly container: SceneContainer;
  readonly tier: QualityTier;
  readonly initialTheme: Theme;
  /** Injectable for tests; defaults to a real WebGLRenderer. */
  readonly createRenderer?: () => RendererLike;
  /** rAF seam for `start()`; defaults to window.requestAnimationFrame. */
  readonly requestFrame?: (callback: (nowMs: number) => void) => void;
}

export interface SceneController {
  readonly stage: StoryStage;
  /** Scroll mode: set the story progress target (0..1); eased in tick(). */
  setTargetProgress(progress: number): void;
  /** Reduced-motion mode: jump to a chapter's end composition. */
  showChapterEndState(chapterIndex: number): void;
  applyTheme(theme: Theme): void;
  playIntro(): void;
  skipIntro(): void;
  handleResize(width: number, height: number): void;
  /** Advance smoothing/intro and render if dirty. Called by start()'s loop. */
  tick(nowMs: number): void;
  /** Begin the rAF loop (browser only; tests call tick directly). */
  start(): void;
}

/**
 * Exponential smoothing time constant for the scroll scrub (ms).
 * Raised from 120 after round-1 feedback ("hakelig"): at 120 ms discrete
 * wheel steps were still readable as steps; 240 ms glides through them
 * while staying responsive enough that the story doesn't feel laggy.
 */
const SCRUB_TAU_MS = 240;
/** Snap threshold: below this progress delta we stop re-seeking. */
const SCRUB_EPSILON = 0.0005;

function defaultCreateRenderer(): RendererLike {
  return new WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
}

export function createSceneController(
  options: SceneControllerOptions,
): SceneController | null {
  const { container, tier, initialTheme } = options;

  let renderer: RendererLike;
  try {
    renderer = (options.createRenderer ?? defaultCreateRenderer)();
  } catch {
    // No WebGL: the caller switches to the static DOM floor.
    return null;
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 220);
  const world = buildClayWorld(tier.geometryDetail);
  const markers = buildMarkerPair();
  const stage = createStoryStage({
    world,
    person: buildDotPerson(),
    markers,
    phone: buildPhoneFrame(),
    camera,
  });
  const hemisphere = new HemisphereLight();
  const directional = new DirectionalLight();
  directional.position.set(18, 30, 14);
  directional.castShadow = tier.shadows;
  if (tier.shadows) {
    directional.shadow.mapSize.set(1024, 1024);
    const shadowCam = directional.shadow.camera;
    shadowCam.left = -30;
    shadowCam.right = 30;
    shadowCam.top = 30;
    shadowCam.bottom = -30;
  }
  scene.add(world, stage.person, markers.raw, markers.fused, camera);
  scene.add(hemisphere, directional);

  let dirty = true;
  const story: Timeline = buildStoryTimeline(stage, () => {
    dirty = true;
  });
  const intro: Timeline = buildIntroTimeline(stage, () => {
    dirty = true;
  });
  story.seek(0);
  syncStage(stage);

  function applyThemeInternal(theme: Theme): void {
    const palette = getPalette(theme);
    applyPaletteToScene(scene, palette);
    scene.background = new Color(palette.background);
    scene.fog = new Fog(palette.fog.color, palette.fog.near, palette.fog.far);
    hemisphere.color.setHex(palette.hemisphere.sky);
    hemisphere.groundColor.setHex(palette.hemisphere.ground);
    hemisphere.intensity = palette.hemisphere.intensity;
    directional.color.setHex(palette.directional.color);
    directional.intensity = palette.directional.intensity;
    dirty = true;
  }

  renderer.setPixelRatio(tier.dprCap);
  renderer.shadowMap.enabled = tier.shadows;
  renderer.setSize(
    Math.max(1, container.clientWidth),
    Math.max(1, container.clientHeight),
    false,
  );
  camera.aspect =
    Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight);
  camera.updateProjectionMatrix();
  container.appendChild(renderer.domElement);
  applyThemeInternal(initialTheme);

  let targetProgress = 0;
  let displayedProgress = 0;
  let lastTickMs: number | null = null;
  let introStartedAt: number | null = null;

  function seekStory(progress: number): void {
    displayedProgress = progress;
    story.seek(progress * story.duration);
    syncStage(stage);
    dirty = true;
  }

  function advanceIntro(nowMs: number): void {
    if (introStartedAt === null) {
      return;
    }
    const elapsed = nowMs - introStartedAt;
    intro.seek(Math.min(elapsed, intro.duration));
    syncStage(stage);
    dirty = true;
    if (elapsed >= intro.duration) {
      introStartedAt = null;
    }
  }

  function advanceScrub(dtMs: number): void {
    const delta = targetProgress - displayedProgress;
    if (Math.abs(delta) < SCRUB_EPSILON) {
      return;
    }
    const blend = 1 - Math.exp(-dtMs / SCRUB_TAU_MS);
    const next =
      Math.abs(delta) < SCRUB_EPSILON * 4
        ? targetProgress
        : displayedProgress + delta * blend;
    seekStory(next);
  }

  const controller: SceneController = {
    stage,
    setTargetProgress(progress: number) {
      if (Number.isFinite(progress)) {
        targetProgress = Math.min(1, Math.max(0, progress));
      }
    },
    showChapterEndState(chapterIndex: number) {
      const time = Math.min(
        Math.max(0, chapterEndTime(chapterIndex)),
        story.duration,
      );
      seekStory(story.duration === 0 ? 0 : time / story.duration);
    },
    applyTheme: applyThemeInternal,
    playIntro() {
      // Started on the next tick; tick() timestamps it.
      introStartedAt = Number.NaN; // sentinel: waiting for first tick
    },
    skipIntro() {
      if (introStartedAt !== null) {
        intro.seek(intro.duration);
        syncStage(stage);
        introStartedAt = null;
        dirty = true;
      }
    },
    handleResize(width: number, height: number) {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    },
    tick(nowMs: number) {
      const dt = lastTickMs === null ? 16 : Math.max(1, nowMs - lastTickMs);
      lastTickMs = nowMs;
      if (introStartedAt !== null && Number.isNaN(introStartedAt)) {
        introStartedAt = nowMs;
      }
      if (introStartedAt !== null) {
        advanceIntro(nowMs);
      } else {
        advanceScrub(dt);
      }
      if (dirty) {
        camera.lookAt(stage.lookTarget);
        renderer.render(scene, camera);
        dirty = false;
      }
    },
    start() {
      const requestFrame =
        options.requestFrame ??
        ((callback: (nowMs: number) => void) =>
          requestAnimationFrame(callback));
      const loop = (nowMs: number): void => {
        controller.tick(nowMs);
        requestFrame(loop);
      };
      requestFrame(loop);
    },
  };
  return controller;
}
