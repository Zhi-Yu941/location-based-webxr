# AR-Space Occupancy Grid

## Purpose

TS port of the Unity voxel grid (`PointCloudData.cs` in GpsPlusSlamUnity): folds the persisted depth-sample stream (`recording/recordDepthSample`) into a sparse 3D grid of occupied cells in **raw WebXR space**, with free-space carving along each camera→point ray. Plain in-memory class — no THREE/DOM/Redux. Derived state: fed by store subscribers; the action stream remains the persisted source of truth (same pattern as `wire-frame-tile-subscribers` in the RecorderApp).

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-depth-occupancy-grid-port-plan.md`.

## Public API

- **`new OccupancyGrid(options?)`** — `cellSizeM` (default 0.15, Unity parity), `carveStopCells` (default 2). Throws `RangeError` on non-positive/non-finite cell size or negative/non-integer carve stop.
- **`addSample(sample: DepthSample): number`** — unprojects each point (`unprojectDepthPoint`), carves free space, increments the point cell's observation count. Returns the number of points added. Points that cannot be unprojected (old recordings without `projectionMatrix`, invalid depth/coords) are skipped; non-finite camera positions skip the whole sample. Carving and incrementing run as **two passes** over the sample's points (all rays carved first, then all endpoints incremented) so the result is independent of point iteration order — see invariant 3.
- **`getOccupiedCells(minObservations = 1): GridCell[]`** — cells observed at least that often.
- **`cellForPosition(pos): GridCell`** — round-quantization per axis (−0 normalized).
- **`getCellCenter(cell): Vector3`** — `cell · cellSizeM` (the 15 cm-lattice center).
- **`getCellPoint(cell): Vector3 | null`** — running-average of the EXACT unprojected surface points observed in the cell (raw WebXR), or `null` for an unknown cell. Unlike `getCellCenter` this hugs the real measured surface and noise-averages across viewpoints; it always lies within `cellSizeM/2` of the cell center. Used by the COLMAP `points3D` export and the debug cubes (follow-up Item A); every observation contributes a position, so the divisor is the observation `count`.
- **`getCellColor(cell): RgbTuple | null`** — running-average camera color of the cell's COLORED observations (Iter 8), rounded and clamped to 0–255 per channel; `null` for unknown cells or cells only ever observed without `point.rgb` (visualizers fall back to height-based coloring). Color-less observations advance the observation count but never dilute the average; non-finite rgb triples are ignored defensively.
- **`raycast(startPos, endPos, minObservations = 1): Vector3 | null`** — center of the first sufficiently-observed cell on the Bresenham line (port of Unity `TryRaycast`; hook for future cursor/floor-detection parity). Returns `null` for non-finite input or no hit. Both `raycast` and the internal carving inherit `bresenham3d`'s `MAX_TRACE_STEPS` circuit breaker: a finite-but-absurd start/end (a tracking glitch, a corrupt `projectionMatrix` unprojecting to a huge world point) that spans more than ~150 km throws a `RangeError` instead of freezing the main thread.
- **`clear(): void`** / **`size: number`**.

## Invariants & Assumptions

1. **Raw WebXR frame everywhere** — `DepthSample.cameraPos`/points are raw WebXR (local-floor); no NUE conversion in this pipeline.
2. **Observation counts instead of Unity's render-buffer indices** — WebXR has no per-pixel confidence; `minObservations` is the noise filter.
3. **Carving** — Bresenham from camera cell to point cell, stopping `carveStopCells` dominant-axis steps before the endpoint (depth-noise tolerance). Deliberate deviations from Unity: carving is skipped when camera and point share a cell, and the endpoint cell is never deleted — Unity's carve-then-re-add resets per-cell state ("§2 edge case" in the plan).
   - **Carve before increment, per sample** — within one `addSample` all rays are carved, _then_ all endpoints are incremented. So deeper-carves-nearer holds **across** samples (a later sample's ray erases an earlier sample's endpoint) but **not within** one sample: an endpoint observed by one point survives another point's overlapping ray in that same sample, regardless of point order. A single interleaved pass would be order-dependent (the deeper ray would erase the nearer endpoint only if processed second).
4. **`getCellCenter` is round-consistent** (`cell · cellSizeM`) — deliberately NOT Unity's `CellToWorldPos` (+half cell), which is off by half a cell under round-quantization.
5. **Memory & keying** — unbounded `Map` keyed by a **numeric packed cell key** (was the string `"x,y,z"` — switched 2026-06-30 to drop the per-lookup string allocation in the `addSample` / carve hot paths). The packing uses 17-bit fields, so cell coordinates must be within **±65 535** (≈ ±9.8 km at 0.15 m — far beyond any real session); `addSample` skips any point whose cell falls outside that range. Same unboundedness as Unity's dictionary (whose far denser field tests never surfaced problems); carving recycles cells in revisited areas.
6. **Replay throughput** — `addSample` is O(points × ray cells); replay re-dispatches faster than 1 Hz but runs on desktop.

## Examples

```ts
const grid = new OccupancyGrid();
storeRef.get().subscribe(() => {
  const sample = selectLatestDepthSample(store.getState());
  if (sample && sample !== last) grid.addSample(sample);
});
const cells = grid.getOccupiedCells(2); // noise-filtered
const hit = grid.raycast(cameraPos, forwardPoint); // cursor placement
```

## Tests

- `occupancy-grid.test.ts` — construction validation, add/skip paths (old recordings, invalid points, non-finite camera), counts, carve-stop protection, same-cell deviation, scene-change carving, intra-sample point-order independence, center formula, raycast hit/miss/min-observations, clear, and the Iter-8 cell-color block (verbatim single observation, rounded averaging, no dilution by color-less observations, non-finite rejection, clear drops colors).
- `occupancy-grid.property.test.ts` — fast-check: quantization↔center within `cellSizeM/2` per axis (guards against Unity's half-cell offset); observed cells survive any repeat observation count (incl. degenerate same-cell case); a nearer on-ray cell is carved iff it is at least `carveStopCells` in front of a deeper observation; cell color equals the rounded per-channel mean of exactly the colored observations (Iter 8).
