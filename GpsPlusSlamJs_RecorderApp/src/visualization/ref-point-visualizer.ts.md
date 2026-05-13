# `ref-point-visualizer.ts`

## Purpose

Recorder-side `RefPointVisualizer` that adapts the recorder's `RefPointMark`
domain type onto the pure-function `syncGpsAnchoredMeshes` reconciler
(prior=green, current=red). Holds one `Map<id, THREE.Mesh>` per colour
between calls plus a single `zeroRef` field; no other state.

## Public API

- `class RefPointVisualizer`
  - `setZeroRef(zero)` / `getZeroRef()`
  - `displayPriorRefPoints(marks)` — replaces the prior group; marks without `gpsPosition` are skipped
  - `addCurrentRefPoint(mark)` — appends to the current group (or updates in place on duplicate id); no-op when zero ref or `gpsPosition` is missing
  - `clearPriorRefPoints()` / `clearCurrentRefPoints()` / `clearAll()`
  - `getCounts(): { prior, current }`
- `const refPointVisualizer` — singleton consumed by `recording-session-handlers` and `replay-mode`.

## Invariants & assumptions

- Mesh name format preserved from the original framework version (`prior-ref-${id}` / `current-ref-${id}`).
- Shared geometry/material lifecycle is owned by the module-level cache inside `syncGpsAnchoredMeshes`; the visualizer never disposes GPU resources directly.
- Scene access goes through `getScene()` from `gps-plus-slam-app-framework/ar/webxr-session`; the scene is then injected explicitly into the reconciler (P3 rule 1).

## Tests

- See [ref-point-visualizer.test.ts](ref-point-visualizer.test.ts). Behavioural tests preserved verbatim across the manager-to-reconciler refactor so the move is provably semantics-preserving.

## Related docs

- [`sync-gps-anchored-meshes.ts`](sync-gps-anchored-meshes.ts.md) — the pure reconciler this class drives.
- [survey § P2](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md) — the manager-retirement rationale.
- [boundary plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) — Iter 4.
