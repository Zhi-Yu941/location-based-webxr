/**
 * AR-Space Occupancy Grid
 *
 * TS port of the Unity voxel grid (`PointCloudData.cs`): folds the
 * persisted depth-sample stream (`recording/recordDepthSample`) into a
 * sparse 3D grid of occupied cells in raw WebXR space, with free-space
 * carving along each camera→point ray. Plain in-memory class — no THREE,
 * no DOM, no Redux; it is fed by store subscribers (the action stream is
 * the persisted source of truth, the grid is derived state).
 *
 * Deliberate deviations from the Unity original (2026-06-11 port plan):
 * - Cells hold an OBSERVATION COUNT (WebXR exposes no per-pixel
 *   confidence; the count is the noise-suppression analogue), not a render
 *   buffer index.
 * - Carving is skipped when camera and point share a cell, and the
 *   endpoint cell itself is never carved — Unity's carve-then-re-add would
 *   reset the count.
 * - `getCellCenter` is `cell · cellSizeM`, the true center under
 *   round-quantization (Unity's `CellToWorldPos` adds a spurious half
 *   cell).
 *
 * @see occupancy-grid.ts.md for detailed documentation
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { DepthSample, RgbTuple } from '../types/ar-types';
import { createDepthUnprojector } from './depth-unprojection';
import { bresenham3d, type GridCell } from './bresenham3d';

export interface OccupancyGridOptions {
  /** Edge length of a cubic grid cell in meters. Default 0.15 (Unity parity). */
  readonly cellSizeM?: number;
  /**
   * Dominant-axis steps before a ray's endpoint at which free-space
   * carving stops, to respect depth noise. Default 2 (Unity parity).
   */
  readonly carveStopCells?: number;
}

interface CellRecord {
  readonly cell: GridCell;
  /** Number of depth points observed in this cell. */
  count: number;
  /**
   * Per-axis sum of the EXACT unprojected points (raw WebXR) observed in this
   * cell. `posSum / count` is the running-average surface point — what the
   * COLMAP export and the debug cubes draw, instead of the 15 cm-lattice
   * `getCellCenter` (COLMAP export follow-up, Item A). Every observation has a
   * position, so the divisor is `count` (unlike `colorSum`/`colorCount`).
   */
  posSum: [number, number, number];
  /**
   * Number of observations that carried a color (≤ count — color-less
   * observations from old recordings or with the rgb option off must not
   * dilute the average toward black, Iter 8).
   */
  colorCount: number;
  /** Per-channel sums of the colored observations (running average). */
  colorSum: [number, number, number];
}

/**
 * Highest `minConfidence` a consumer can ask for (mirrors
 * `OCCUPANCY_CONSTRAINTS.minConfidence.max`). Once a cell's count exceeds this,
 * further observations can no longer change ANY consumer's occupied set, so they
 * do not bump {@link OccupancyGrid.getRevision} — letting a settled scene skip
 * redundant re-meshing.
 */
const MAX_RELEVANT_COUNT = 10;

export class OccupancyGrid {
  readonly cellSizeM: number;
  readonly carveStopCells: number;
  private readonly cells = new Map<number, CellRecord>();
  /**
   * Monotonic counter bumped whenever the **occupied set** (at any
   * `minConfidence ≤ MAX_RELEVANT_COUNT`) could have changed: a cell added, a
   * cell removed by carving, a cell's count rising while still `≤
   * MAX_RELEVANT_COUNT` (a possible threshold crossing), or `clear`. Re-observing
   * an already-settled cell (count `> MAX_RELEVANT_COUNT`) does NOT bump it, so a
   * consumer can cheaply skip a full re-derive (cube refresh / occluder re-mesh)
   * when the revision is unchanged — the dominant idle-time saving over a long
   * session (see `2026-06-30-occluder-tuning-followups.md`).
   */
  private revision = 0;

