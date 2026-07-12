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

  it("renders once for the initial frame, then only when something changed", () => {
    const { controller, renderer } = makeController();
    expect(controller).not.toBeNull();
    controller?.tick(16);
    const initialRenders = renderer.renders;
    expect(initialRenders).toBeGreaterThan(0);
    // Nothing changed: further ticks must not re-render (battery).
    controller?.tick(32);
    controller?.tick(48);
    expect(renderer.renders).toBe(initialRenders);
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
    for (let t = 200; t <= 4000; t += 100) {
      controller?.tick(t);
    }
    // Intro over: back exactly on the hero framing, ready for scroll.
    expect(camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
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
