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

/** Options for {@link meshOccupiedCells}. */
export interface MeshOccupiedCellsOptions {
  /**
   * Merge coplanar adjacent exposed faces into larger quads (Minecraft-style
   * greedy meshing) to cut the triangle count, often 5–20×. The merged surface
   * covers the **exact same** set of unit faces as the default per-face output
   * (same occluded volume) — only the triangulation is coarser. Default false.
   *
   * Note: this merges the **render/occluder geometry** only; the `aabbs` list
   * stays one box per cell (a 3-D greedy box merge for fewer colliders is a
   * separate follow-on — see the plan §3E).
   */
  readonly greedy?: boolean;
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
  if (options?.greedy) {
    buildGreedy(occupied, uniqueCells, cellSizeM, positions, indices);
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
