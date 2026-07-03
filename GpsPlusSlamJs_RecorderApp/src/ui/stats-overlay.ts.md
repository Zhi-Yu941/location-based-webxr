# stats-overlay.ts

## Purpose

Wraps mrdoob's Stats.js (bundled with three as `three/addons/libs/stats.module.js`) into a side-by-side FPS / frame-ms / MB panel row for the long-session fps investigation — Step 0 of [2026-07-03-long-session-fps-and-voxel-grid-scaling-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-03-long-session-fps-and-voxel-grid-scaling-plan.md). Stock Stats.js shows one panel and cycles on tap, which is unusable mid-walk in AR, so one Stats instance is mounted per panel (2026-07-03 interview decision).

## Public API

- `createStatsOverlay(parent, options?) → StatsOverlayHandle`
  - `parent: HTMLElement` — host element. In live AR this must be (inside) the WebXR dom-overlay root (`#app`) or the panels cannot composite over the camera view. Throws `TypeError` for a non-element (fail fast: a silent no-op overlay would corrupt the measurements it exists for).
  - `options.statsFactory?: () => StatsInstance` — injected Stats constructor; default `new Stats()` from `three/addons`. Tests inject fakes (the real one builds a `<canvas>` 2D context jsdom lacks).
  - `options.memorySupported?: boolean` — override for the `performance.memory` probe (Chrome-only API). Default: probed live.
- `StatsOverlayHandle`
  - `dom: HTMLElement` — the mounted container (flex row, top-right, `pointer-events: none`).
  - `panelCount: number` — 3, or 2 when `performance.memory` is unavailable (MB panel omitted).
  - `update(): void` — advance all panels one frame; call once per rendered frame. No-op after dispose; a throwing panel is isolated (never breaks the render loop).
  - `dispose(): void` — remove the container. Idempotent.
- `StatsInstance` — the `{ dom, showPanel, update }` subset of Stats.js the overlay drives (the test-fake contract).

## Invariants & assumptions

- The overlay is a read-only instrument: `pointer-events: none` so it never swallows touches meant for the HUD sharing the dom-overlay layer; panels sit top-right because the HUD owns the top-left.
- Each Stats instance's `position:fixed` inline style is overridden to `relative` so the flex row can lay them out.
- Callers own lifecycle and cadence: live AR calls `update()` from the `setFrameCallback` tick in `main.ts` and disposes on re-enter + `resetMainState`; replay drives it from its own rAF loop in `replay-mode.ts` and disposes with the controller. A leaked handle would stack duplicate panels across sessions.
- MB numbers come from `performance.memory` — coarse, Chrome-only; a trend indicator, not a measurement (plan §Risks).

## Examples

```ts
const overlay = createStatsOverlay(document.getElementById('app')!);
renderer.setAnimationLoop(() => {
  overlay.update();
  renderer.render(scene, camera);
});
// … on teardown:
overlay.dispose();
```

## Tests

`stats-overlay.test.ts` — panel composition (3 vs 2 without memory), side-by-side layout override, pointer-events none, update fan-out, dispose idempotence + post-dispose no-op, per-panel throw isolation, invalid-parent rejection. Wiring is asserted in `main.visualization-toggles-wiring.test.ts` (gating, dom-overlay root, dispose-on-reenter) and `replay-mode.test.ts` (replay mount + dispose).
