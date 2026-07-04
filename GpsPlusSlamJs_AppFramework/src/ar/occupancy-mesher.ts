/**
 * Occupancy Grid → Mesh (face-culled voxel surface + AABB list)
 *
 * Pure, dependency-free mesher for the sparse {@link OccupancyGrid}. Turns a
 * snapshot of occupied cells into:
 *  - a **face-culled** triangle surface (`positions` + `indices`, raw-WebXR
 *    metres) — only the faces whose neighbour cell is empty are emitted, so
 *    cost scales with the surface area of the occupied set, not its volume.
 *    This is the geometry the depth-only **occlusion** mesh and a **trimesh**
 *    physics collider consume.
 *  - an **AABB list** (one box per occupied cell) — the natural input for a
 *    **compound box collider**, the better voxel-physics fit (§3E of the plan).
 *
 * No THREE, no DOM, no Redux — the caller snapshots `getOccupiedCells(floor)`
 * and feeds the result here; a thin adapter wraps the typed arrays into a
 * `THREE.BufferGeometry` (and the output is transferable to a Web Worker).
 * Greedy quad/box merging is a separate follow-on optimisation.
 *
 * Design notes (see 2026-06-13-occupancy-mesh-options-plan.md, option B):
 * - Vertices are NOT shared between faces (4 verts/face). Simpler and keeps
 *   per-face winding trivially correct; the occluder/collider don't need a
 *   welded vertex buffer. A closed voxel surface is still watertight (every
 *   edge is covered an even number of times — see the property tests).
 * - Faces use outward CCW winding so a trimesh collider has consistent normals
 *   and the surface back-face culls correctly if ever rendered visibly.
 * - Cell centre is `cell · cellSizeM` (matching {@link OccupancyGrid.getCellCenter},
 *   round-quantization — NOT a half-cell offset), so a cube for cell `c` spans
 *   `[c·s − s/2, c·s + s/2]` per axis.
 *
 * @see occupancy-mesher.ts.md for detailed documentation
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { GridCell } from './bresenham3d';
import {
  HALF_LATTICE_CELL_KEY_LIMIT,
  packCellKey as cellKey,
} from './cell-key';

/**
 * An axis-aligned bounding box for one occupied cell (or, after greedy merge, a
 * run of cells), in raw-WebXR metres. The neutral form a developer adapts into
 * their physics engine's box collider — the framework adds no engine dependency.
 */
export interface Aabb {
  readonly center: readonly [number, number, number];
  readonly halfExtents: readonly [number, number, number];
}

/**
 * Output of {@link meshOccupiedCells}: a non-indexed-friendly triangle soup
 * (`positions`/`indices`, raw-WebXR metres) plus the per-cell AABB list. Typed
 * arrays so the result is cheap to hand to `THREE.BufferGeometry` or transfer
 * to a Web Worker.
 */
export interface OccupancyMeshResult {
  /** Flat `[x0,y0,z0, x1,y1,z1, …]` vertex positions, 4 verts per emitted quad. */
  readonly positions: Float32Array;
  /** Triangle indices into `positions` (2 triangles / 6 indices per quad). */
  readonly indices: Uint32Array;
  /** One AABB per unique occupied cell. */
  readonly aabbs: readonly Aabb[];
}

/**
 * Selectable mesher strategy (2026-06-30 occluder-tuning session). All modes are
 * simultaneously usable — none replaces another — so they can be perf/quality
 * compared and a consumer can pick per use-case:
 * - `'per-face'` — blocky, watertight, exact cell volume; the strict baseline.
 * - `'greedy'` — fewest triangles, blocky; coplanar-face merge for memory.
 * - `'smooth'` — standard surface nets (dual contouring): one welded vertex per
 *   boundary dual cell at the mean of its occupied corners' `getCellPoint`, with
 *   one quad per occupied↔empty crossing — so coverage matches the cubes.
 *   Continuous, hugs the measured surface, watertight for closed regions; a thin
 *   feature (the floor) collapses to a single smooth sheet (the smoothest mode),
 *   with only its single-occupied-corner dual vertices nudged apart so features
 *   thin in ≥2 dimensions keep a non-zero area (see SINGLE_CORNER_NUDGE_K).
 *   Uses `getCellPoint` to hug the surface (falls back to geometric centres).
 *
 * - `'corner-fit'` — the per-face cube mesher with each shared lattice corner
 *   nudged by the mean sub-cell offset (`getCellPoint − cellCentre`) of the cells
 *   touching it. Surface-hugging like `'smooth'` but **watertight** (identical
 *   face topology to `'per-face'`) and cube-thickness-preserving, at the per-face
 *   triangle cost. The "improve the cubes" path; needs `getCellPoint` (falls back
 *   to plain cubes without it).
 */
