# `ref-point-visualizer.ts`

## Purpose

Recorder-side `RefPointVisualizer` that adapts the recorder's `RefPointMark`
domain type onto the pure-function `syncGpsAnchoredMeshes` reconciler
(prior=green, current=red). Holds one `Map<id, THREE.Mesh>` per colour
between calls plus a single `zeroRef` field; no other state.

## Public API

- `class RefPointVisualizer`
  - `setZeroRef(zero)` / `getZeroRef()` — `setZeroRef` also **replays**
    the entries most recently passed to `syncRefPoints` (cached in
    `lastRefPoints`), so entries pushed before GPS lock render as soon
    as the zero reference arrives instead of waiting for the next store
    mutation. This makes the visualizer self-healing rather than
    dependent on subscriber ordering.
  - **`syncRefPoints(entries: readonly RefPointEntry[])`** — unified
    entry point for the recorder's flat `selectRefPointEntries`
    selector (Step 5.3 of the 2026-05-27 slice-collapse plan). Reads
    `id` plus `gpsPoint ?? rawGpsPoint` (latitude/longitude/altitude)
    per entry; the fused snapshot is preferred when present, otherwise
    the raw GPS sample is used. Renders all entries in a single colour
    (`VIS_COLORS.CURRENT_REF_POINT`) with mesh name `ref-point-${id}`
    and animates newly-inserted ids with a brief scale-up
    (0.2 → 1.0 over `INSERT_ANIMATION_DURATION_SEC` via
    `registerFrameUpdate`). The per-mesh tick is exposed at
    `mesh.userData.refPointInsertAnimation` so tests can detect that
    the animation was scheduled.
  - `getRefPointCount(): number` — number of meshes managed by
    `syncRefPoints`.
  - `displayPriorRefPoints(marks)` — _legacy_; replaces the prior group;
    marks without `gpsPosition` are skipped. Removed in Step 5 along
    with the recorder `refPoints` slice.
  - `addCurrentRefPoint(mark)` — _legacy_; appends to the current group.
    Removed in Step 5.
  - `clearPriorRefPoints()` / `clearCurrentRefPoints()` / `clearAll()` —
    `clearAll` also clears the unified `syncRefPoints` handles, resets
    the zero ref, and drops the cached `lastRefPoints` so a later
    `setZeroRef` does not replay stale entries.
  - `getCounts(): { prior, current }` — _legacy_; counts for the
    prior/current pipelines only. Use `getRefPointCount()` for the
    unified pipeline.
- `const refPointVisualizer` — singleton consumed by
  `recording-session-handlers` and `replay-mode`.

## Invariants & assumptions

- Mesh name format: `ref-point-${id}` (unified) and `prior-ref-${id}` /
  `current-ref-${id}` (legacy, removed in Step 5).
- The insert animation fires **exactly once per id** — a re-render with
  the same id leaves the existing mesh untouched.
- **One sphere per H3 cell id; latest live observation wins the position.**
  Multiple `RefPointEntry`s can share the same cell `id` (the imported
  sidecar centroid plus one entry per live re-capture). They collapse to a
  single mesh keyed by `id`, and the position follows **last-occurrence /
  last-write-wins**: the most recent live tap supersedes the historical
  centroid, because the fresh fused fix is the better estimate. This holds
  both within one `syncRefPoints` call (last element wins) and across
  successive calls (the existing mesh is moved in place, the instance is
  preserved, and the insert animation does not re-fire). Pinned by
  `renders one sphere at the LAST entry position when entries share an id`
  and `moves an existing sphere to the latest position on re-observation`
  in [ref-point-visualizer.test.ts](ref-point-visualizer.test.ts). Design
  rationale: see
  [2026-05-29-refpoint-single-sphere-vs-multi-sphere-review.md](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-29-refpoint-single-sphere-vs-multi-sphere-review.md)
  §3.3.
- Shared geometry/material lifecycle is owned by the module-level cache
  inside `syncGpsAnchoredMeshes`; the visualizer never disposes GPU
  resources directly.
- Scene access goes through `getScene()` from
  `gps-plus-slam-app-framework/ar/webxr-session`; the scene is then
  injected explicitly into the reconciler (P3 rule 1).
- Frame-loop access goes through `registerFrameUpdate` from
  `gps-plus-slam-app-framework/ar/frame-loop`; the returned unregister
  is invoked when the animation completes so the registry stays bounded.

## Tests

- See [ref-point-visualizer.test.ts](ref-point-visualizer.test.ts). Behavioural tests preserved verbatim across the manager-to-reconciler refactor so the move is provably semantics-preserving.

## Related docs

- [`sync-gps-anchored-meshes.ts`](sync-gps-anchored-meshes.ts.md) — the pure reconciler this class drives.
- [survey § P2](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md) — the manager-retirement rationale.
- [boundary plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) — Iter 4.
