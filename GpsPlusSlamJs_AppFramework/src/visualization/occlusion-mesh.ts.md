# occlusion-mesh.ts

## Purpose

Reusable THREE adapter that turns the pure {@link meshOccupiedCells} output into
a **persistent depth-only occlusion mesh** of the occupancy grid: an invisible
`THREE.Mesh` that writes depth but no color, drawn before virtual content, so
real geometry the camera saw earlier hides virtual objects placed behind it
(including out-of-view surfaces a live depth occluder cannot remember). Lives in
the framework so every consumer app (AnchorStarter / MinimalExample / recorder)
can use it; the recorder owns only the off-by-default toggle + scene wiring. See
`GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-mesh-options-plan.md` §4.

## Public API

- `new OcclusionMesh(arSpaceNode: THREE.Object3D, options?: OcclusionMeshOptions)`
  - `arSpaceNode` — the AR-odometry-NUE node that receives the alignment matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay). The mesh is added to it on construction.
  - `options.greedy` — merge coplanar faces (default **true**; the occluder is invisible so coarser triangulation is free). Ignored when `mode` is set.
  - `options.mode` — mesher strategy (`'per-face' | 'greedy' | 'smooth' | 'corner-fit'`; F2/F2b 2026-06-30). Additive opt-in: **unset by default**, so existing behaviour (greedy cubes) is byte-for-byte unchanged. For `'smooth'`/`'corner-fit'`, pass `getCellPoint` to `update` so the geometry hugs the measured centroids (see `occupancy-mesher.ts.md` → "Modes"). Switching is a one-option change.
  - `options.renderOrder` — depth-only draw order (default **−1**, before virtual content ≥ 0).
- `update(cells: Iterable<GridCell>, cellSizeM: number, getCellPoint?: (cell) => Vector3 | null): void` — re-mesh from a fresh snapshot (pass `grid.getOccupiedCells(occupancy.minConfidence)`); disposes the previous geometry. `getCellPoint` (pass `grid.getCellPoint`) is consumed only under `mode: 'smooth'`.
- `getTriangleCount(): number` — triangles currently drawn.
- `getAabbs(): readonly Aabb[]` — the AABB list from the last `update` (physics-export hook).
- `setDebugVisualization(enabled: boolean): void` — toggle a **visible** matcap debug rendering of the meshed surface (shiny, semi-transparent) so its shape can be judged on-device. **Additive:** adds/removes a separate skin mesh sharing the occluder's geometry and **never touches the invisible depth-only mesh**, so occlusion is byte-for-byte unchanged either way. Backs the recorder's `occupancy.occluderDebugViz` toggle. Idempotent; safe before `update` (no-op until geometry exists) and after `dispose`.
- `clear(): void` — empty the geometry; node stays attached (e.g. on store swap).
- `dispose(): void` — detach the mesh and free GPU resources; idempotent; `update` is a no-op afterwards.

## Invariants & assumptions

- **Depth-only material:** `MeshBasicMaterial({ colorWrite: false, depthWrite: true })`. This is what makes it occlude rather than render — a visible/transparent material would not write depth and would not occlude.
- **Debug skin is additive, never a material swap.** `setDebugVisualization(true)` adds a _second_ `MeshMatcapMaterial` mesh (transparent, `opacity 0.6`, `depthWrite:false`) sharing the occluder's geometry — it does **not** swap the depth mesh's material. Rationale: a `transparent` material renders in three.js's transparent phase **after** opaque content regardless of `renderOrder`, so swapping the single mesh to a transparent one would stop it occluding opaque objects. Keeping the invisible depth mesh untouched guarantees occlusion is identical with debug on or off. The matcap texture is a tiny procedural shaded-sphere `DataTexture` (no scene lights, no asset, works headless). Vertex normals (the mesher emits none) are computed only while debug is on.
- **Basis:** the mesh's local matrix is `WEBXR_TO_NUE` (`matrixAutoUpdate = false`), identical to `OccupancyCubesVisualizer`, so raw-WebXR positions ride the parent's `alignment × WEBXR_TO_NUE` chain. Parenting at the scene root would leave it axis-swapped/unaligned.
- **`frustumCulled = false`** — the surface spans the whole room.
- **Full rebuild:** `update` re-meshes the entire snapshot and swaps the geometry. The chunked dirty-remesh perf layer (plan §7) is a follow-on; throttle `update` at the call site (the recorder reuses the cubes' `wireOccupancyGridSubscribers` cadence).
- **Greedy default + T-junctions:** greedy merge is on by default; its T-junctions are harmless for a depth-only occluder (see `occupancy-mesher.ts.md`).

## Examples

```ts
import { OcclusionMesh } from 'gps-plus-slam-app-framework/visualization';

const occluder = new OcclusionMesh(arWorldGroup); // greedy depth-only, renderOrder −1
// each refresh (throttled), from the same snapshot the cubes use:
occluder.update(grid.getOccupiedCells(occupancy.minConfidence), grid.cellSizeM);
// later:
occluder.dispose();
```

## Tests

- `occlusion-mesh.test.ts` — depth-only material (colorWrite false / depthWrite true), negative renderOrder, WEBXR_TO_NUE local matrix, empty-until-update, single-voxel → 12 tris, greedy slab reduction (12 vs 140 tris) with AABBs unchanged, `clear` empties but keeps node, `dispose` detaches + idempotent. **Debug viz:** `setDebugVisualization(true)` adds a visible semi-transparent matcap skin (with normals) while the invisible depth mesh persists, geometry+normals stay in sync across re-mesh, `false` removes the skin, idempotent + safe after dispose.
- Geometry counts rely on the proven `meshOccupiedCells` invariants (`occupancy-mesher.*.test.ts`); on-device occlusion correctness is the separate gate (plan §4).
