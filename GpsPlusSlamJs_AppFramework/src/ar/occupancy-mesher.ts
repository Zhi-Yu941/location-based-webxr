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
 * - `'smooth'` — surface nets: one welded vertex per occupied surface cell at
 *   its measured centroid (`getCellPoint`); continuous, closest to the measured
 *   surface, typically fewest triangles, but an **open** sheet over thin
 *   features (the floor) — not closed. Requires `getCellPoint` to hug the
 *   surface (falls back to the cell centre = plain surface nets without it).
 *
 * - `'corner-fit'` — the per-face cube mesher with each shared lattice corner
 *   moved to the mean of `getCellPoint` over the occupied cells touching it.
 *   Surface-hugging like `'smooth'` but **watertight** (identical face topology
 *   to `'per-face'`), at the per-face triangle cost. The "improve the cubes"
 *   path; needs `getCellPoint` (falls back to plain cubes without it).
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
   * method). Consumed by the surface-hugging modes `'smooth'` (vertex AT the
   * centroid) and `'corner-fit'` (corners at the centroid mean) instead of the
   * lattice centre. Ignored by `'per-face'`/`'greedy'`. When absent, `'smooth'`
   * falls back to the cell centre and `'corner-fit'` to the geometric corner.
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

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function isFiniteCell(cell: GridCell): boolean {
  return (
    Number.isFinite(cell[0]) &&
    Number.isFinite(cell[1]) &&
    Number.isFinite(cell[2])
  );
}

/**
 * Mesh a snapshot of occupied cells into a face-culled surface + AABB list.
 *
 * Only faces whose neighbour cell is **not** in the occupied set are emitted
 * (interior faces are dropped), so the triangle count scales with the surface
 * area of the occupied set. Duplicate cells in `cells` are de-duplicated;
 * cells with a non-finite coordinate are skipped defensively (a tracking glitch
 * upstream must not poison the mesh).
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
  // non-finite cells. Keep the de-duplicated, finite cells in insertion order
  // for deterministic AABB / face emission.
  const occupied = new Set<string>();
  const uniqueCells: GridCell[] = [];
  for (const cell of cells) {
    if (!isFiniteCell(cell)) {
      continue;
    }
    const key = cellKey(cell[0], cell[1], cell[2]);
    if (occupied.has(key)) {
      continue;
    }
    occupied.add(key);
    uniqueCells.push(cell);
  }

  const aabbs: Aabb[] = uniqueCells.map(([x, y, z]) => ({
    center: [x * cellSizeM, y * cellSizeM, z * cellSizeM],
    halfExtents: [half, half, half],
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
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    aabbs,
  };
}

/** Push a quad (4 corners, already ordered) as two triangles. */
function pushQuad(
  positions: number[],
  indices: number[],
  corners: readonly [number, number, number][]
): void {
  const base = positions.length / 3;
  for (const [px, py, pz] of corners) {
    positions.push(px, py, pz);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Per-face culling: emit each exposed unit face as its own quad. */
function buildCulled(
  occupied: Set<string>,
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
      pushQuad(
        positions,
        indices,
        face.corners.map(([sx, sy, sz]) => [
          cx + sx * half,
          cy + sy * half,
          cz + sz * half,
        ])
      );
    }
  }
}

/** A new cell shifted by `delta` along `axis` (the other two coords unchanged). */
function stepAxis(cell: GridCell, axis: Axis, delta: number): GridCell {
  const out: [number, number, number] = [cell[0], cell[1], cell[2]];
  out[axis] += delta;
  return out;
}

/** True iff EVERY cell in `group` has an empty neighbour on the `sign`·`axis` side. */
function sideIsEmpty(
  occupied: Set<string>,
  group: readonly GridCell[],
  axis: Axis,
  sign: 1 | -1
): boolean {
  for (const c of group) {
    const n = stepAxis(c, axis, sign);
    if (occupied.has(cellKey(n[0], n[1], n[2]))) {
      return false;
    }
  }
  return true;
}

