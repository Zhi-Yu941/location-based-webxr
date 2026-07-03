/**
 * Synthetic Occupancy-Grid Builder (deterministic, CI-safe large-scene fixture)
 *
 * Why this exists (2026-06-30 occluder-tuning session, F3): the only realistic
 * large-grid mesh measurement we had was the LOCAL-ONLY real-zip probe
 * (`occupancy-mesh-recording.integration.test.ts`, skipped in CI). The
 * maintainer asked for a deterministic, CI-safe way to mesh a hundreds-of-metres
 * grid and assert triangle/vertex/memory budgets — and to bench the mesher
 * strategies side-by-side "at scale" to decide which is sensible long-term.
 *
 * This helper builds a *real* {@link OccupancyGrid} (so `getOccupiedCells`,
 * `getCellPoint` and `size` behave exactly as in production) for a parametric
 * solid box slab of cells, of any chosen cell count. It feeds the grid through
 * the genuine `addSample` → unprojection → increment path, so it exercises the
 * same code the recorder does — not a shortcut that bypasses it.
 *
 * HOW the exact placement works (the elegant bit). With the camera at the
 * origin, identity rotation, and an **identity projection matrix**, the
 * unprojection in `depth-unprojection.ts` collapses to a closed form:
 *
 *   world = ((2·screenX − 1)·D, (1 − 2·screenY)·D, −D),   D = depthM
 *
 * so to land a point at a chosen world position `P` (with `Pz < 0`) we invert it:
 *
 *   D = −Pz;  screenX = (Px/D + 1)/2;  screenY = (1 − Py/D)/2
 *
 * The slab is pushed far enough into −Z that every `screenX/screenY` stays in
 * `[0,1]` (the only constraint identity-projection imposes). Free-space carving
 * is DISABLED (`carveStopCells` set above any ray length) so the synthetic
 * surface is exactly the cells we place — no ray ever erases a neighbour — and
 * grid construction stays cheap (carve visits only the origin cell and returns).
 *
 * Each cell is observed `observationsPerCell` times at the SAME jittered point
 * (cell centre + a fixed sub-cell `centroidOffsetM`), so its `getCellPoint()`
 * centroid is a known, non-trivial displacement from the cell centre — the input
 * the centroid-consuming meshers (F2 'smooth' / F2b 'corner-fit') need.
 *
 * DESIGN BOUNDARY: valid, solid box slabs only. The exact mesh budgets the
 * harness asserts (per-face triangle count, watertightness) rely on the placed
 * set being a perfect solid box. Do not add holes/noise here — for those, build
 * cells by hand in the test.
 *
 * @see synthetic-occupancy-grid.md for the budget formulae and usage.
 */

import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import { OccupancyGrid } from '../ar/occupancy-grid';
import { MAX_TRACE_STEPS } from '../ar/bresenham3d';
import type { DepthPoint } from '../types/ar-types';

/** Column-major identity projection — its inverse gives the closed form above. */
const IDENTITY_PROJECTION = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as unknown as Matrix4;

const CAMERA_AT_ORIGIN: Vector3 = [0, 0, 0];
const IDENTITY_ROTATION: Quaternion = [0, 0, 0, 1];

export interface SyntheticSurfaceOptions {
  /** Cells along the X axis (slab width). Must be a positive integer. */
  readonly cellsX: number;
  /** Cells along the Z axis (slab depth). Must be a positive integer. */
  readonly cellsZ: number;
  /**
   * Cells along the Y axis (slab thickness). Default 1 — a one-cell sheet, the
   * "floor" case the smoothness work centres on. A 1-thick slab is still a
   * closed box for the cube meshers (top + bottom + perimeter).
   */
  readonly thickness?: number;
  /** Cell edge length in metres. Default 0.15 (production parity). */
  readonly cellSizeM?: number;
  /**
   * Observations folded per cell — must clear the consumer's `minConfidence`
   * floor. Default 5 (the 2026-06-30 re-tuned default).
   */
  readonly observationsPerCell?: number;
  /**
   * Deterministic sub-cell offset (metres) applied to every observed point so
   * each cell's `getCellPoint()` centroid is a known displacement from the cell
   * centre. Each component MUST be `< cellSizeM/2` (else the point would land in
   * a neighbouring cell). Default a fixed asymmetric offset.
   */
  readonly centroidOffsetM?: readonly [number, number, number];
}

export interface SyntheticSurfaceResult {
  /** The populated grid — ready for `getOccupiedCells` / `meshOccupiedCells`. */
  readonly grid: OccupancyGrid;
  /** Cells placed = expected `grid.size` and AABB count (`cellsX·thickness·cellsZ`). */
  readonly cellCount: number;
  /**
   * Exact per-face (culled) triangle count for this solid box slab:
   * `4·(A·B + B·C + C·A)` for an A×B×C box — surface area in faces × 2
   * triangles/face. The harness asserts the mesher matches this.
   */
  readonly expectedPerFaceTriangles: number;
  readonly cellSizeM: number;
  /** The sub-cell offset actually applied (so tests can assert centroids). */
  readonly centroidOffsetM: readonly [number, number, number];
}

