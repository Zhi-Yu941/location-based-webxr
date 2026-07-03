/**
 * buildSyntheticSurfaceGrid — placement-envelope regression tests.
 *
 * Why this test matters (PR #145 review, recorded in
 * 2026-07-01-pr145-occluder-followups.md §2): the slab's −Z push (`kBase`)
 * must budget for EVERY transverse dimension of the box. It used to scale
 * with cellsX + cellsZ only, so a tall slab (large `thickness`) pushed the
 * top cells' worldY beyond the identity-projection view and tripped the loud
 * "fell outside the synthetic view" guard even though the options had passed
 * validation — a validated input must always build.
 */

import { describe, it, expect } from 'vitest';
import { buildSyntheticSurfaceGrid } from './synthetic-occupancy-grid';

describe('buildSyntheticSurfaceGrid placement envelope', () => {
  it('builds a thin floor slab (the common case)', () => {
    const { grid, cellCount } = buildSyntheticSurfaceGrid({
      cellsX: 4,
      cellsZ: 3,
    });
    expect(cellCount).toBe(12);
    expect(grid.size).toBe(12);
  });

  it('builds a TALL slab — thickness participates in the depth budget', () => {
    const { grid, cellCount } = buildSyntheticSurfaceGrid({
      cellsX: 1,
      cellsZ: 1,
      thickness: 100,
    });
    expect(cellCount).toBe(100);
    expect(grid.size).toBe(100);
  });

  it('builds a wide+deep+tall box (all three dimensions large together)', () => {
    const { grid, cellCount } = buildSyntheticSurfaceGrid({
      cellsX: 20,
      cellsZ: 20,
      thickness: 20,
    });
    expect(cellCount).toBe(8000);
    expect(grid.size).toBe(8000);
  });
});
