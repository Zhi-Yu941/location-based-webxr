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
   * Chunk index (Step 2 of the 2026-07-03 long-session fps plan): cell keys
   * grouped by {@link CHUNK_EDGE_CELLS}³ chunk, maintained incrementally on
   * add/carve/clear (O(1) per mutation). Lets {@link getOccupiedCellsWithin}
   * visit only the chunks a query sphere touches — cost independent of total
   * explored area. Empty chunk sets are dropped.
   */
  private readonly chunks = new Map<number, Set<number>>();
  /**
   * Per-chunk dirty revision, bumped whenever a mutation inside the chunk
   * could change some consumer's occupied set (same semantics as the global
   * {@link revision}). This is the bookkeeping a future dirty-chunk remesh
   * needs (2026-07-01 worker plan, Phase-2 sketch) — landed with the index so
   * that plan becomes a consumer-side change only. Entries survive a chunk
   * emptying (a consumer must still see "changed"); reset by {@link clear}.
   */
  private readonly chunkRevisions = new Map<number, number>();
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
  /**
   * Memo of the last {@link getOccupiedCells} walk (Step 1.2 of the
   * 2026-07-03 long-session fps plan): with cubes + occluder both on, every
   * throttled refresh triggers two identical full-grid walks with the same
   * minConfidence floor — the second is answered from here. Valid only while
   * `revision` is unchanged, so it is only used for floors the revision
   * counter actually tracks (≤ {@link MAX_RELEVANT_COUNT}).
   */
  private snapshotCache: {
    revision: number;
    minObservations: number;
    cells: GridCell[];
  } | null = null;

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

  /**
   * Occupied cells observed at least `minObservations` times (default 1).
   *
   * The result is a **shared immutable snapshot**: a repeated call with the
   * same floor on an unchanged grid returns the SAME array instance (the
   * memo above), so callers must never mutate it. Floors above
   * {@link MAX_RELEVANT_COUNT} bypass the memo — the revision counter does
   * not track their threshold crossings, so a cached result could go stale.
   */
  getOccupiedCells(minObservations = 1): GridCell[] {
    const cache = this.snapshotCache;
    if (
      cache &&
      cache.revision === this.revision &&
      cache.minObservations === minObservations
    ) {
      return cache.cells;
    }
    const result: GridCell[] = [];
    for (const record of this.cells.values()) {
      if (record.count >= minObservations) {
        result.push(record.cell);
      }
    }
    if (minObservations <= MAX_RELEVANT_COUNT) {
      this.snapshotCache = {
        revision: this.revision,
        minObservations,
        cells: result,
      };
    }
    return result;
  }

  /**
   * Flat `[x0,y0,z0, x1,y1,z1, …]` variant of {@link getOccupiedCells} for the
   * mesh-worker pack path (Step 1.3 of the 2026-07-03 long-session fps plan):
   * `packMeshRequest` ships the snapshot to the worker as a transferable
   * Int32Array, so handing it over flat deletes the tuple-array intermediate
   * it used to re-flatten. Same cells, same order as the tuple API.
   *
   * Unlike {@link getOccupiedCells} this returns a **fresh array every call**
   * — the pack path TRANSFERS the buffer to the worker (detaching it), so a
   * shared/cached array would be destroyed under the grid. When the tuple
   * memo is warm (the cubes refresh just snapshotted the same floor) the
   * fresh array is flattened from it in O(matching cells) without a re-walk.
   */
  getOccupiedCellsFlat(minObservations = 1): Int32Array {
    const cache = this.snapshotCache;
    if (
      cache &&
      cache.revision === this.revision &&
      cache.minObservations === minObservations
    ) {
      const cells = cache.cells;
      const flat = new Int32Array(cells.length * 3);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        flat[i * 3] = c[0];
        flat[i * 3 + 1] = c[1];
        flat[i * 3 + 2] = c[2];
      }
      return flat;
    }
    // Cold path: one Map walk into a worst-case-sized buffer, trimmed at the
    // end (a slice copy of the used prefix beats a second counting walk).
    const flat = new Int32Array(this.cells.size * 3);
    let used = 0;
    for (const record of this.cells.values()) {
      if (record.count >= minObservations) {
        const c = record.cell;
        flat[used] = c[0];
        flat[used + 1] = c[1];
        flat[used + 2] = c[2];
        used += 3;
      }
    }
    return used === flat.length ? flat : flat.slice(0, used);
  }

  /**
   * Occupied cells (≥ `minObservations`) whose **centers** lie within
   * `radiusM` of `centerPos` — the viewer-local window that keeps consumer
   * refresh cost independent of total explored area (Step 2 of the
   * 2026-07-03 long-session fps plan). Walks only the chunks whose
   * cell-center AABB intersects the query sphere; chunks entirely inside it
   * skip the per-cell distance test. Result set ≡ the brute-force radius
   * filter of {@link getOccupiedCells} (property-tested; iteration order may
   * differ). Fresh array per call (no memo — the camera moves every frame).
   *
   * @throws RangeError for a non-finite or non-positive `radiusM` (a
   *   windowed query without a window is an upstream bug). A non-finite
   *   `centerPos` (tracking glitch) returns `[]` instead — mirrors
   *   {@link raycast}'s non-finite policy.
   */
  getOccupiedCellsWithin(
    centerPos: Vector3,
    radiusM: number,
    minObservations = 1
  ): GridCell[] {
    const result: GridCell[] = [];
    this.forEachOccupiedCellWithin(
      centerPos,
      radiusM,
      minObservations,
      (record) => {
        result.push(record.cell);
      }
    );
    return result;
  }

  /**
   * Flat `[x0,y0,z0, …]` variant of {@link getOccupiedCellsWithin} for the
   * mesh-worker pack path (same contract as {@link getOccupiedCellsFlat}:
   * fresh array every call — packing transfers/detaches the buffer).
   */
  getOccupiedCellsWithinFlat(
    centerPos: Vector3,
    radiusM: number,
    minObservations = 1
  ): Int32Array {
    const coords: number[] = [];
    this.forEachOccupiedCellWithin(
      centerPos,
      radiusM,
      minObservations,
      (record) => {
        coords.push(record.cell[0], record.cell[1], record.cell[2]);
      }
    );
    return Int32Array.from(coords);
  }

  /**
   * Per-chunk dirty revision (see the field docs): 0 for a never-touched
   * chunk. `chunk` is in chunk coordinates (`floor(cell / 16)` per axis).
   */
  getChunkRevision(chunk: GridCell): number {
    return (
      this.chunkRevisions.get(chunkKeyOf(chunk[0], chunk[1], chunk[2])) ?? 0
    );
  }

  /** Shared sphere-window walk behind the tuple and flat queries. */
  private forEachOccupiedCellWithin(
    centerPos: Vector3,
    radiusM: number,
    minObservations: number,
    visit: (record: CellRecord) => void
  ): void {
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new RangeError(
        `radiusM must be a positive finite number, got ${radiusM}`
      );
    }
    if (!isFiniteTriple(centerPos)) {
      return;
    }
    const cs = this.cellSizeM;
    const r2 = radiusM * radiusM;
    // fp-safety margins for the CHUNK shortcuts only: skip a chunk only when
    // it is clearly beyond the sphere, and skip the per-cell test only when
    // the chunk is clearly inside — boundary chunks always get the exact
    // per-cell test, which uses the same arithmetic as the brute-force
    // reference so the results are identical.
    const skipBeyond = (radiusM + cs * 1e-9) ** 2;
    const wholeInsideR2 = (radiusM - cs * 1e-9) ** 2;
    for (const [chunkKey, cellKeys] of this.chunks) {
      // AABB of the chunk's CELL CENTERS in meters: [b·cs, (b+15)·cs] per axis.
      const bx = unpackChunkCoord(chunkKey, 0) * CHUNK_EDGE_CELLS * cs;
      const by = unpackChunkCoord(chunkKey, 1) * CHUNK_EDGE_CELLS * cs;
      const bz = unpackChunkCoord(chunkKey, 2) * CHUNK_EDGE_CELLS * cs;
      const extent = (CHUNK_EDGE_CELLS - 1) * cs;
      let dMin2 = 0;
      let dMax2 = 0;
      for (let axis = 0; axis < 3; axis++) {
        const lo = axis === 0 ? bx : axis === 1 ? by : bz;
        const hi = lo + extent;
        const v = centerPos[axis]!;
        const below = lo - v;
        const above = v - hi;
        const dMin = Math.max(below, above, 0);
        dMin2 += dMin * dMin;
        const dMax = Math.max(Math.abs(v - lo), Math.abs(hi - v));
        dMax2 += dMax * dMax;
      }
      if (dMin2 > skipBeyond) {
        continue; // clearly outside the sphere
      }
      const wholeInside = dMax2 <= wholeInsideR2;
      for (const key of cellKeys) {
        const record = this.cells.get(key);
        // Defensive: the index and the cell map are updated together, so a
        // missing record would be an internal inconsistency — skip it rather
        // than crash a render tick.
        if (!record || record.count < minObservations) {
          continue;
        }
        if (!wholeInside) {
          const c = record.cell;
          const dx = c[0] * cs - centerPos[0];
          const dy = c[1] * cs - centerPos[1];
          const dz = c[2] * cs - centerPos[2];
          if (dx * dx + dy * dy + dz * dz > r2) {
            continue;
          }
        }
        visit(record);
      }
    }
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
    this.chunks.clear();
    this.chunkRevisions.clear();
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
          const key = cellKey(cell);
          if (this.cells.delete(key)) {
            this.revision++;
            this.unindexCell(cell, key);
          }
        }
        return true;
      },
      this.carveStopCells
    );
  }

  /** Add a newly-occupied cell to its chunk's index set. */
  private indexCell(cell: GridCell, key: number): void {
    const ck = chunkKeyOf(
      Math.floor(cell[0] / CHUNK_EDGE_CELLS),
      Math.floor(cell[1] / CHUNK_EDGE_CELLS),
      Math.floor(cell[2] / CHUNK_EDGE_CELLS)
    );
    let set = this.chunks.get(ck);
    if (!set) {
      set = new Set<number>();
      this.chunks.set(ck, set);
    }
    set.add(key);
  }

  /** Remove a carved cell from its chunk (dropping an emptied chunk set). */
  private unindexCell(cell: GridCell, key: number): void {
    const ck = chunkKeyOf(
      Math.floor(cell[0] / CHUNK_EDGE_CELLS),
      Math.floor(cell[1] / CHUNK_EDGE_CELLS),
      Math.floor(cell[2] / CHUNK_EDGE_CELLS)
    );
    const set = this.chunks.get(ck);
    if (set) {
      set.delete(key);
      if (set.size === 0) {
        this.chunks.delete(ck);
      }
    }
    this.bumpChunkRevision(ck);
  }

  /** Mirror of the global revision bump, scoped to one chunk. */
  private bumpChunkRevision(chunkKey: number): void {
    this.chunkRevisions.set(
      chunkKey,
      (this.chunkRevisions.get(chunkKey) ?? 0) + 1
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
      this.indexCell(cell, key);
    }
    record.count++;
    // Bump the revision while the cell could still cross some consumer's
    // minConfidence threshold (count ≤ 10 = the max selectable). Once it is past
    // that, re-observing it can change no occupied set, so it stays "settled" and
    // costs no re-mesh — the key long-session idle saving.
    if (record.count <= MAX_RELEVANT_COUNT) {
      this.revision++;
      this.bumpChunkRevision(
        chunkKeyOf(
          Math.floor(cell[0] / CHUNK_EDGE_CELLS),
          Math.floor(cell[1] / CHUNK_EDGE_CELLS),
          Math.floor(cell[2] / CHUNK_EDGE_CELLS)
        )
      );
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

// --- Chunk index (Step 2 of the 2026-07-03 long-session fps plan) ---
// Chunks are CHUNK_EDGE_CELLS³ cell groups (16³ = 2.4 m at the 0.15 m default,
// per the plan's sizing note). With |cell| ≤ 65 535, chunk coordinates are
// within ±4096, so three 13-bit fields pack into one safe-integer key using
// the same scheme as `cellKey`.
const CHUNK_EDGE_CELLS = 16;
const CHUNK_KEY_OFFSET = 4096; // 2^12
const CHUNK_KEY_FIELD = 8192; // 2^13
const CHUNK_KEY_FIELD_SQ = CHUNK_KEY_FIELD * CHUNK_KEY_FIELD; // 2^26

function chunkKeyOf(cx: number, cy: number, cz: number): number {
  return (
    (cx + CHUNK_KEY_OFFSET) * CHUNK_KEY_FIELD_SQ +
    (cy + CHUNK_KEY_OFFSET) * CHUNK_KEY_FIELD +
    (cz + CHUNK_KEY_OFFSET)
  );
}

/** Inverse of {@link chunkKeyOf} for one axis (0 = x, 1 = y, 2 = z). */
function unpackChunkCoord(key: number, axis: 0 | 1 | 2): number {
  if (axis === 0) {
    return Math.floor(key / CHUNK_KEY_FIELD_SQ) - CHUNK_KEY_OFFSET;
  }
  if (axis === 1) {
    return (
      (Math.floor(key / CHUNK_KEY_FIELD) % CHUNK_KEY_FIELD) - CHUNK_KEY_OFFSET
    );
  }
  return (key % CHUNK_KEY_FIELD) - CHUNK_KEY_OFFSET;
}

function cellsEqual(a: GridCell, b: GridCell): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isFiniteTriple(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}