/**
 * 'smooth' mode — a minimal **Naive Surface Nets** pass that consumes the
 * per-cell measured centroid the cube meshers discard.
 *
 * One **welded** vertex is placed per occupied cell that participates in the
 * surface, AT `getCellPoint(cell)` (the measured centroid, within `cellSize/2`
 * of the cell centre) — or the cell centre when no provider is given (plain
 * surface nets). Welding (a cell→vertex-index map) makes the sheet **crack-free**
 * by construction: adjacent quads reference the same vertex index, so there are
 * no coincident-but-duplicated boundary vertices and no occlusion-leaking
 * cracks.
 *
 * Faces are emitted as the **dual of coplanar surface patches**: for each axis
 * `d` and each coplanar 2×2 group of occupied cells (sharing a lattice edge
 * parallel to `d`), a single quad over the four cells' vertices is emitted iff
 * one `d`-side of the group is exposed (all four `+d` OR all four `−d`
 * neighbours empty). A one-cell-thick slab (the floor) is exposed on BOTH sides
 * but still yields ONE quad per group — an **open** sheet hugging the measured
 * surface, NOT a closed shell (so the cube mesher's even-edge-cover invariant is
 * deliberately unsatisfiable here; crack-free welding, not closedness, is what
 * prevents leaks). A thick solid yields a top sheet, a bottom sheet and side
 * sheets — closed where the geometry is thick.
 *
 * SCOPE: this connects coplanar surface cells, so flat/convex exposed surfaces
 * (the floor — the motivating case) are fully tiled. Bridging the **concave
 * seam** where two perpendicular surfaces meet (wall-meets-floor) is left to the
 * deferred full QEF/dual-contouring solver. The output occludes LESS volume than
 * the cubes (vertices sit inside the union-of-cubes hull) but hugs the measured
 * surface more accurately — by design.
 */
function buildSmooth(
  occupied: Set<string>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
  positions: number[],
  indices: number[]
): void {
  // Lazy welded vertex per cell — only cells that actually bound an emitted quad
  // get a vertex, so there are no orphan vertices.
  const vertexIndex = new Map<string, number>();
  const vertexFor = (cell: GridCell): number => {
    const key = cellKey(cell[0], cell[1], cell[2]);
    const existing = vertexIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const cp = getCellPoint ? getCellPoint(cell) : null;
    const px = cp ? cp[0] : cell[0] * cellSizeM;
    const py = cp ? cp[1] : cell[1] * cellSizeM;
    const pz = cp ? cp[2] : cell[2] * cellSizeM;
    const idx = positions.length / 3;
    positions.push(px, py, pz);
    vertexIndex.set(key, idx);
    return idx;
  };

  for (const { d, u, v } of GREEDY_DIRS) {
    for (const c0 of uniqueCells) {
      // Treat c0 as the (u−,v−) min corner of a coplanar 2×2 group in the ⊥d
      // plane; each group is reached exactly once (from its min corner).
      const c1 = stepAxis(c0, u, 1);
      const c2 = stepAxis(c0, v, 1);
      const c3 = stepAxis(c1, v, 1);
      if (
        !occupied.has(cellKey(c1[0], c1[1], c1[2])) ||
        !occupied.has(cellKey(c2[0], c2[1], c2[2])) ||
        !occupied.has(cellKey(c3[0], c3[1], c3[2]))
      ) {
        continue; // not a full 2×2 occupied group
      }
      const group = [c0, c1, c2, c3] as const;
      const plusExposed = sideIsEmpty(occupied, group, d, 1);
      const minusExposed = sideIsEmpty(occupied, group, d, -1);
      if (!plusExposed && !minusExposed) {
        continue; // interior patch (solid on both sides) — no surface here
      }
      const i0 = vertexFor(c0);
      const i1 = vertexFor(c1);
      const i2 = vertexFor(c2);
      const i3 = vertexFor(c3);
      // Square corner order c0→c1(+u)→c3(+u+v)→c2(+v). With eu×ev = ed, the
      // (c0,c1,c3)+(c0,c3,c2) winding faces +d; reverse it when only −d is
      // exposed so the outward normal points away from the solid.
      if (plusExposed) {
        indices.push(i0, i1, i3, i0, i3, i2);
      } else {
        indices.push(i0, i3, i1, i0, i2, i3);
      }
    }
  }
}

/**
 * 'corner-fit' mode — the per-face cube mesher with **displaced shared corners**.
 *
 * Keeps {@link buildCulled}'s exact face topology (same exposed faces), but each
 * lattice corner — identified by its integer half-lattice key `(2x±1, 2y±1,
 * 2z±1)` so every cell sharing it produces the SAME key — is moved to the
 * **mean of `getCellPoint()` over the occupied cells touching it**. Vertices are
 * welded by corner key, so adjacent faces reference the identical displaced
 * position: seams stay coincident ⇒ the surface deforms to hug the measured
 * points yet stays **watertight** (the even-edge-cover invariant `'smooth'`
 * gives up). Without a `getCellPoint` provider every corner falls back to the
 * geometric corner `key · cellSize/2`, i.e. plain cubes.
 *
 * Tradeoffs vs `'smooth'`: watertight and exact-cube topology, but corners are
 * 8-way averages (so geometry only *approaches* the measured points, never lands
 * on them) and the per-face O(surface-area) triangle cost is unchanged. Greedy
 * merging does not apply (displaced corners are non-coplanar).
 */
