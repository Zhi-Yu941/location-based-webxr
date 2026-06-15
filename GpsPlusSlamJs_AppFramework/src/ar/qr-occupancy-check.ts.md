# qr-occupancy-check.ts

**Purpose:** Pure geometry self-check that uses the depth-built occupancy grid as
a "physical sanity oracle" for a solved QR pose — Phase 4 / §7 of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
Because the encoded QR size scales `tvec` linearly (see
[qr-pose.ts.md](qr-pose.ts.md)), a wrong size puts the solved center off the real
surface; this check catches that.

## Public API

- `checkQrPlausibility(qrCenterWorld, cameraPosWorld, grid, options?): QrPlausibility`
  — classify a solved QR center (raw-WebXR/odom space) against the grid.
  - `OccupancySurface` — the structural slice of `OccupancyGrid` consumed
    (`cellSizeM`, `getOccupiedCells`, `getCellCenter`); the real grid satisfies
    it, tests pass a synthetic stand-in.
  - `QrPlausibilityVerdict` = `plausible` | `floating` | `behind-surface` |
    `no-grid`.
  - `QrPlausibility` = `{ verdict, ok, nearestSurfaceDistanceM }`. `ok` is
    `false` only for `floating` / `behind-surface`.
  - `QrPlausibilityOptions` — `surfaceToleranceCells` (1.5), `minObservations`
    (1), `rayCorridorCells` (1), `occlusionMarginCells` (2). All thresholds are
    in `cellSizeM` units.

## Invariants & assumptions

- **Enhancement, not a gate:** an empty grid → `no-grid` with `ok: true`, so
  detection is never blocked when depth sensing is off / unpopulated.
- **Two tests, in order:** (1) nearest occupied voxel to the QR center; beyond
  `surfaceToleranceCells·cellSizeM` ⇒ `floating`. (2) Occlusion: an occupied
  voxel projecting onto the camera→QR ray with `t ∈ (cellSizeM, rayLength −
occlusionMarginCells·cellSizeM)` and perpendicular distance `< rayCorridorCells·cellSizeM`
  ⇒ `behind-surface`. The QR's own wall voxel sits at `t ≈ rayLength`, excluded
  by the occlusion margin. Occlusion is skipped when camera and QR are within one
  cell of each other.
- **Frame:** all positions are raw-WebXR/odom, the same frame as `qrPoseWorld`
  and `DepthSample.cameraPos` — no NUE conversion here.
- **Cost:** O(occupied cells); two passes, no allocation beyond the cell-center
  list. Intended for the throttled detection cadence, not per-frame.

## Examples

```ts
const verdict = checkQrPlausibility(
  solution.qrPoseWorld.position,
  depthSample.cameraPos,
  occupancyGrid
);
if (!verdict.ok) lowerVoteWeightOrReject(verdict); // "QR size may be wrong"
```

## Tests

- `qr-occupancy-check.test.ts` — the four verdicts on synthetic walls (on-wall,
  floating, behind an occluder wall, grid-absent), the own-voxel-not-occluder
  case, the coincident camera/QR case, and a custom tolerance.
- `qr-occupancy-check.property.test.ts` — for any voxel + view direction: a QR on
  the voxel viewed from afar is `plausible`; a QR displaced beyond tolerance is
  `floating` with `nearestSurfaceDistanceM` equal to the displacement.

## Related

- Consumes [occupancy-grid.ts.md](occupancy-grid.ts.md) (`getOccupiedCells`,
  `getCellCenter`, `cellSizeM`).
- Guards the depth DOF that the 4-corner GPS-vote injection (Phase 5) leaves
  least-constrained — see the plan §6 coplanarity caveat.