/** Invert the identity-projection closed form: a world point → its DepthPoint. */
function worldToIdentityDepthPoint(p: Vector3): DepthPoint | null {
  const depthM = -p[2];
  if (!(depthM > 0)) {
    return null; // point must be in front of the camera (−Z forward)
  }
  const screenX = (p[0] / depthM + 1) / 2;
  const screenY = (1 - p[1] / depthM) / 2;
  if (screenX < 0 || screenX > 1 || screenY < 0 || screenY > 1) {
    return null; // outside the unit view — caller chose too shallow a slab depth
  }
  return { screenX, screenY, depthM };
}

/**
 * Build a deterministic solid-box occupancy grid of `cellsX × thickness ×
 * cellsZ` cells via the real `addSample` path. See the file header for the
 * placement math and invariants.
 *
 * @throws RangeError on non-positive-integer dimensions, a non-finite cell size,
 *   an out-of-range observation count, or a `centroidOffsetM` component
 *   `≥ cellSizeM/2`.
 */
export function buildSyntheticSurfaceGrid(
  opts: SyntheticSurfaceOptions
): SyntheticSurfaceResult {
  const cellSizeM = opts.cellSizeM ?? 0.15;
  const thickness = opts.thickness ?? 1;
  const observationsPerCell = opts.observationsPerCell ?? 5;
  const A = opts.cellsX;
  const B = thickness;
  const C = opts.cellsZ;

  for (const [name, v] of [
    ['cellsX', A],
    ['thickness', B],
    ['cellsZ', C],
    ['observationsPerCell', observationsPerCell],
  ] as const) {
    if (!Number.isSafeInteger(v) || v <= 0) {
      throw new RangeError(`${name} must be a positive integer, got ${v}`);
    }
  }
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError(`cellSizeM must be positive, got ${cellSizeM}`);
  }
  const half = cellSizeM / 2;
  const offset = opts.centroidOffsetM ?? [
    cellSizeM * 0.2,
    -cellSizeM * 0.1,
    cellSizeM * 0.15,
  ];
  if (offset.some((o) => !Number.isFinite(o) || Math.abs(o) >= half)) {
    throw new RangeError(
      `each centroidOffsetM component must be finite and < cellSizeM/2 (${half}), got [${offset.join(', ')}]`
    );
  }

  // Push the slab into −Z far enough that every screen coordinate stays in
  // [0,1] (needs |worldZ| ≥ |worldX|,|worldY| at the NEAREST cell, so the
  // budget must cover BOTH transverse dimensions — worldX ≤ A·cellSize and
  // worldY ≤ B·cellSize. Budgeting only A once tripped the loud view guard
  // below for a tall slab, PR #145 review).
  const kBase = -(A + B + C + 16);

  // Disable carving: a stop distance above any ray's span means carve() visits
  // only the origin cell (never a surface cell) and returns — cheap, and the
  // placed surface is exactly the intended cells.
  const grid = new OccupancyGrid({
    cellSizeM,
    carveStopCells: MAX_TRACE_STEPS,
  });

  // Fold ALL points through a SINGLE addSample: the unprojector (a projection
  // inverse) is built once per sample, so one big sample = one matrix invert
  // total instead of one per cell — keeping the ~20k-cell build well inside the
  // fast-suite timeout even under parallel worker contention. observationsPerCell
  // identical copies per cell make its count clear minConfidence while keeping
  // the centroid exactly at centre + offset.
  const points: DepthPoint[] = [];
  for (let i = 0; i < A; i++) {
    for (let j = 0; j < B; j++) {
      for (let k = 0; k < C; k++) {
        const point: Vector3 = [
          i * cellSizeM + offset[0],
          j * cellSizeM + offset[1],
          (kBase + k) * cellSizeM + offset[2],
        ];
        const depthPoint = worldToIdentityDepthPoint(point);
        if (!depthPoint) {
          // Unreachable given kBase above; guard so a future dimension change
          // fails loudly here instead of silently dropping cells.
          throw new RangeError(
            `cell (${i},${j},${k}) fell outside the synthetic view; increase the slab depth`
          );
        }
        for (let o = 0; o < observationsPerCell; o++) points.push(depthPoint);
      }
    }
  }
  grid.addSample({
    timestamp: 0, // sample-invariant for the grid; unused by addSample
    cameraPos: CAMERA_AT_ORIGIN,
    cameraRot: IDENTITY_ROTATION,
    points,
    projectionMatrix: IDENTITY_PROJECTION,
  });

  const faces = 2 * (A * B + B * C + C * A);
  return {
    grid,
    cellCount: A * B * C,
    expectedPerFaceTriangles: 2 * faces,
    cellSizeM,
    centroidOffsetM: offset,
  };
}
