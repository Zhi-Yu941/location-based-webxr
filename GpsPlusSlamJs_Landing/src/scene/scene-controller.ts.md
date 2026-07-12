# `scene/scene-controller.ts` — renderer + tick-loop glue

## Purpose

The stateful glue between scroll input, the anime.js story timeline and
the WebGL renderer: owns the `Scene`/camera/lights, applies quality tier
and theme, eases scroll input toward the timeline, drives the intro, and
renders on demand.

## Public API

- `createSceneController(options) → SceneController | null`
  - `options`: `container` (canvas parent + measurements), `tier`
    (`QualityTier`), `initialTheme`, `createRenderer?` (test seam,
    defaults to a real `WebGLRenderer`), `requestFrame?` (rAF seam).
  - **Returns `null` when renderer creation throws** — the caller falls
    back to the static DOM floor (`body.no-webgl`).
- `SceneController`: `stage`, `setTargetProgress(0..1)`,
  `showChapterEndState(chapterIndex)` (reduced-motion),
  `applyTheme(theme)`, `playIntro()` / `skipIntro()`,
  `handleResize(w, h)`, `tick(nowMs)`, `start()`.
- `RendererLike`, `SceneControllerOptions` types (the container shape is
  structural/module-private).

## Invariants & assumptions

- **Render on demand:** a frame renders only when something changed
  (scrub, intro, theme, resize). Idle ticks render nothing (test-pinned) —
  battery matters on the phones this page targets.
- **One driver:** `tick(nowMs)` advances everything by seeking; the anime
  engine's own loop is never used. `start()` merely wraps `tick` in rAF.
- **Smoothing:** scroll sets a target; displayed progress converges
  exponentially (τ = 120 ms) with an epsilon snap, so wheel steps glide
  instead of jump-cutting.
- Intro playback wins over scrubbing while active; `skipIntro()` seeks it
  to the end (used on the first scroll during the intro).
- `applyTheme` swaps palette colors, background, fog and light settings in
  place — no scene rebuild.
- Tier application: `setPixelRatio(tier.dprCap)`, `shadowMap.enabled`,
  world geometry detail (`buildClayWorld(tier.geometryDetail)`).
- Sizes are clamped to ≥ 1px; non-finite progress inputs are ignored.

## Examples

```ts
const scene = createSceneController({
  container: document.getElementById("scene-root")!,
  tier,
  initialTheme: "dark",
});
if (!scene) document.body.classList.add("no-webgl");
scene?.start();
window.addEventListener("scroll", () =>
  scene?.setTargetProgress(overallProgress),
);
```

## Tests

`scene-controller.test.ts` — null on renderer failure, render-on-demand
(no idle re-render), smoothing convergence, reduced-motion end-state seek,
theme swap re-render, intro play/skip landing on the hero framing, DPR/
shadow tier application, resize.
