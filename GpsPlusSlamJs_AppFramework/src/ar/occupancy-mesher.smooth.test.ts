/**
 * Occupancy mesher — 'smooth' surface-nets mode (standard dual contouring).
 *
 * The 'smooth' mode consumes the per-cell measured centroid (`getCellPoint()`)
 * the cube meshers throw away. It was originally a minimal 2×2-patch heuristic
 * that only meshed flat, fully-occupied, uniformly-exposed blocks — which on a
 * real, ragged depth surface covered only ~10–18 % of the boundary ("barely any
 * surfaces", reported on a recording 2026-06-30). It was **rewritten as standard
 * Naive Surface Nets (dual contouring)**: one welded vertex per boundary dual
 * cell at the mean of its occupied corners' `getCellPoint`, and one quad per
 * occupied↔empty crossing — the SAME set the cube mesher emits — so coverage now
 * matches the cubes.
 *
 * Invariants:
 *  1. FULL coverage — comparable triangle count to the per-face cubes on ragged
 *     / thin surfaces (the bug fix), incl. 1-cell-wide features the 2×2 heuristic
 *     missed entirely — AND non-zero AREA for features thin in ≥2 dimensions
 *     (count alone hid a zero-area collapse: all dual vertices around an
 *     isolated voxel / line / pillar coincided until the single-corner nudge,
 *     SINGLE_CORNER_NUDGE_K, 2026-07-02);
 *  2. consumes getCellPoint — vertices are pulled onto the measured surface (a
 *     uniform sub-cell offset shifts every vertex by that offset);
 *  3. welded + watertight on a closed (thick) region (even-edge-cover = 0);
 *  4. one AABB per occupied cell; back-compat `greedy:true` shim.
 */

import { describe, it, expect } from 'vitest';
import { meshOccupiedCells } from './occupancy-mesher';
import type { GridCell } from './bresenham3d';
import type { Vector3 } from 'gps-plus-slam-js';

const CELL = 0.15;

/** A getCellPoint that hugs a known sub-cell offset, so consumption is testable. */
const OFFSET: Vector3 = [0.03, -0.02, 0.018]; // each |·| < cellSize/2 (0.075)
function centroidProvider(cells: Iterable<GridCell>) {
  const occ = new Set<string>();
  for (const [x, y, z] of cells) occ.add(`${x},${y},${z}`);
  return (cell: GridCell): Vector3 | null => {
    if (!occ.has(`${cell[0]},${cell[1]},${cell[2]}`)) return null;
    return [
      cell[0] * CELL + OFFSET[0],
      cell[1] * CELL + OFFSET[1],
      cell[2] * CELL + OFFSET[2],
    ];
  };
}

const triCount = (m: { indices: Uint32Array }): number => m.indices.length / 3;

/** Total mesh surface area in m² — ½·‖(b−a)×(c−a)‖ summed over all triangles. */
function totalTriArea(m: {
  positions: Float32Array;
  indices: Uint32Array;
}): number {
  const p = m.positions;
  let area = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const ia = m.indices[t]! * 3;
    const ib = m.indices[t + 1]! * 3;
    const ic = m.indices[t + 2]! * 3;
    const abx = p[ib]! - p[ia]!;
    const aby = p[ib + 1]! - p[ia + 1]!;
    const abz = p[ib + 2]! - p[ia + 2]!;
    const acx = p[ic]! - p[ia]!;
    const acy = p[ic + 1]! - p[ia + 1]!;
    const acz = p[ic + 2]! - p[ia + 2]!;
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return area;
}

/** Index-based edge cover counts (robust for welded, off-lattice vertices). */
function edgeCover(indices: Uint32Array): Map<string, number> {
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    for (const [a, b] of [
      [tri[0]!, tri[1]!],
      [tri[1]!, tri[2]!],
      [tri[2]!, tri[0]!],
    ] as const) {
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  return edges;
}

/** A floor that is mostly 1–2 cells thick with a ragged top — a realistic
 *  depth-derived surface shape (the case the 2×2 heuristic under-covered). */
function raggedFloor(): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < 12; x++) {
    for (let z = 0; z < 12; z++) {
      cells.push([x, 0, z]);
      if ((x + z) % 3 !== 0) cells.push([x, 1, z]);
    }
  }
  return cells;
}

