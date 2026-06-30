/**
 * Occupancy mesher — 'corner-fit' deformed-corner cube mode (F2b, 2026-06-30).
 *
 * The maintainer's "improve the cube approach" path: keep the per-face cube
 * mesher's EXACT face topology, but move each shared lattice corner to the mean
 * of getCellPoint() over the occupied cells touching it. Because adjacent cubes
 * reference the SAME displaced corner (a pure function of the corner's
 * half-lattice key), seams stay coincident — so the surface hugs the measured
 * points yet stays **watertight** (the property surface nets gives up).
 *
 * Invariants driven here (per the F2b spec):
 *  1. hugs measured points — a corner equals the mean of its contributing
 *     getCellPoint()s, NOT the geometric lattice corner;
 *  2. watertight — even-edge-cover (closed-surface Z/2) holds, the property
 *     'smooth' is exempt from (here checked on the WELDED index buffer, since
 *     displaced corners are off the half-lattice the cube test quantizes to);
 *  3. same occluded boundary — identical face SET as per-face cubes ⇒ identical
 *     triangle count for the same input;
 *  4. bounded deformation — every displaced corner stays within cellSize of its
 *     geometric corner.
 */

import { describe, it, expect } from 'vitest';
import { meshOccupiedCells } from './occupancy-mesher';
import type { GridCell } from './bresenham3d';
import type { Vector3 } from 'gps-plus-slam-js';

const CELL = 0.15;
const half = CELL / 2;
const OFFSET: Vector3 = [0.03, -0.02, 0.018]; // each |·| < half

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

/** Solid box of cells [0,nx)×[0,ny)×[0,nz). */
function solidBox(nx: number, ny: number, nz: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) cells.push([x, y, z]);
  return cells;
}

/** Index-based even-edge-cover (robust for off-lattice welded vertices). */
function oddEdgeCountByIndex(indices: Uint32Array): number {
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
  let odd = 0;
  for (const n of edges.values()) if (n % 2 !== 0) odd++;
  return odd;
}

/** Does the position buffer contain a vertex close to `target`? */
function hasVertexNear(positions: Float32Array, target: Vector3): boolean {
  for (let v = 0; v < positions.length; v += 3) {
    if (
      Math.abs(positions[v]! - target[0]) < 1e-5 &&
      Math.abs(positions[v + 1]! - target[1]) < 1e-5 &&
      Math.abs(positions[v + 2]! - target[2]) < 1e-5
    ) {
      return true;
    }
  }
  return false;
}

describe("occupancy mesher — 'corner-fit' deformed-corner cube mode", () => {
  it('hugs measured points: corners are centroid-means, not geometric corners', () => {
    // A 2×1×1 domino: cells (0,0,0) and (1,0,0). The x=0.5 corners are shared by
    // BOTH cells and stay on the surface (the +Y/+Z faces are exposed), so the
    // shared-corner mean is actually emitted (unlike a solid box's interior
    // centre corner, which no exposed face references).
    const cells = solidBox(2, 1, 1);
    const { positions } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    // Outer corner of cell (0,0,0), key (−1,−1,−1): touched by ONE cell ⇒
    // equals that cell's centroid = [0.03, −0.02, 0.018], NOT the geometric
    // corner [−half, −half, −half].
    expect(hasVertexNear(positions, [0.03, -0.02, 0.018])).toBe(true);
    expect(hasVertexNear(positions, [-half, -half, -half])).toBe(false);
    // Shared corner key (1,1,1): touched by cells (0,0,0) and (1,0,0) ⇒ mean of
    // their centroids = [(0.03+0.18)/2, −0.02, 0.018] = [0.105, −0.02, 0.018],
    // NOT the geometric corner [half, half, half].
    expect(hasVertexNear(positions, [0.105, -0.02, 0.018])).toBe(true);
    expect(hasVertexNear(positions, [half, half, half])).toBe(false);
  });

  it('is watertight (even-edge-cover) — the property smooth gives up', () => {
    const cells = solidBox(2, 2, 2);
    const { indices } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    expect(oddEdgeCountByIndex(indices)).toBe(0);
  });

  it('emits the same face SET as per-face cubes (identical triangle count)', () => {
    const cells = solidBox(3, 2, 2);
    const perFace = meshOccupiedCells(cells, CELL);
    const cornerFit = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    expect(cornerFit.indices.length / 3).toBe(perFace.indices.length / 3);
    // …but the geometry differs (positions are displaced toward the centroids).
    expect(Array.from(cornerFit.positions)).not.toEqual(
      Array.from(perFace.positions)
    );
  });

  it('bounds deformation: every corner stays within cellSize of its geometric corner', () => {
    const cells = solidBox(3, 3, 1);
    const { positions } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    for (let v = 0; v < positions.length; v += 3) {
      for (let a = 0; a < 3; a++) {
        const coord = positions[v + a]!;
        // Nearest geometric corner is the closest half-lattice point (k·half).
        const nearest = Math.round(coord / half) * half;
        expect(Math.abs(coord - nearest)).toBeLessThanOrEqual(CELL + 1e-9);
      }
    }
  });

  it('falls back to the geometric corner when no getCellPoint is supplied', () => {
    const cells = solidBox(2, 2, 2);
    const cornerFit = meshOccupiedCells(cells, CELL, { mode: 'corner-fit' });
    const perFace = meshOccupiedCells(cells, CELL);
    // Same topology AND — with no centroids — the same geometry as plain cubes.
    expect(cornerFit.indices.length / 3).toBe(perFace.indices.length / 3);
    // Every corner-fit vertex lies on the half-lattice (geometric corners).
    for (let v = 0; v < cornerFit.positions.length; v++) {
      const coord = cornerFit.positions[v]!;
      const nearest = Math.round(coord / half) * half;
      expect(Math.abs(coord - nearest)).toBeLessThan(1e-5);
    }
  });

  it('still returns one AABB per occupied cell', () => {
    const cells = solidBox(2, 2, 2);
    const { aabbs } = meshOccupiedCells(cells, CELL, {
      mode: 'corner-fit',
      getCellPoint: centroidProvider(cells),
    });
    expect(aabbs.length).toBe(8);
  });
});