export type MeshMode = 'per-face' | 'greedy' | 'smooth' | 'corner-fit';

/** Options for {@link meshOccupiedCells}. */
export interface MeshOccupiedCellsOptions {
  /**
   * @deprecated Prefer {@link MeshOccupiedCellsOptions.mode}. Back-compat shim:
   * when `mode` is unset, `greedy:true` → `'greedy'`, otherwise `'per-face'`.
   * Kept so existing callers/tests keep working unchanged.
   */
  readonly greedy?: boolean;
  /**
   * The mesher strategy. Takes precedence over {@link greedy}. Default resolves
   * via the `greedy` shim above (so omitting both ⇒ `'per-face'`).
   *
   * Note: every mode still returns one `aabbs` box per cell (a 3-D greedy box
   * merge for fewer colliders is a separate follow-on — see the plan §3E).
   */
  readonly mode?: MeshMode;
  /**
   * Per-cell measured surface point (the `OccupancyGrid.getCellPoint` bound
   * method). Consumed by the surface-hugging modes `'smooth'` (dual vertex at the
   * mean of its occupied corners' centroids) and `'corner-fit'` (corners nudged
   * by the mean sub-cell offset) instead of the lattice centre. Ignored by
   * `'per-face'`/`'greedy'`. When absent, both fall back to geometric positions.
   * A `null` or non-finite result degrades that cell to its geometric position
   * too — a NaN/Infinity centroid must not poison welded vertices (and NaN is
   * the worker wire protocol's "no centroid" sentinel, so both paths agree).
   *
   * **Contract:** the `cell` tuple is only valid for the duration of the call —
   * the meshers pass a reused scratch tuple on their allocation-free hot paths
   * (PR #161 review), so implementations must read the coordinates and must NOT
   * retain the tuple (no caching it as a key, no async use). Copy it if needed.
   */
  readonly getCellPoint?: (cell: GridCell) => Vector3 | null;
}

/** Resolve the effective mesher mode from the (possibly legacy) options. */
function resolveMode(options: MeshOccupiedCellsOptions | undefined): MeshMode {
  if (options?.mode) {
    return options.mode;
  }
  return options?.greedy ? 'greedy' : 'per-face';
}

/** A coordinate-axis index into a {@link GridCell} / position triple. */
type Axis = 0 | 1 | 2;

/**
 * Right-handed cyclic axis assignment per face-normal axis `d`: `(d, u, v)`
 * with `eu × ev = ed`, so a `(uMin,vMin)→(uMax,vMin)→(uMax,vMax)→(uMin,vMax)`
 * quad has the `+d` outward normal (and the reverse order has `−d`). Used by the
 * greedy mesher to keep merged-quad winding consistent with the per-face path.
 */
const GREEDY_DIRS: readonly { d: Axis; u: Axis; v: Axis }[] = [
  { d: 0, u: 1, v: 2 },
  { d: 1, u: 2, v: 0 },
  { d: 2, u: 0, v: 1 },
];

