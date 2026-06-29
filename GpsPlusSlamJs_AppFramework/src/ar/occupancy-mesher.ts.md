# occupancy-mesher.ts

## Purpose

Pure, dependency-free mesher that turns a snapshot of {@link OccupancyGrid}
occupied cells into a **face-culled voxel surface** (`positions` + `indices`,
raw-WebXR metres) plus a per-cell **AABB list**. The surface feeds the
persistent depth-only **occlusion** mesh and a **trimesh** physics collider; the
AABB list feeds a **compound box collider** (the better voxel-physics fit). See
`GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-mesh-options-plan.md` (option B,
§3E, §8).

## Public API

- `meshOccupiedCells(cells: Iterable<GridCell>, cellSizeM: number, options?: MeshOccupiedCellsOptions): OccupancyMeshResult`
  - **Inputs:** `cells` — occupied cells, typically `grid.getOccupiedCells(occupancy.minConfidence)`; `cellSizeM` — cube edge length in metres; `options.greedy` — merge coplanar faces (default false).
  - **Output:** `{ positions: Float32Array, indices: Uint32Array, aabbs: Aabb[] }`.
    - `positions`/`indices`: a triangle soup, 4 vertices + 2 triangles per emitted quad, in raw-WebXR metres. Vertices are **not** shared between quads.
    - `aabbs`: one `{ center, halfExtents }` per **unique** occupied cell (`center = cell · cellSizeM`, `halfExtents = cellSizeM/2`). The AABB list is **not** affected by `greedy`.
  - **Error modes:** throws `RangeError` if `cellSizeM` is non-finite or ≤ 0. Duplicate cells are de-duplicated; cells with a non-finite coordinate are skipped defensively.
- `Aabb` — `{ center: [x,y,z], halfExtents: [hx,hy,hz] }`, raw-WebXR metres.
- `OccupancyMeshResult` — the typed-array bundle above (transferable to a Web Worker).
- `MeshOccupiedCellsOptions` — `{ greedy?: boolean }`.

## Greedy merge (`{ greedy: true }`)

Minecraft-style greedy meshing: per face-normal axis + side, each slice's
exposed-face mask is merged into maximal rectangles (row-major, deterministic),
emitting one quad per rectangle. Cuts the triangle count substantially on flat
runs (e.g. a 5×5×1 slab: 70 quads → 6). The merged surface covers the **exact
same set of unit faces** as the default per-face output — proven by the
differential property test — so the occluded volume is identical; only the
triangulation is coarser.

- **AABBs unchanged:** greedy merges the render/occluder geometry only. A 3-D
  greedy **box** merge for fewer colliders (plan §3E) is a separate follow-on;
  the AABB list stays one box per cell.
- **T-junctions:** greedy quads of differing extents can meet at T-junctions
  (a long edge against two shorter ones), so the greedy surface is **not**
  edge-2-manifold and the per-face "even edge cover" watertight test does not
  apply to it. For a depth-only occluder this is harmless (coverage is identical
  and watertight in the area sense); a consumer that needs a welded, crack-free
  manifold (some trimesh colliders) should use the **default per-face** output
  or weld + T-junction-split downstream.

## Invariants & assumptions

- **Face culling:** a face is emitted **iff** its neighbour cell (±1 on one axis) is empty. Interior faces are dropped → triangle count scales with surface area, not volume.
- **Geometry:** cube for cell `c` spans `[c·s − s/2, c·s + s/2]` per axis, matching `OccupancyGrid.getCellCenter` (round-quantization, no half-cell offset). Faces use outward CCW winding.
- **Watertight:** for a closed voxel region the surface has no boundary — every edge is covered an **even** number of times (2 for manifold edges, 4 along the non-manifold edges that diagonal-touching voxels create). It is **not** guaranteed edge-2-manifold (diagonal contact is legal voxel data).
- **Deterministic:** output for a given input is stable; face/AABB counts are permutation-invariant in the input order.
- **Raw-WebXR space:** positions are in the same frame as the grid cells. The consumer parents the mesh under `arWorldGroup` (carrying `WEBXR_TO_NUE`) so it rides the alignment matrix, exactly like the cubes visualizer.
- **Snapshot, don't mesh the live grid:** the caller passes an immutable array snapshot; the mesher never holds a reference to the mutating grid.

## Examples

```ts
import {
  OccupancyGrid,
  meshOccupiedCells,
} from 'gps-plus-slam-app-framework/ar';

const cells = grid.getOccupiedCells(occupancy.minConfidence);
const { positions, indices, aabbs } = meshOccupiedCells(cells, grid.cellSizeM);

// → THREE depth-only occluder geometry (thin adapter; see the recorder wiring)
const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geom.setIndex(new THREE.BufferAttribute(indices, 1));

// → developer's own physics: one box collider per AABB
for (const { center, halfExtents } of aabbs)
  physics.addBox(center, halfExtents);
```

## Tests

- `occupancy-mesher.test.ts` — exact-count fixtures: isolated voxel (6 faces / 12 tris), AABB placement, ±half-cell span, shared-face culling (10 faces), solid 2×2×2 (24 faces), enclosed-voxel drop (3×3×3 → 54 faces), de-dup, non-finite skip, `cellSizeM` validation.
- `occupancy-mesher.property.test.ts` — invariants over arbitrary cell sets: face count = empty-6-neighbour sum, watertight (even edge cover, per-face path), in-range indices + finite positions, permutation invariance, one AABB per unique cell, and **greedy covers the exact same unit faces as per-face culling** (with ≤ the triangle count).
- Realistic-scale + perf validation is a separate skip-if-missing RecorderApp integration probe (plan §8 "Test data strategy"), not unit-tested here.
