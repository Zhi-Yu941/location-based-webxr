# occupancy-view.ts

## Purpose

The demo's single reconstructed mesh, used for BOTH the visual occlusion AND the
physics collider (user feedback: same framework building block). Owns an
`OccupancyGrid` fed by a store's `recordDepthSample` stream (via the framework's
`subscribeReplayOccupancy`) driving ONE `OcclusionMesh`. Used by both the desktop
(with `startReplaySession`'s own occupancy disabled) and live-AR paths.

## Public API

- **`createOccupancyView(arWorldGroup, store, options?): OccupancyView`** —
  `options` = `{ cellSizeM=0.15, minObservations=1, meshMode='smooth',
debugStyle='depth-shaded-wireframe' }` (matches the RecorderApp defaults).
- **`OccupancyView`**:
  - `getMesh(): THREE.Mesh` — the CURRENT occluder's mesh (a stable handle across
    `setMeshMode` recreation), whose trimesh feeds the physics collider.
  - `setMeshMode(mode)` — `MeshMode` (`'smooth'` Surface nets / `'greedy'` Cubes /
    `'corner-fit'`). Since the mode is an `OcclusionMesh` CONSTRUCTION option, this
    **recreates** the occluder and re-meshes from the persisted grid.
  - `setDebugStyle(style)` — live `OccluderDebugStyle` skin switch.
  - `dispose()`.

## Invariants & assumptions

- **One occluder = occlusion + physics.** The depth-only occluder always writes
  depth (occlusion is on in every shader, incl. `'off'`); its geometry buffer
  (raw-WebXR) is the physics trimesh — so the two never diverge.
- **Grid persists across mode changes** — `setMeshMode` disposes/rebuilds only the
  occluder and re-meshes from the existing grid, so no depth data is lost.
- No cube visualizer — "Cubes (blocky)" is the `'greedy'` mesher mode of the
  occluder, not a separate instanced mesh.

## Tests

- `occupancy-view.test.ts` (real framework objects + fake store) — each depth
  sample folds into the grid and re-meshes the occluder; defaults to Surface nets +
  the combined shader; `setDebugStyle` switches live; `setMeshMode` yields a NEW
  `getMesh()` handle and re-meshes; dispose detaches.