/** Unit-cube face: a neighbour offset (cull test) + 4 outward-CCW corner signs. */
interface FaceSpec {
  /** Neighbour cell offset; the face is emitted iff that neighbour is empty. */
  readonly neighbour: readonly [number, number, number];
  /** Four corners as ±1 signs (×halfCell), already in outward-CCW order. */
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

/**
 * The six cube faces with outward (CCW-from-outside) winding. Corner signs are
 * ±1 multipliers of the half-cell extent. Triangulated as (0,1,2)+(0,2,3).
 */
const FACES: readonly FaceSpec[] = [
  // +X
  {
    neighbour: [1, 0, 0],
    corners: [
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [1, -1, 1],
    ],
  },
  // -X
  {
    neighbour: [-1, 0, 0],
    corners: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  // +Y
  {
    neighbour: [0, 1, 0],
    corners: [
      [-1, 1, -1],
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
    ],
  },
  // -Y
  {
    neighbour: [0, -1, 0],
    corners: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
  // +Z
  {
    neighbour: [0, 0, 1],
    corners: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  // -Z
  {
    neighbour: [0, 0, -1],
    corners: [
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [1, -1, -1],
    ],
  },
];

// Numeric cell key — the shared packed-key implementation (`cell-key.ts`, one
// packer for grid + meshers + worker since the 2026-07-04 consolidation),
// avoiding the per-lookup string allocation that dominated the mesher hot
// loops (millions of neighbour tests + vertex-weld lookups). The mesher uses
// the tighter HALF_LATTICE tier (±32 767): it also keys DERIVED coordinates —
// neighbours (±1), dual-cell bases (−1) and corner-fit half-lattice keys
// (`2·coord ± 1`) — which must stay inside the same 17-bit field. At 0.15 m
// cells the limit spans ±4.9 km — far beyond any real scene;
// `meshOccupiedCells` skips cells outside it (alongside the non-finite skip),
// guaranteeing every internal key is packable and collision-free.

/** Finite, integer, and within the packable key range on every axis.
 *  `Number.isInteger` subsumes the finiteness check (NaN/±Infinity are not
 *  integers) and rejects fractional coordinates, which the packed-key algebra
 *  cannot key safely (neighbour ±1 and half-lattice `2·coord ± 1` keys only
 *  coincide for integer cells). */
function isPackableCell(cell: GridCell): boolean {
  for (let i = 0; i < 3; i++) {
    const c = cell[i]!;
    if (!Number.isInteger(c) || Math.abs(c) > HALF_LATTICE_CELL_KEY_LIMIT) {
      return false;
    }
  }
  return true;
}

/** True iff all three components are finite. A non-finite measured centroid
 *  from `getCellPoint` (an upstream tracking/accumulation glitch) must degrade
 *  to the geometric fallback exactly like a `null` one — otherwise it poisons
 *  every welded vertex / shared corner that averages it, and it also breaks
 *  `runMeshRequest`'s byte-identical parity with a direct mesh (the worker wire
 *  protocol packs "no centroid" as NaN, so NaN already falls back off-thread). */
function isFiniteVector3(v: Vector3): boolean {
  return (
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
  );
}

/**
 * Mesh a snapshot of occupied cells into a face-culled surface + AABB list.
 *
 * Only faces whose neighbour cell is **not** in the occupied set are emitted
 * (interior faces are dropped), so the triangle count scales with the surface
 * area of the occupied set. Duplicate cells in `cells` are de-duplicated;
 * cells with a non-finite or non-integer coordinate are skipped defensively (a
 * tracking glitch upstream must not poison the mesh, and the packed cell keys
 * are only collision-safe for integer coordinates).
 *
 * @param cells     occupied cells (e.g. `grid.getOccupiedCells(minConfidence)`).
 * @param cellSizeM cube edge length in metres (must be a positive finite number).
 * @returns positions/indices (raw-WebXR metres) + one AABB per unique cell.
 */
export function meshOccupiedCells(
  cells: Iterable<GridCell>,
  cellSizeM: number,
  options?: MeshOccupiedCellsOptions
): OccupancyMeshResult {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError(
      `cellSizeM must be a positive number, got ${cellSizeM}`
    );
  }
  const half = cellSizeM / 2;

  // Snapshot into a Set for O(1) neighbour tests, de-duplicating and dropping
  // non-integer / out-of-range cells. Keep the de-duplicated cells in insertion
  // order for deterministic AABB / face emission.
  const occupied = new Set<number>();
  const uniqueCells: GridCell[] = [];
  for (const cell of cells) {
    if (!isPackableCell(cell)) {
      continue;
    }
    const key = cellKey(cell[0], cell[1], cell[2]);
    if (occupied.has(key)) {
      continue;
    }
    occupied.add(key);
    uniqueCells.push(cell);
  }

  // Every cell's halfExtents is identical (`[half, half, half]`); share one
  // frozen instance instead of allocating it per cell (the `Aabb` contract is
  // readonly, so sharing is safe). Halves the AABB-list allocations.
  const sharedHalfExtents: readonly [number, number, number] = Object.freeze([
    half,
    half,
    half,
  ]);
  const aabbs: Aabb[] = uniqueCells.map(([x, y, z]) => ({
    center: [x * cellSizeM, y * cellSizeM, z * cellSizeM],
    halfExtents: sharedHalfExtents,
  }));

  const positions: number[] = [];
  const indices: number[] = [];
  const mode = resolveMode(options);
  if (mode === 'greedy') {
    buildGreedy(occupied, uniqueCells, cellSizeM, positions, indices);
  } else if (mode === 'smooth') {
    buildSmooth(
      occupied,
      uniqueCells,
      cellSizeM,
      options?.getCellPoint,
      positions,
      indices
    );
  } else if (mode === 'corner-fit') {
    buildCornerFit(
      occupied,
      uniqueCells,
      cellSizeM,
      options?.getCellPoint,
      positions,
      indices
    );
  } else {
    buildCulled(occupied, uniqueCells, cellSizeM, positions, indices);
  }

  return {
    // `new Float32Array(arr)` is the idiomatic (and faster) construction from a
    // plain number[]; `.from` adds general-iterable + map-fn overhead for the
    // same bytes.
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    aabbs,
  };
}

/** Push a quad (4 corners, already ordered) as two triangles. */
/** Per-face culling: emit each exposed unit face as its own quad. */
function buildCulled(
  occupied: Set<number>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  for (const [x, y, z] of uniqueCells) {
    const cx = x * cellSizeM;
    const cy = y * cellSizeM;
    const cz = z * cellSizeM;
    for (const face of FACES) {
      const nx = x + face.neighbour[0];
      const ny = y + face.neighbour[1];
      const nz = z + face.neighbour[2];
      if (occupied.has(cellKey(nx, ny, nz))) {
        continue; // shared interior face — cull it
      }
      // Push the 4 corners directly (no per-face `.map()` array + sub-array
      // allocations — this is the per-cell hot path).
      const base = positions.length / 3;
      const corners = face.corners;
      for (let i = 0; i < 4; i++) {
        const c = corners[i]!;
        positions.push(cx + c[0] * half, cy + c[1] * half, cz + c[2] * half);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

/**
 * 'smooth' mode — **standard Naive Surface Nets (dual contouring)** over the
 * occupancy field, consuming the per-cell measured centroids the cube meshers
 * discard.
 *
 * Treats occupancy as a binary field sampled at integer cell coordinates and
 * contours the occupied/empty boundary:
 *  - **Vertices** — one welded vertex per "dual cell" (a unit cube whose 8
 *    corners are the cells `b … b+1`) that **straddles** the boundary (≥1
 *    occupied AND ≥1 empty corner), placed at the **mean of its occupied
 *    corners' `getCellPoint()`** (the measured surface points; the corners'
 *    geometric centres without a provider). Welding by dual-cell key makes the
 *    surface crack-free.
 *  - **Quads** — one per occupied↔empty **crossing**: for every occupied-cell
 *    face whose neighbour is empty (the SAME set the cube mesher emits), a quad
 *    joins the 4 dual cells sharing that edge, wound to face the empty side.
 *
 * Because there is one quad per crossing, **coverage matches the cubes** — unlike
 * the previous 2×2-fully-occupied-patch heuristic, which only meshed flat solid
 * blocks and so missed 80–90 % of a real, ragged depth surface (the reported
 * "barely any surfaces" bug; 2026-06-30 rewrite). The result is smooth (welded
 * vertices pulled onto the measured surface) and watertight for closed regions;
 * over a thin feature (a one-cell floor) the top and bottom dual vertices average
 * the same cells and coincide, so it reads as a single smooth sheet — the
 * smoothest of the modes. Exception: a dual cell with exactly ONE occupied
 * corner is nudged toward its dual-cell centre ({@link SINGLE_CORNER_NUDGE_K}),
 * so features thin in ≥2 dimensions (isolated voxels, line/pillar ends) keep a
 * non-zero area instead of collapsing onto a single point; on a thin floor this
 * puffs only the perimeter-corner vertices by ±0.25·cell.
 */
/**
 * 'smooth' single-occupied-corner fallback strength: a dual cell with exactly
 * one occupied corner places its vertex ON that corner's cell point, so every
 * dual cell around a feature thin in ≥2 dimensions (an isolated voxel, the end
 * of a 1-cell line/pillar) coincided with its neighbours → all-degenerate
 * (zero-area) triangles → thin features were invisible to the occluder despite
 * a full per-face triangle count. Nudging the `n === 1` vertex toward the
 * dual-cell centre by this fraction of the corner→centre distance (0.5 ⇒
 * ±0.25·cell per axis) keeps it a pure function of the dual cell, so welding /
 * watertightness and the measured-offset invariant are preserved. Trade-off
 * (accepted 2026-07-02): the `n === 1` perimeter corners of a thin floor (and
 * of a solid box) puff by ±0.25·cell — imperceptible for AR occlusion. Known
 * residual: the `n === 2` shaft rings of a long 1×1×N feature still collapse
 * (locally indistinguishable from a thin floor's intentionally-flat edges).
 * 0.25 was rejected as too close to imperceptibly-non-zero; 1.0 discards the
 * measured centroid exactly where data is sparsest. See
 * 2026-07-01-followup-smooth-mesher-single-corner-degeneracy.md.
 */
const SINGLE_CORNER_NUDGE_K = 0.5;

function buildSmooth(
  occupied: Set<number>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
  positions: number[],
  indices: number[]
): void {
  // Memoized per-cell surface point (measured centroid, or geometric centre as
  // fallback), keyed by the numeric cell key. Each occupied cell is a corner of
  // up to 8 dual cells, so without the cache `getCellPoint` would be re-invoked
  // ~8× per cell (each call also allocating its arg tuple + result). Resolve once.
  const pointCache = new Map<number, readonly [number, number, number]>();
  const scratch: [number, number, number] = [0, 0, 0];
  const cellPoint = (
    ckey: number,
    x: number,
    y: number,
    z: number
  ): readonly [number, number, number] => {
    const hit = pointCache.get(ckey);
    if (hit !== undefined) {
      return hit;
    }
    let p: readonly [number, number, number] = [
      x * cellSizeM,
      y * cellSizeM,
      z * cellSizeM,
    ];
    if (getCellPoint) {
      scratch[0] = x;
      scratch[1] = y;
      scratch[2] = z;
      const cp = getCellPoint(scratch);
      if (cp && isFiniteVector3(cp)) {
        p = [cp[0], cp[1], cp[2]];
      }
    }
    pointCache.set(ckey, p);
    return p;
  };

  // One welded vertex per boundary dual cell (key = its min-corner cell `b`),
  // created lazily and positioned at the mean of its OCCUPIED corner cells'
  // measured surface points.
  const vertexIndex = new Map<number, number>();
  const dualVertex = (bx: number, by: number, bz: number): number => {
    const dkey = cellKey(bx, by, bz);
    const existing = vertexIndex.get(dkey);
    if (existing !== undefined) {
      return existing;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    // Local offset of the (last seen) occupied corner within the dual cell —
    // only consumed when n === 1, where it identifies THE single corner.
    let odx = 0;
    let ody = 0;
    let odz = 0;
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const cx = bx + dx;
          const cy = by + dy;
          const cz = bz + dz;
          const ckey = cellKey(cx, cy, cz);
          if (!occupied.has(ckey)) {
            continue;
          }
          const p = cellPoint(ckey, cx, cy, cz);
          sx += p[0];
          sy += p[1];
          sz += p[2];
          n += 1;
          odx = dx;
          ody = dy;
          odz = dz;
        }
      }
    }
    // n ≥ 1: a dual vertex is only requested for a boundary dual cell, which by
    // construction has at least one occupied corner (the crossing's solid side).
    let px = sx / n;
    let py = sy / n;
    let pz = sz / n;
    if (n === 1) {
      // Single-corner fallback: pull the vertex off the lone cell point toward
      // the dual-cell centre so neighbouring dual vertices no longer coincide
      // (see SINGLE_CORNER_NUDGE_K above for the full rationale/trade-off).
      const nudge = cellSizeM * SINGLE_CORNER_NUDGE_K;
      px += (0.5 - odx) * nudge;
      py += (0.5 - ody) * nudge;
      pz += (0.5 - odz) * nudge;
    }
    const idx = positions.length / 3;
    positions.push(px, py, pz);
    vertexIndex.set(dkey, idx);
    return idx;
  };

  // One quad per occupied↔empty crossing (== the cube mesher's exposed faces).
  // For an occupied cell C with an empty neighbour along d·sgn, the four dual
  // cells sharing the (C, neighbour) edge have `base_d = (sgn>0 ? C_d : C_d−1)`
  // and `base_{u,v} ∈ {C−1, C}`; they are wound to face the empty side.
  // Reused scratch tuples — mutated in place, read immediately, so the
  // per-cell loop allocates nothing (`c` is the axis-indexable view of the
  // current cell; `dualBase` is the dual-cell base fed to dualVertex).
  const dualBase: [number, number, number] = [0, 0, 0];
  const c: [number, number, number] = [0, 0, 0];
  for (const cell of uniqueCells) {
    c[0] = cell[0];
    c[1] = cell[1];
    c[2] = cell[2];
    for (const { d, u, v } of GREEDY_DIRS) {
      for (let sgn = 1; sgn >= -1; sgn -= 2) {
        const nbd = c[d] + sgn;
        // crossing iff the neighbour along d·sgn is empty
        dualBase[d] = nbd;
        dualBase[u] = c[u];
        dualBase[v] = c[v];
        if (occupied.has(cellKey(dualBase[0], dualBase[1], dualBase[2]))) {
          continue; // interior face — no crossing here
        }
        const baseD = sgn > 0 ? c[d] : c[d] - 1;
        const bu0 = c[u] - 1;
        const bv0 = c[v] - 1;
        // The four dual cells sharing this edge, at (u,v) base offsets A(0,0)
        // B(1,0) C(1,1) D(0,1). dualBase is reused (d fixed, u,v set per corner).
        dualBase[d] = baseD;
        dualBase[u] = bu0;
        dualBase[v] = bv0;
        const iA = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        dualBase[u] = bu0 + 1;
        const iB = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        dualBase[v] = bv0 + 1;
        const iC = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        dualBase[u] = bu0;
        const iD = dualVertex(dualBase[0], dualBase[1], dualBase[2]);
        // +d faces CCW as A→B→C→D; −d reverses to A→D→C→B.
        if (sgn > 0) {
          indices.push(iA, iB, iC, iA, iC, iD);
        } else {
          indices.push(iA, iD, iC, iA, iC, iB);
        }
      }
    }
  }
}

/**
 * 'corner-fit' mode — the per-face cube mesher with **displaced shared corners**.
 *
 * Keeps {@link buildCulled}'s exact face topology (same exposed faces), but each
 * lattice corner — identified by its integer half-lattice key `(2x±1, 2y±1,
 * 2z±1)` so every cell sharing it produces the SAME key — is **nudged by the mean
 * sub-cell offset** (`getCellPoint() − cellCentre`) of the occupied cells
 * touching it. Vertices are welded by corner key, so adjacent faces reference the
 * identical displaced position: seams stay coincident ⇒ the surface deforms to
 * hug the measured points yet stays **watertight** (the even-edge-cover invariant
 * `'smooth'` gives up). Without a `getCellPoint` provider every corner falls back
 * to the geometric corner `key · cellSize/2`, i.e. plain cubes.
 *
 * Why the **offset**, not the absolute centroid mean (2026-06-30 fix): moving a
 * corner onto the absolute mean collapsed thin features — a one-cell-thick floor's
 * top and bottom corners average the SAME cells, so they coincided into a flat
 * sheet visually indistinguishable from `'smooth'`. Adding the offset to each
 * corner's OWN geometric position keeps the cube's thickness, so `'corner-fit'`
 * stays a distinct, cube-like, watertight option.
 *
 * Tradeoffs vs `'smooth'`: watertight and exact-cube topology, but corners are
 * 8-way averages (so geometry only *approaches* the measured points, never lands
 * on them) and the per-face O(surface-area) triangle cost is unchanged. Greedy
 * merging does not apply (displaced corners are non-coplanar).
 */
function buildCornerFit(
  occupied: Set<number>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  // Pass 1: accumulate the mean **sub-cell offset** (getCellPoint − cellCentre)
  // per shared corner (half-lattice key). Displacing by the offset — NOT onto the
  // absolute centroid — is what keeps a thin (one-cell) feature from collapsing:
  // a 1-cell floor's top and bottom corners average the same cells, so the
  // absolute-centroid mean made them coincide (a flat sheet indistinguishable
  // from surface nets). Adding the offset to each corner's own geometric position
  // preserves the cube's thickness while still hugging the measured surface.
  const cornerSum = new Map<
    number,
    { x: number; y: number; z: number; n: number }
  >();
  const addCornerOffset = (
    key: number,
    ox: number,
    oy: number,
    oz: number
  ): void => {
    let acc = cornerSum.get(key);
    if (!acc) {
      acc = { x: 0, y: 0, z: 0, n: 0 };
      cornerSum.set(key, acc);
    }
    acc.x += ox;
    acc.y += oy;
    acc.z += oz;
    acc.n += 1;
  };
  for (const cell of uniqueCells) {
    const cp = getCellPoint ? getCellPoint(cell) : null;
    if (!cp || !isFiniteVector3(cp)) {
      continue;
    }
    // Offset of the measured centroid from this cell's geometric centre.
    const ox = cp[0] - cell[0] * cellSizeM;
    const oy = cp[1] - cell[1] * cellSizeM;
    const oz = cp[2] - cell[2] * cellSizeM;
    // Numeric sign loops (−1, +1): allocation-free per cell, unlike iterating
    // fresh `[-1, 1]` array literals (7 arrays per contributing cell).
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          addCornerOffset(
            cellKey(2 * cell[0] + sx, 2 * cell[1] + sy, 2 * cell[2] + sz),
            ox,
            oy,
            oz
          );
        }
      }
    }
  }

  // Welded vertex per corner key (lazy) — geometric corner + mean offset, or the
  // bare geometric corner when no cell contributed an offset (plain cubes).
  const vertexIndex = new Map<number, number>();
  const cornerVertex = (kx: number, ky: number, kz: number): number => {
    const key = cellKey(kx, ky, kz);
    const existing = vertexIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const acc = cornerSum.get(key);
    // geometric corner = key · half; nudge it by the mean sub-cell offset.
    const px = kx * half + (acc ? acc.x / acc.n : 0);
    const py = ky * half + (acc ? acc.y / acc.n : 0);
    const pz = kz * half + (acc ? acc.z / acc.n : 0);
    const idx = positions.length / 3;
    positions.push(px, py, pz);
    vertexIndex.set(key, idx);
    return idx;
  };

  // Pass 2: identical culling to buildCulled; emit each exposed face as a
  // welded quad over its four (displaced) corner vertices.
  for (const [x, y, z] of uniqueCells) {
    for (const face of FACES) {
      const nx = x + face.neighbour[0];
      const ny = y + face.neighbour[1];
      const nz = z + face.neighbour[2];
      if (occupied.has(cellKey(nx, ny, nz))) {
        continue; // shared interior face — cull it
      }
      // Look up the 4 (displaced) corner vertices directly — no per-face `.map()`
      // allocation. Standard quad winding: triangles (0,1,2)+(0,2,3).
      const corners = face.corners;
      const x2 = 2 * x;
      const y2 = 2 * y;
      const z2 = 2 * z;
      const c0 = corners[0];
      const c1 = corners[1];
      const c2 = corners[2];
      const c3 = corners[3];
      const v0 = cornerVertex(x2 + c0[0], y2 + c0[1], z2 + c0[2]);
      const v1 = cornerVertex(x2 + c1[0], y2 + c1[1], z2 + c1[2]);
      const v2 = cornerVertex(x2 + c2[0], y2 + c2[1], z2 + c2[2]);
      const v3 = cornerVertex(x2 + c3[0], y2 + c3[1], z2 + c3[2]);
      indices.push(v0, v1, v2, v0, v2, v3);
    }
  }
}

/**
 * Greedy meshing: for each face-normal axis and side, sweep slices and merge
 * adjacent coplanar exposed faces into maximal rectangles, emitting one quad
 * per rectangle. The covered unit faces are identical to {@link buildCulled};
 * only the triangle count drops.
 */
function buildGreedy(
  occupied: Set<number>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  // Reused neighbour scratch — written and read immediately per cell, so the
  // exposure probe allocates nothing (6 probes per cell across axes × signs).
  const neighbour: [number, number, number] = [0, 0, 0];
  for (const { d, u, v } of GREEDY_DIRS) {
    for (let sign = 1; sign >= -1; sign -= 2) {
      // Group exposed (iu,iv) cells by slice index k = cell[d].
      const slices = new Map<number, Map<number, readonly [number, number]>>();
      for (const cell of uniqueCells) {
        neighbour[0] = cell[0];
        neighbour[1] = cell[1];
        neighbour[2] = cell[2];
        neighbour[d] += sign;
        if (occupied.has(cellKey(neighbour[0], neighbour[1], neighbour[2]))) {
          continue; // interior face on this side
        }
        const k = cell[d];
        const iu = cell[u];
        const iv = cell[v];
        let slice = slices.get(k);
        if (!slice) {
          slice = new Map();
          slices.set(k, slice);
        }
        slice.set(cellKey(iu, iv, 0), [iu, iv]);
      }
      for (const [k, slice] of [...slices.entries()].sort(
        (a, b) => a[0] - b[0]
      )) {
        greedyMergeSlice(
          slice,
          half,
          cellSizeM,
          d,
          u,
          v,
          k,
          sign,
          positions,
          indices
        );
      }
    }
  }
}

/** Greedy-merge one slice's exposed (iu,iv) mask into maximal rectangles. */
function greedyMergeSlice(
  slice: ReadonlyMap<number, readonly [number, number]>,
  half: number,
  cellSizeM: number,
  d: Axis,
  u: Axis,
  v: Axis,
  k: number,
  sign: number,
  positions: number[],
  indices: number[]
): void {
  const has = (iu: number, iv: number): boolean =>
    slice.has(cellKey(iu, iv, 0));
  const used = new Set<number>();
  const isUsed = (iu: number, iv: number): boolean =>
    used.has(cellKey(iu, iv, 0));
  // Reused corner scratch (axis-indexable) — the quad emission below mutates
  // only its u/v components between pushes, so rectangles allocate nothing.
  const p: [number, number, number] = [0, 0, 0];
  // Deterministic order: by iv (outer) then iu (inner), both ascending.
  const cells = [...slice.values()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]
  );
  for (const [iu, iv] of cells) {
    if (isUsed(iu, iv)) {
      continue;
    }
    // Grow width along +u while cells exist and are unused.
    let w = 1;
    while (has(iu + w, iv) && !isUsed(iu + w, iv)) {
      w++;
    }
    // Grow height along +v while every cell of the next row is present/unused.
    let h = 1;
    let canGrow = true;
    while (canGrow) {
      for (let du = 0; du < w; du++) {
        if (has(iu + du, iv + h) && !isUsed(iu + du, iv + h)) {
          continue;
        }
        canGrow = false;
        break;
      }
      if (canGrow) {
        h++;
      }
    }
    for (let dv = 0; dv < h; dv++) {
      for (let du = 0; du < w; du++) {
        used.add(cellKey(iu + du, iv + dv, 0));
      }
    }
    const plane = k * cellSizeM + sign * half;
    const uMin = iu * cellSizeM - half;
    const uMax = (iu + w - 1) * cellSizeM + half;
    const vMin = iv * cellSizeM - half;
    const vMax = (iv + h - 1) * cellSizeM + half;
    // Emit the quad's 4 corners directly via the scratch (winding as before:
    // +d side CCW (uMin,vMin)→(uMax,vMin)→(uMax,vMax)→(uMin,vMax); −d reversed),
    // then the two triangles (0,1,2)+(0,2,3) over them.
    const base = positions.length / 3;
    p[d] = plane;
    p[u] = uMin;
    p[v] = vMin;
    positions.push(p[0], p[1], p[2]);
    if (sign > 0) {
      p[u] = uMax;
      positions.push(p[0], p[1], p[2]);
      p[v] = vMax;
      positions.push(p[0], p[1], p[2]);
      p[u] = uMin;
      positions.push(p[0], p[1], p[2]);
    } else {
      p[v] = vMax;
      positions.push(p[0], p[1], p[2]);
      p[u] = uMax;
      positions.push(p[0], p[1], p[2]);
      p[v] = vMin;
      positions.push(p[0], p[1], p[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