  constructor(options?: OccupancyGridOptions) {
    const cellSizeM = options?.cellSizeM ?? 0.15;
    const carveStopCells = options?.carveStopCells ?? 2;
    if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
      throw new RangeError(
        `cellSizeM must be a positive number, got ${cellSizeM}`
      );
    }
    if (!Number.isSafeInteger(carveStopCells) || carveStopCells < 0) {
      throw new RangeError(
        `carveStopCells must be a non-negative integer, got ${carveStopCells}`
      );
    }
    this.cellSizeM = cellSizeM;
    this.carveStopCells = carveStopCells;
  }

  /** Number of occupied cells. */
  get size(): number {
    return this.cells.size;
  }

  /**
   * A monotonic version that changes only when the occupied set (at any
   * `minConfidence ≤ 10`) could have changed. A consumer caches the value it
   * last meshed/rendered and skips its full re-derive when it is unchanged — so
   * a settled scene (already-observed cells being re-observed) costs nothing.
   * See {@link revision}.
   */
  getRevision(): number {
    return this.revision;
  }

  /**
   * Fold one depth sample into the grid: unproject each point, carve free
   * space from the camera cell to the point cell, then count the point's
   * cell as occupied. Points that cannot be unprojected (no
   * projectionMatrix on old recordings, invalid depth/coords) are skipped.
   *
   * Carving and incrementing run as two separate passes over the sample's
   * points: all rays are carved first, then every endpoint is incremented.
   * A single interleaved pass would be order-dependent — a deeper point's
   * carve could erase the endpoint a nearer point added earlier in the same
   * sample. Splitting the passes makes the result deterministic and lets an
   * endpoint observed within a sample survive other rays in that same
   * sample. (Deeper-carves-nearer still applies ACROSS samples: a later
   * sample's ray carves an earlier sample's endpoint as before.)
   *
   * @returns the number of points actually added.
   */
  addSample(sample: DepthSample): number {
    if (!isFiniteTriple(sample.cameraPos)) {
      return 0;
    }
    // Projection inverse and camera pose are sample-invariant — build the
    // unprojector once and reuse it for every point (null when the sample has
    // no usable projection matrix, e.g. pre-intrinsics recordings).
    const unprojector = createDepthUnprojector(
      sample.cameraPos,
      sample.cameraRot,
      sample.projectionMatrix
    );
    if (!unprojector) {
      return 0;
    }
    const cameraCell = this.cellForPosition(sample.cameraPos);
    // Pass 1: carve free space along every ray, collecting endpoint cells
    // (with the observing point's color, if any — Iter 8).
    const endpoints: Array<{ cell: GridCell; world: Vector3; rgb?: RgbTuple }> =
      [];
    for (const point of sample.points) {
      const world = unprojector.unproject(point);
      if (!world) {
        continue;
      }
      const cell = this.cellForPosition(world);
      // Defensive: a corrupt projection can unproject to an absurd point whose
      // cell falls outside the packable key range. Skip it (it cannot be a real
      // ≤few-metre depth reading) rather than store a colliding key.
      if (!cellInKeyRange(cell)) {
        continue;
      }
      if (!cellsEqual(cameraCell, cell)) {
        this.carve(cameraCell, cell);
      }
      endpoints.push({ cell, world, rgb: point.rgb });
    }
    // Pass 2: count endpoints occupied, after all carving for this sample.
    for (const endpoint of endpoints) {
      this.increment(endpoint.cell, endpoint.world, endpoint.rgb);
    }
    return endpoints.length;
  }

  /** Occupied cells observed at least `minObservations` times (default 1). */
  getOccupiedCells(minObservations = 1): GridCell[] {
    const result: GridCell[] = [];
    for (const record of this.cells.values()) {
      if (record.count >= minObservations) {
        result.push(record.cell);
      }
    }
    return result;
  }

  /** Quantize a raw-WebXR position to its grid cell (round per axis). */
  cellForPosition(pos: Vector3): GridCell {
    // `+ 0` normalizes Math.round's -0 so cell coordinates compare cleanly
    return [
      Math.round(pos[0] / this.cellSizeM) + 0,
      Math.round(pos[1] / this.cellSizeM) + 0,
      Math.round(pos[2] / this.cellSizeM) + 0,
    ];
  }

  /** Center of a cell in raw WebXR space (round-consistent: cell · cellSizeM). */
  getCellCenter(cell: GridCell): Vector3 {
    return [
      cell[0] * this.cellSizeM,
      cell[1] * this.cellSizeM,
      cell[2] * this.cellSizeM,
    ];
  }

  /**
   * Running-average of the EXACT unprojected surface points observed in this
   * cell (raw WebXR space), or null for an unknown cell. Unlike
   * {@link getCellCenter} (the geometric 15 cm-lattice center) this hugs the
   * real measured surface and noise-averages across viewpoints — used by the
   * COLMAP `points3D` export and the debug cubes (follow-up Item A). Being a
   * centroid of points that fell in the cell, it always lies within
   * `cellSizeM/2` of the cell center per axis.
   */
  getCellPoint(cell: GridCell): Vector3 | null {
    const record = this.cells.get(cellKey(cell));
    if (!record || record.count === 0) {
      return null;
    }
    return [
      record.posSum[0] / record.count,
      record.posSum[1] / record.count,
      record.posSum[2] / record.count,
    ];
  }

  /**
   * Running-average color of the cell's colored observations (Iter 8), or
   * null when the cell is unknown or was only ever observed without color
   * (rgb option off / pre-Iter-8 recordings) — consumers fall back to
   * height-based coloring. Channels are rounded and clamped to 0–255.
   */
  getCellColor(cell: GridCell): RgbTuple | null {
    const record = this.cells.get(cellKey(cell));
    if (!record || record.colorCount === 0) {
      return null;
    }
    const average = (sum: number): number =>
      Math.min(255, Math.max(0, Math.round(sum / record.colorCount)));
    return [
      average(record.colorSum[0]),
      average(record.colorSum[1]),
      average(record.colorSum[2]),
    ];
  }

  /**
   * Walk the grid from `startPos` to `endPos` and return the center of the
   * first cell occupied at least `minObservations` times, or null.
   * Port of Unity's `TryRaycast` (hook for cursor/floor-detection parity).
   */
  raycast(
    startPos: Vector3,
    endPos: Vector3,
    minObservations = 1
  ): Vector3 | null {
    if (!isFiniteTriple(startPos) || !isFiniteTriple(endPos)) {
      return null;
    }
    let hit: GridCell | null = null;
    bresenham3d(
      this.cellForPosition(startPos),
      this.cellForPosition(endPos),
      (cell) => {
        const record = this.cells.get(cellKey(cell));
        if (record && record.count >= minObservations) {
          hit = cell;
          return false; // ray can stop at the first hit
        }
        return true;
      }
    );
    return hit ? this.getCellCenter(hit) : null;
  }

  /** Remove all occupied cells (e.g. on store swap / new session). */
  clear(): void {
    if (this.cells.size > 0) {
      this.revision++;
    }
    this.cells.clear();
  }

  /**
   * Delete occupied cells along the camera→point ray (the space was seen
   * through, so it must be free), stopping `carveStopCells` dominant-axis
   * steps before the endpoint. The endpoint cell itself is additionally
   * protected so a current observation is never erased (relevant for
   * carveStopCells = 0 and for the unconditional start-cell visit).
   */
  private carve(cameraCell: GridCell, pointCell: GridCell): void {
    bresenham3d(
      cameraCell,
      pointCell,
      (cell) => {
        if (!cellsEqual(cell, pointCell)) {
          // A carve removes a cell from the occupied set → a meaningful change.
          if (this.cells.delete(cellKey(cell))) {
            this.revision++;
          }
        }
        return true;
      },
      this.carveStopCells
    );
  }

  private increment(cell: GridCell, world: Vector3, rgb?: RgbTuple): void {
    const key = cellKey(cell);
    let record = this.cells.get(key);
    if (!record) {
      record = {
        cell,
        count: 0,
        posSum: [0, 0, 0],
        colorCount: 0,
        colorSum: [0, 0, 0],
      };
      this.cells.set(key, record);
    }
    record.count++;
    // Bump the revision while the cell could still cross some consumer's
    // minConfidence threshold (count ≤ 10 = the max selectable). Once it is past
    // that, re-observing it can change no occupied set, so it stays "settled" and
    // costs no re-mesh — the key long-session idle saving.
    if (record.count <= MAX_RELEVANT_COUNT) {
      this.revision++;
    }
    // Every observation carries a finite position (the unprojector guarantees
    // it), so it always feeds the running-average surface point.
    record.posSum[0] += world[0];
    record.posSum[1] += world[1];
    record.posSum[2] += world[2];
    // Only finite triples enter the average — bad persisted data degrades
    // to a color-less observation instead of poisoning the cell.
    if (rgb && isFiniteTriple(rgb)) {
      record.colorCount++;
      record.colorSum[0] += rgb[0];
      record.colorSum[1] += rgb[1];
      record.colorSum[2] += rgb[2];
    }
  }
}