function buildCornerFit(
  occupied: Set<string>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  // Pass 1: accumulate the centroid mean per shared corner (half-lattice key).
  const cornerSum = new Map<
    string,
    { x: number; y: number; z: number; n: number }
  >();
  for (const cell of uniqueCells) {
    const cp = getCellPoint ? getCellPoint(cell) : null;
    if (!cp) {
      continue;
    }
    for (const sx of [-1, 1] as const) {
      for (const sy of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          const key = cellKey(
            2 * cell[0] + sx,
            2 * cell[1] + sy,
            2 * cell[2] + sz
          );
          let acc = cornerSum.get(key);
          if (!acc) {
            acc = { x: 0, y: 0, z: 0, n: 0 };
            cornerSum.set(key, acc);
          }
          acc.x += cp[0];
          acc.y += cp[1];
          acc.z += cp[2];
          acc.n += 1;
        }
      }
    }
  }

  // Welded vertex per corner key (lazy) — displaced mean, or geometric fallback.
  const vertexIndex = new Map<string, number>();
  const cornerVertex = (kx: number, ky: number, kz: number): number => {
    const key = cellKey(kx, ky, kz);
    const existing = vertexIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const acc = cornerSum.get(key);
    const px = acc ? acc.x / acc.n : kx * half; // geometric corner = key · half
    const py = acc ? acc.y / acc.n : ky * half;
    const pz = acc ? acc.z / acc.n : kz * half;
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
      const v = face.corners.map(([sx, sy, sz]) =>
        cornerVertex(2 * x + sx, 2 * y + sy, 2 * z + sz)
      );
      // Same winding as pushQuad: (0,1,2)+(0,2,3).
      indices.push(v[0]!, v[1]!, v[2]!, v[0]!, v[2]!, v[3]!);
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
  occupied: Set<string>,
  uniqueCells: readonly GridCell[],
  cellSizeM: number,
  positions: number[],
  indices: number[]
): void {
  const half = cellSizeM / 2;
  for (const { d, u, v } of GREEDY_DIRS) {
    for (const sign of [1, -1] as const) {
      // Group exposed (iu,iv) cells by slice index k = cell[d].
      const slices = new Map<number, Map<string, readonly [number, number]>>();
      for (const cell of uniqueCells) {
        const neighbour: [number, number, number] = [cell[0], cell[1], cell[2]];
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
        slice.set(`${iu},${iv}`, [iu, iv]);
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
// eslint-disable-next-line max-params
function greedyMergeSlice(
  slice: ReadonlyMap<string, readonly [number, number]>,
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
  const has = (iu: number, iv: number): boolean => slice.has(`${iu},${iv}`);
  const used = new Set<string>();
  // Deterministic order: by iv (outer) then iu (inner), both ascending.
  const cells = [...slice.values()].sort((a, b) =>
    a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]
  );
  for (const [iu, iv] of cells) {
    const startKey = `${iu},${iv}`;
    if (used.has(startKey)) {
      continue;
    }
    // Grow width along +u while cells exist and are unused.
    let w = 1;
    while (has(iu + w, iv) && !used.has(`${iu + w},${iv}`)) {
      w++;
    }
    // Grow height along +v while every cell of the next row is present/unused.
    let h = 1;
    let canGrow = true;
    while (canGrow) {
      for (let du = 0; du < w; du++) {
        if (has(iu + du, iv + h) && !used.has(`${iu + du},${iv + h}`)) {
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
        used.add(`${iu + du},${iv + dv}`);
      }
    }
    const plane = k * cellSizeM + sign * half;
    const uMin = iu * cellSizeM - half;
    const uMax = (iu + w - 1) * cellSizeM + half;
    const vMin = iv * cellSizeM - half;
    const vMax = (iv + h - 1) * cellSizeM + half;
    const corner = (uVal: number, vVal: number): [number, number, number] => {
      const p: [number, number, number] = [0, 0, 0];
      p[d] = plane;
      p[u] = uVal;
      p[v] = vVal;
      return p;
    };
    // +d side: CCW (uMin,vMin)→(uMax,vMin)→(uMax,vMax)→(uMin,vMax); −d reversed.
    const corners: [number, number, number][] =
      sign > 0
        ? [
            corner(uMin, vMin),
            corner(uMax, vMin),
            corner(uMax, vMax),
            corner(uMin, vMax),
          ]
        : [
            corner(uMin, vMin),
            corner(uMin, vMax),
            corner(uMax, vMax),
            corner(uMax, vMin),
          ];
    pushQuad(positions, indices, corners);
  }
}
