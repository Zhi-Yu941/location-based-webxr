# occupancy-view.ts

## Purpose

Build the reconstructed-mesh visualizers (cube visualizer + occlusion mesh) over a
live store's depth stream, for the **AR** path. The desktop-replay path gets this
from the framework's `startReplaySession`; live AR has no such composer (initAR is
scene-only), so the demo wires the same framework primitives here.

## Public API

- **`createOccupancyView(arWorldGroup, store, options?): OccupancyView`** —
  `options` = `{ cellSizeM=0.15, minObservations=1 }`. Returns
  `{ grid, cubes, occlusionMesh, dispose() }`.
- Builds an `OccupancyGrid`, an `OccupancyCubesVisualizer`, and an `OcclusionMesh`
  under `arWorldGroup`, subscribed to `store`'s `recordDepthSample` stream via the
  framework's `subscribeReplayOccupancy` (the SAME subscriber the replay path
  uses). On each refresh it redraws the cubes AND re-meshes the occlusion mesh
  (which feeds the physics collider).

## Invariants & assumptions

- Everything is raw-WebXR-under-NUE (under `arWorldGroup`), identical to the replay
  path — so the collider (built from the occlusion mesh AABBs) and the visible mesh
  coincide.
- Refreshes are throttled by `subscribeReplayOccupancy` (fast live/replay bursts
  coalesce). `dispose` detaches the subscription and frees the visualizers.

## Tests

- `occupancy-view.test.ts` (jsdom, real framework objects + fake store) — each
  depth sample folds into the grid and refreshes BOTH visualizers (the occlusion
  mesh must refresh — it feeds the collider); dispose detaches.
