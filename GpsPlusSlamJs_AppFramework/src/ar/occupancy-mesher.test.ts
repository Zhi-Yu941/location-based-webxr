/**
 * Occupancy Mesher — unit tests.
 *
 * Why this test matters:
 * `meshOccupiedCells` is the pure core of the persistent occlusion mesh and the
 * physics-collider export (2026-06-13-occupancy-mesh-options-plan.md, option
 * B). These cases pin the exact, oracle-able invariants of face culling — an
 * isolated voxel is a closed cube (6 faces / 12 tris), a shared face between
 * adjacent voxels is dropped, fully-enclosed voxels contribute nothing, and the
 * AABB list mirrors the unique occupied cells. Realistic-scale validation is a
 * separate skip-if-missing integration probe (see the plan's §8 test strategy).
 */

import { describe, it, expect } from 'vitest';
import type { GridCell } from './bresenham3d';
import { meshOccupiedCells } from './occupancy-mesher';

/** Faces emitted = indices / 6 (2 triangles, 3 indices each). */
function faceCount(indices: Uint32Array): number {
  expect(indices.length % 6).toBe(0);
  return indices.length / 6;
}

describe('meshOccupiedCells', () => {
  it('rejects a non-positive or non-finite cell size', () => {
    expect(() => meshOccupiedCells([[0, 0, 0]], 0)).toThrow(RangeError);
    expect(() => meshOccupiedCells([[0, 0, 0]], -1)).toThrow(RangeError);
    expect(() => meshOccupiedCells([[0, 0, 0]], NaN)).toThrow(RangeError);
  });

  it('returns empty geometry for no cells', () => {
    const { positions, indices, aabbs } = meshOccupiedCells([], 0.15);
    expect(positions.length).toBe(0);
    expect(indices.length).toBe(0);
    expect(aabbs).toEqual([]);
  });

  it('meshes a single isolated voxel as a closed cube (6 faces / 12 tris)', () => {
    const result = meshOccupiedCells([[0, 0, 0]], 0.15);
    expect(faceCount(result.indices)).toBe(6);
    expect(result.indices.length).toBe(36); // 6 faces × 2 tris × 3
    expect(result.positions.length).toBe(72); // 6 faces × 4 verts × 3
    expect(result.aabbs).toHaveLength(1);
  });

  it('places the AABB at cell·cellSizeM with half-cell extents', () => {
    const s = 0.2;
    const { aabbs } = meshOccupiedCells([[2, -1, 3]], s);
    expect(aabbs).toHaveLength(1);
    expect(aabbs[0]?.center).toEqual([2 * s, -1 * s, 3 * s]);
    expect(aabbs[0]?.halfExtents).toEqual([s / 2, s / 2, s / 2]);
  });

  it('emits cube corners spanning ±half-cell about the cell centre', () => {
    const s = 0.1;
    const { positions } = meshOccupiedCells([[0, 0, 0]], s);
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      xs.push(positions[i]!);
      ys.push(positions[i + 1]!);
      zs.push(positions[i + 2]!);
    }
    for (const axis of [xs, ys, zs]) {
      expect(Math.min(...axis)).toBeCloseTo(-s / 2);
      expect(Math.max(...axis)).toBeCloseTo(s / 2);
    }
  });

  it('culls the shared face between two adjacent voxels (10 faces, not 12)', () => {
    const cells: GridCell[] = [
      [0, 0, 0],
      [1, 0, 0],
    ];
    const result = meshOccupiedCells(cells, 0.15);
    expect(faceCount(result.indices)).toBe(10); // 6 + 6 − 2 shared
    expect(result.aabbs).toHaveLength(2);
  });

  it('exposes 3 faces per voxel for a solid 2×2×2 block (24 faces)', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 2; z++) cells.push([x, y, z]);
    const result = meshOccupiedCells(cells, 0.15);
    expect(faceCount(result.indices)).toBe(24); // 8 voxels × 3 exposed
    expect(result.aabbs).toHaveLength(8);
  });

  it('drops all faces of a fully-enclosed voxel (3×3×3 shell = 54 faces)', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++) cells.push([x, y, z]);
    const result = meshOccupiedCells(cells, 0.15);
    // The centre voxel (1,1,1) is fully surrounded → 0 faces; the surface is
    // 6 sides × 9 cells = 54 unit faces.
    expect(faceCount(result.indices)).toBe(54);
    expect(result.aabbs).toHaveLength(27);
  });

  it('de-duplicates repeated cells (geometry + AABBs)', () => {
    const cells: GridCell[] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const result = meshOccupiedCells(cells, 0.15);
    expect(faceCount(result.indices)).toBe(6);
    expect(result.aabbs).toHaveLength(1);
  });

  it('skips cells with a non-finite coordinate (defensive)', () => {
    const cells: GridCell[] = [
      [0, 0, 0],
      [NaN, 0, 0],
      [0, Infinity, 0],
    ];
    const result = meshOccupiedCells(cells, 0.15);
    expect(faceCount(result.indices)).toBe(6); // only the valid voxel
    expect(result.aabbs).toHaveLength(1);
  });

  // Why this test matters: `isPackableCell`'s documented guard is "finite,
  // INTEGER, and in key range" — the packed-key algebra (neighbour ±1 lookups,
  // corner-fit half-lattice keys `2·coord ± 1`) is only collision-safe for
  // integer coordinates, and a fractional cell is type-legal on this public
  // API (`GridCell` is just three numbers). It must be dropped like a
  // non-finite one, not silently meshed with unmatchable keys (PR #147 review).
  it('skips cells with a non-integer coordinate (defensive)', () => {
    const cells: GridCell[] = [
      [0, 0, 0],
      [0.5, 0, 0],
      [0, 0, -2.25],
    ];
    const result = meshOccupiedCells(cells, 0.15);
    expect(faceCount(result.indices)).toBe(6); // only the integer voxel
    expect(result.aabbs).toHaveLength(1);
  });

  describe('greedy merge', () => {
    it('keeps a single voxel at 6 quads (nothing to merge)', () => {
      const culled = meshOccupiedCells([[0, 0, 0]], 0.15);
      const greedy = meshOccupiedCells([[0, 0, 0]], 0.15, { greedy: true });
      expect(faceCount(greedy.indices)).toBe(6);
      expect(faceCount(greedy.indices)).toBe(faceCount(culled.indices));
    });

    it('collapses a flat 5×5×1 slab from 70 faces to 6 quads', () => {
      const cells: GridCell[] = [];
      for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++) cells.push([x, y, 0]);
      const culled = meshOccupiedCells(cells, 0.15);
      const greedy = meshOccupiedCells(cells, 0.15, { greedy: true });
      // Culled: 25 top + 25 bottom + 4 sides × 5 = 70 unit faces.
      expect(faceCount(culled.indices)).toBe(70);
      // Greedy: top + bottom (1 each) + 4 side strips (1 each) = 6 quads.
      expect(faceCount(greedy.indices)).toBe(6);
    });

    it('still emits one AABB per cell (geometry merges, colliders do not)', () => {
      const cells: GridCell[] = [];
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++) cells.push([x, y, 0]);
      const greedy = meshOccupiedCells(cells, 0.15, { greedy: true });
      expect(greedy.aabbs).toHaveLength(9);
    });
  });
});
