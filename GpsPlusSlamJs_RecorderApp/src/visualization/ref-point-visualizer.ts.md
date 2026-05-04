# `ref-point-visualizer.ts`

## Purpose

Recorder-side `RefPointVisualizer` that adapts the recorder's `RefPointMark` onto two `GpsAnchoredMeshManager` instances (prior=green, current=red) from `gps-plus-slam-app-framework/visualization/gps-anchored-mesh-manager`. Lives in the recorder so the framework's visualization layer stays recorder-agnostic.

## Public API

- `class RefPointVisualizer`
  - `setZeroRef(zero)` / `getZeroRef()`
  - `displayPriorRefPoints(marks)` — replaces the prior group; marks without `gpsPosition` are skipped
  - `addCurrentRefPoint(mark)` — appends to the current group; no-op when zero ref or `gpsPosition` is missing
  - `clearPriorRefPoints()` / `clearCurrentRefPoints()` / `clearAll()`
  - `getCounts(): { prior, current }`
- `const refPointVisualizer` — singleton consumed by `recording-session-handlers` and `replay-mode`.

## Invariants & assumptions

- Mesh name format preserved from the original framework version (`prior-ref-${id}` / `current-ref-${id}`).
- Shared geometry/material lifecycle delegated to `GpsAnchoredMeshManager`.
- All scene access goes through `getScene()` from `gps-plus-slam-app-framework/ar/webxr-session`.

## Tests

- See [ref-point-visualizer.test.ts](ref-point-visualizer.test.ts). Behavioural tests preserved verbatim from the framework's old `reference-points.test.ts` so the move is provably semantics-preserving.

## Related docs

- [`gps-anchored-mesh-manager.ts`](../../../GpsPlusSlamJs_AppFramework/src/visualization/gps-anchored-mesh-manager.ts.md) — the generic core in the framework.
- [boundary plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) — Iter 4.
