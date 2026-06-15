/**
 * QR occupancy plausibility self-check — unit tests.
 *
 * Why this test matters: this is the geometry oracle that catches a wrong
 * encoded QR size (which moves the solved center off the real surface). The
 * synthetic grids below encode the three verdicts the §7 plan names — on a wall
 * (plausible), floating in mid-air, and behind/inside geometry — plus the
 * grid-absent escape hatch that must never block detection.
 */

import { describe, it, expect } from 'vitest';
import type { Vector3 } from 'gps-plus-slam-js';
import type { GridCell } from './bresenham3d';
import {
  checkQrPlausibility,
  type OccupancySurface,
} from './qr-occupancy-check';

const CELL = 0.15;

/** A synthetic grid whose cell centers are `cell · cellSizeM` (real-grid parity). */
function fakeGrid(cells: GridCell[], cellSizeM = CELL): OccupancySurface {
  return {
    cellSizeM,
    getOccupiedCells: () => cells,
    getCellCenter: (c) => [
      c[0] * cellSizeM,
      c[1] * cellSizeM,
      c[2] * cellSizeM,
    ],
  };
}

/** A flat wall of voxels on the z=0 plane spanning a small x/y patch. */
function wallAtZ(zIndex: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) cells.push([x, y, zIndex]);
  }
  return cells;
}

describe('checkQrPlausibility', () => {
  it('returns no-grid (ok) when there are no occupied voxels', () => {
    const result = checkQrPlausibility([0, 0, 0], [0, 0, 2], fakeGrid([]));
    expect(result.verdict).toBe('no-grid');
    expect(result.ok).toBe(true);
    expect(result.nearestSurfaceDistanceM).toBe(Infinity);
  });

  it('accepts a QR sitting on a wall with empty space toward the camera', () => {
    // Wall on z=0, camera 2 m in front (+z), QR centered on the wall.
    const result = checkQrPlausibility(
      [0, 0, 0],
      [0, 0, 2],
      fakeGrid(wallAtZ(0))
    );
    expect(result.verdict).toBe('plausible');
    expect(result.ok).toBe(true);
    expect(result.nearestSurfaceDistanceM).toBeLessThan(CELL);
  });

  it('flags a floating QR far from any surface', () => {
    // Wall on z=0, but the QR is 1 m off it (≫ 1.5 cells = 0.225 m).
    const result = checkQrPlausibility(
      [0, 0, 1],
      [0, 0, 3],
      fakeGrid(wallAtZ(0))
    );
    expect(result.verdict).toBe('floating');
    expect(result.ok).toBe(false);
    expect(result.nearestSurfaceDistanceM).toBeCloseTo(1, 5);
  });

  it('flags a QR behind an occluding surface (inside geometry)', () => {
    // QR sits on the far wall (z=0); an occluder wall at z=1 is between the
    // camera (z=2) and the QR. The ray hits the occluder first → behind-surface.
    const cells = [...wallAtZ(0), ...wallAtZ(Math.round(1 / CELL))];
    const result = checkQrPlausibility([0, 0, 0], [0, 0, 2], fakeGrid(cells));
    expect(result.verdict).toBe('behind-surface');
    expect(result.ok).toBe(false);
  });

  it('does not treat the QR’s own wall voxel as an occluder', () => {
    // Only the wall the QR sits on — nothing should occlude it.
    const result = checkQrPlausibility(
      [0, 0, 0],
      [0, 0, 2],
      fakeGrid(wallAtZ(0))
    );
    expect(result.verdict).toBe('plausible');
  });

  it('skips the occlusion test when camera and QR are coincident', () => {
    // rayLength ≈ 0 → only the surface-proximity test applies.
    const result = checkQrPlausibility(
      [0, 0, 0],
      [0, 0, 0],
      fakeGrid(wallAtZ(0))
    );
    expect(result.verdict).toBe('plausible');
  });

  it('respects a custom surface tolerance', () => {
    const qr: Vector3 = [0, 0, 0.3]; // 0.3 m off the wall
    const grid = fakeGrid(wallAtZ(0));
    // Default tolerance (1.5 cells = 0.225 m) → floating.
    expect(checkQrPlausibility(qr, [0, 0, 2], grid).verdict).toBe('floating');
    // A generous tolerance (3 cells = 0.45 m) → on-surface.
    expect(
      checkQrPlausibility(qr, [0, 0, 2], grid, { surfaceToleranceCells: 3 })
        .verdict
    ).toBe('plausible');
  });
});