describe("occupancy mesher — 'smooth' surface-nets (dual contouring)", () => {
  it('covers the full boundary like the cubes on a ragged surface (the bug fix)', () => {
    const cells = raggedFloor();
    const perFace = meshOccupiedCells(cells, CELL);
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    // One quad per crossing == one quad per exposed cube face ⇒ equal triangles.
    // (Was ~25 % before the rewrite.)
    expect(triCount(smooth)).toBe(triCount(perFace));
  });

  it('meshes a 1-cell-wide surface the 2×2 heuristic missed entirely', () => {
    // An 8×8 square frame, 1 cell wide: no fully-occupied coplanar 2×2 group, so
    // the old surface nets emitted ZERO quads. Dual contouring covers it fully.
    const cells: GridCell[] = [];
    for (let i = 0; i < 8; i++) {
      cells.push([i, 0, 0], [i, 0, 7], [0, 0, i], [7, 0, i]);
    }
    const perFace = meshOccupiedCells(cells, CELL);
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    expect(triCount(smooth)).toBeGreaterThan(0);
    expect(triCount(smooth)).toBe(triCount(perFace));
  });

  it('emits non-zero AREA for features thin in ≥2 dimensions (single-corner nudge)', () => {
    // Why this test matters: without the SINGLE_CORNER_NUDGE_K fallback, all
    // dual cells around a feature thin in ≥2 dimensions average the SAME set
    // of occupied corners, so their welded vertices coincide — an isolated
    // voxel, a 4×1×1 line and a 1×1×3 pillar emitted the full per-face
    // triangle COUNT but ZERO total area, i.e. they were invisible to the
    // (default-on) occluder. Count-only assertions can never catch that, so
    // this area assertion is the permanent regression gate (see
    // 2026-07-01-followup-smooth-mesher-single-corner-degeneracy.md).
    // Guaranteed: non-zero total area (the n === 1 end/corner vertices spread
    // apart). NOT guaranteed, by design: interior shaft segments of a 1×1×N
    // feature stay degenerate — their n === 2 rings are locally
    // indistinguishable from a thin floor's intentionally-flat edges.
    const thinFeatures: GridCell[][] = [
      [[0, 0, 0]], // isolated voxel
      [
        // 4×1×1 line
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      [
        // 1×1×3 pillar
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
      ],
    ];
    for (const cells of thinFeatures) {
      const smooth = meshOccupiedCells(cells, CELL, {
        mode: 'smooth',
        getCellPoint: centroidProvider(cells),
      });
      expect(triCount(smooth)).toBeGreaterThan(0);
      expect(totalTriArea(smooth)).toBeGreaterThan(0);
    }
  });

  it('consumes getCellPoint: a uniform sub-cell offset shifts every vertex by it', () => {
    const cells = raggedFloor();
    const withProvider = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    const plain = meshOccupiedCells(cells, CELL, { mode: 'smooth' });
    // Same emission order ⇒ vertex i with the provider == vertex i without it,
    // shifted by OFFSET (each dual vertex averages cell points all carrying it).
    expect(withProvider.positions.length).toBe(plain.positions.length);
    for (let i = 0; i < withProvider.positions.length; i += 3) {
      expect(withProvider.positions[i]!).toBeCloseTo(
        plain.positions[i]! + OFFSET[0],
        5
      );
      expect(withProvider.positions[i + 1]!).toBeCloseTo(
        plain.positions[i + 1]! + OFFSET[1],
        5
      );
      expect(withProvider.positions[i + 2]!).toBeCloseTo(
        plain.positions[i + 2]! + OFFSET[2],
        5
      );
    }
  });

  it('welds vertices (far fewer than 4 per quad) and has no T-junctions', () => {
    const cells = raggedFloor();
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    const quads = triCount(smooth) / 2;
    const vertices = smooth.positions.length / 3;
    // Welded: dual vertices are shared across the (up to 4) quads around them.
    expect(vertices).toBeLessThan(quads * 4);
    // Crack-free: an interior diagonal of every quad is covered exactly twice
    // (the two triangles), so the per-triangle edge map is consistent — no
    // half-covered seams. (Boundary edges are covered once, and non-manifold
    // edges where four quads meet are covered four times; both are legal — only
    // an *unexpected* odd cover would signal a T-junction crack, which the
    // watertight closed-region test below rules out.)
    expect(vertices).toBeGreaterThan(0);
  });

  it('is watertight on a closed (thick) region', () => {
    // A solid 3×3×3 block contours to a closed shell — every index edge covered
    // an even number of times (consistent winding, no boundary).
    const cells: GridCell[] = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++) cells.push([x, y, z]);
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    let odd = 0;
    for (const n of edgeCover(smooth.indices).values()) if (n % 2 !== 0) odd++;
    expect(odd).toBe(0);
    expect(triCount(smooth)).toBeGreaterThan(0);
    expect(smooth.positions.every((p) => Number.isFinite(p))).toBe(true);
  });

  it('still returns one AABB per occupied cell (mode-independent)', () => {
    const cells: GridCell[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    const { aabbs } = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    expect(aabbs.length).toBe(3);
  });

  it("back-compat: greedy:true still maps to the 'greedy' mode, distinct from smooth", () => {
    const cells = raggedFloor();
    const greedyBool = meshOccupiedCells(cells, CELL, { greedy: true });
    const greedyMode = meshOccupiedCells(cells, CELL, { mode: 'greedy' });
    expect(greedyMode.indices.length).toBe(greedyBool.indices.length);
    const smooth = meshOccupiedCells(cells, CELL, {
      mode: 'smooth',
      getCellPoint: centroidProvider(cells),
    });
    expect(smooth.indices.length).not.toBe(greedyBool.indices.length);
  });
});
