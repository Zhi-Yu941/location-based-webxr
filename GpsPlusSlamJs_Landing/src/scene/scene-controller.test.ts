import { describe, expect, it, vi } from "vitest";
import type { Color, PerspectiveCamera, Scene } from "three";
import type { QualityTier } from "../capability";
import { createSceneController, type RendererLike } from "./scene-controller";

// Why this test matters: the controller is the only stateful glue between
// scroll input, the anime.js timeline, and the WebGL renderer. Its
// contracts — render-on-demand (no busy re-render), smoothing that
// converges, reduced-motion end-state seeks, theme application, and a null
// return when WebGL fails (the static-dom floor) — are all invisible in
// unit tests of the parts, so they are pinned here against a fake renderer.

const TIER: QualityTier = {
  mode: "scroll",
  dprCap: 2,
  shadows: true,
  geometryDetail: "low",
};

function makeFakeRenderer() {
  const renderer: RendererLike & { renders: number } = {
    renders: 0,
    shadowMap: { enabled: false },
    domElement: {} as HTMLCanvasElement,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(function (this: void) {
      renderer.renders++;
    }),
    dispose: vi.fn(),
  };
  return renderer;
}

function makeController(tier: QualityTier = TIER) {
  const renderer = makeFakeRenderer();
  const appended: unknown[] = [];
  const controller = createSceneController({
    container: {
      clientWidth: 1200,
      clientHeight: 800,
      appendChild: (el: unknown) => {
        appended.push(el);
      },
    },
    tier,
    initialTheme: "dark",
    createRenderer: () => renderer,
  });
  return { controller, renderer, appended };
}

describe("createSceneController", () => {
  it("reports a lost WebGL context so the caller can engage the static floor", () => {
    // Mobile GPUs (and CI under pressure) genuinely lose contexts; the
    // page must degrade to the DOM floor instead of freezing mid-story.
    const listeners = new Map<string, (event: unknown) => void>();
    const renderer = {
      ...makeFakeRenderer(),
      domElement: {
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          listeners.set(type, handler);
        },
      } as unknown as HTMLCanvasElement,
    };
    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const controller = createSceneController({
      container: { clientWidth: 800, clientHeight: 600, appendChild: () => {} },
      tier: TIER,
      initialTheme: "dark",
      createRenderer: () => renderer,
      onContextLost,
      onContextRestored,
    });
    expect(controller).not.toBeNull();
    listeners.get("webglcontextlost")?.({ preventDefault: () => {} });
    expect(onContextLost).toHaveBeenCalledOnce();
    // The browser may restore the context (preventDefault allows it, and
    // three.js re-uploads its resources) — the floor lifts again.
    listeners.get("webglcontextrestored")?.({});
    expect(onContextRestored).toHaveBeenCalledOnce();
  });

  it("returns null when renderer creation throws (static-dom floor)", () => {
    const controller = createSceneController({
      container: { clientWidth: 800, clientHeight: 600, appendChild: () => {} },
      tier: TIER,
      initialTheme: "dark",
      createRenderer: () => {
        throw new Error("no WebGL");
      },
    });
    expect(controller).toBeNull();
  });

  it("renders on demand only once away from the hero (battery)", () => {
    // The hero has an ambient drift (below), so render-on-demand is
    // asserted at a mid-story progress where the scene is truly idle.
    const { controller, renderer } = makeController();
    expect(controller).not.toBeNull();
    controller?.setTargetProgress(0.5);
    for (let i = 1; i <= 400; i++) {
      controller?.tick(i * 16);
    }
    const settledRenders = renderer.renders;
    expect(settledRenders).toBeGreaterThan(0);
    // Converged and away from the hero: further ticks must not re-render.
    controller?.tick(401 * 16);
    controller?.tick(402 * 16);
    expect(renderer.renders).toBe(settledRenders);
  });

  it("drifts the camera gently at the hero while idle (background life)", () => {
    // Round-1 feedback: a frozen hero reads as buggy — something should
    // move in the background until the visitor scrolls.
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const posA = camera.position.clone();
    for (let t = 100; t <= 4000; t += 100) {
      controller?.tick(t);
    }
    const drift = camera.position.distanceTo(posA);
    expect(drift).toBeGreaterThan(0.01);
    expect(drift).toBeLessThan(3); // gentle sway, not a fly-away
  });

  it("suppresses the ambient drift under reduced motion", () => {
    const { controller } = makeController({ ...TIER, mode: "reduced-motion" });
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const posA = camera.position.clone();
    for (let t = 100; t <= 4000; t += 100) {
      controller?.tick(t);
    }
    expect(camera.position.distanceTo(posA)).toBeLessThan(1e-6);
  });

  it("scroll progress smoothing converges on the target and moves the camera", () => {
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(16);
    const heroPos = camera.position.clone();

    controller?.setTargetProgress(0.99);
    for (let i = 1; i <= 200; i++) {
      controller?.tick(16 + i * 16);
    }
    // Converged near the CTA framing — far from the hero framing.
    expect(camera.position.distanceTo(heroPos)).toBeGreaterThan(5);
  });

  it("showChapterEndState seeks a chapter's end composition in one call", () => {
    const { controller, renderer } = makeController({
      ...TIER,
      mode: "reduced-motion",
    });
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(16);
    const before = camera.position.clone();
    controller?.showChapterEndState(4); // anywhere: high pull-back framing
    controller?.tick(32);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(10);
    expect(renderer.renders).toBeGreaterThan(1);
  });

  it("applyTheme swaps the scene background and triggers a re-render", () => {
    const { controller, renderer } = makeController();
    controller?.tick(16);
    const scene = controller?.stage.camera.parent as Scene;
    const darkBackground = (scene.background as Color).getHex();
    const rendersBefore = renderer.renders;

    controller?.applyTheme("light");
    controller?.tick(32);
    expect((scene.background as Color).getHex()).not.toBe(darkBackground);
    expect(renderer.renders).toBeGreaterThan(rendersBefore);
  });

  it("plays the intro to completion via ticks and lands on the hero framing", () => {
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const heroPos = camera.position.clone();

    controller?.playIntro();
    controller?.tick(100); // intro started: camera pulled far away
    expect(camera.position.distanceTo(heroPos)).toBeGreaterThan(5);
    for (let t = 200; t <= 2300; t += 100) {
      controller?.tick(t);
    }
    // Intro over: on the hero framing (the ambient drift ramps in from
    // zero, so right after completion the offset is still ~0 — seamless).
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
    // Later the gentle sway plays, but stays bounded around the framing.
    for (let t = 2400; t <= 6000; t += 100) {
      controller?.tick(t);
    }
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(2);
  });

  it("skipIntro jumps straight to the hero framing (first scroll during intro)", () => {
    const { controller } = makeController();
    const camera = controller?.stage.camera as PerspectiveCamera;
    controller?.tick(0);
    const heroPos = camera.position.clone();
    controller?.playIntro();
    controller?.tick(100);
    controller?.skipIntro();
    controller?.tick(116);
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
  });

  it("applies the tier's DPR cap and shadow setting to the renderer", () => {
    const { renderer } = makeController({
      ...TIER,
      shadows: false,
      dprCap: 1.5,
    });
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it("resize updates renderer size and camera aspect", () => {
    const { controller, renderer } = makeController();
    controller?.handleResize(600, 900);
    expect(renderer.setSize).toHaveBeenLastCalledWith(600, 900, false);
    const camera = controller?.stage.camera as PerspectiveCamera;
    expect(camera.aspect).toBeCloseTo(600 / 900, 5);
  });
});
