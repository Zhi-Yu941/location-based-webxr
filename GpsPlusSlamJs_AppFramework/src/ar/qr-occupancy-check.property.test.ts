/**
 * QR occupancy plausibility self-check — property tests.
 *
 * Why this test matters: the verdict must depend only on the geometry, not on
 * the particular voxel coordinates. Two invariants pin that down for any single
 * occupied voxel and viewing direction:
 *  1. a QR exactly on the voxel, viewed from far enough away, is `plausible`;
 *  2. a QR displaced beyond the surface tolerance is `floating`.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { GridCell } from './bresenham3d';
import {
  checkQrPlausibility,
  type OccupancySurface,
} from './qr-occupancy-check';

const CELL = 0.15;

function singleCellGrid(cell: GridCell): OccupancySurface {
  return {
    cellSizeM: CELL,
    getOccupiedCells: () => [cell],
    getCellCenter: (c) => [c[0] * CELL, c[1] * CELL, c[2] * CELL],
  };
}

const arbCell = fc.tuple(
  fc.integer({ min: -20, max: 20 }),
  fc.integer({ min: -20, max: 20 }),
  fc.integer({ min: -20, max: 20 })
);
// A unit-ish view direction, kept away from zero so it normalizes cleanly.
const arbDir = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 0.2);

describe('checkQrPlausibility — geometry-only invariants', () => {
  it('a QR exactly on a voxel, viewed from afar, is plausible', () => {
    fc.assert(
      fc.property(arbCell, arbDir, (cell, dir) => {
        const center: [number, number, number] = [
          cell[0] * CELL,
          cell[1] * CELL,
          cell[2] * CELL,
        ];
        const len = Math.hypot(dir[0], dir[1], dir[2]);
        // Camera 2 m back along the view direction — far enough that the single
        // voxel sits near the QR (excluded by the occlusion margin), not in front.
        const camera: [number, number, number] = [
          center[0] + (dir[0] / len) * 2,
          center[1] + (dir[1] / len) * 2,
          center[2] + (dir[2] / len) * 2,
        ];
        const result = checkQrPlausibility(
          center,
          camera,
          singleCellGrid(cell)
        );
        expect(result.verdict).toBe('plausible');
        expect(result.ok).toBe(true);
      })
    );
  });

  it('a QR displaced beyond the surface tolerance is floating', () => {
    const arbOffset = fc.double({ min: 0.4, max: 3, noNaN: true }); // ≫ 1.5 cells
    fc.assert(
      fc.property(arbCell, arbDir, arbOffset, (cell, dir, offset) => {
        const center: [number, number, number] = [
          cell[0] * CELL,
          cell[1] * CELL,
          cell[2] * CELL,
        ];
        const len = Math.hypot(dir[0], dir[1], dir[2]);
        const qr: [number, number, number] = [
          center[0] + (dir[0] / len) * offset,
          center[1] + (dir[1] / len) * offset,
          center[2] + (dir[2] / len) * offset,
        ];
        // Camera further along the same direction so the QR is between it and
        // the voxel — the verdict must still be governed by surface distance.
        const camera: [number, number, number] = [
          center[0] + (dir[0] / len) * (offset + 2),
          center[1] + (dir[1] / len) * (offset + 2),
          center[2] + (dir[2] / len) * (offset + 2),
        ];
        const result = checkQrPlausibility(qr, camera, singleCellGrid(cell));
        expect(result.verdict).toBe('floating');
        expect(result.ok).toBe(false);
        expect(result.nearestSurfaceDistanceM).toBeCloseTo(offset, 4);
      })
    );
  });
});