// Numeric cell key — packs three integer coordinates into ONE safe-integer Map
// key, avoiding the per-lookup string allocation in the addSample / carve hot
// paths (one per point + one per carved cell). Three 17-bit fields keep the
// packed key under 2^53, so `|coord|` must be `≤ CELL_KEY_LIMIT`; at the 0.15 m
// default that spans ±9.8 km from the origin — far beyond any real session — and
// `addSample` skips points whose cell falls outside it, so every stored key is
// packable and collision-free.
const CELL_KEY_LIMIT = 65535;
const KEY_OFFSET = 65536; // 2^16 — shift a packable coordinate to non-negative
const KEY_FIELD = 131072; // 2^17 — width of one packed field
const KEY_FIELD_SQ = KEY_FIELD * KEY_FIELD; // 2^34

function cellInKeyRange(cell: GridCell): boolean {
  return (
    Math.abs(cell[0]) <= CELL_KEY_LIMIT &&
    Math.abs(cell[1]) <= CELL_KEY_LIMIT &&
    Math.abs(cell[2]) <= CELL_KEY_LIMIT
  );
}

function cellKey(cell: GridCell): number {
  return (
    (cell[0] + KEY_OFFSET) * KEY_FIELD_SQ +
    (cell[1] + KEY_OFFSET) * KEY_FIELD +
    (cell[2] + KEY_OFFSET)
  );
}

function cellsEqual(a: GridCell, b: GridCell): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isFiniteTriple(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}
