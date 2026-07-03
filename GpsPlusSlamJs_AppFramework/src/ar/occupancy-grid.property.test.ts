/**
 * Occupancy Grid Property Tests.
 *
 * Why this test matters (port plan Iter 3):
 * - Quantization must be stable at cell boundaries and getCellCenter must
 *   stay within cellSizeM/2 of the original position per axis — this is
 *   the guard against porting Unity's half-cell CellToWorldPos offset.
 * - Carving must never remove the observed endpoint cell (or its
 *   carve-stop neighborhood), including the degenerate camera==point cell
 *   case, while cells far enough in FRONT of a later, deeper observation
 *   on the same ray must be carved.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { DepthSample } from '../types/ar-types';
import { OccupancyGrid } from './occupancy-grid';

const PROJECTION: Matrix4 = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

function makeSample(cameraPos: Vector3, depths: number[]): DepthSample {
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: depths.map((depthM) => ({ screenX: 0.5, screenY: 0.5, depthM })),
    projectionMatrix: PROJECTION,
  };
}

describe('OccupancyGrid properties', () => {
  /**
   * Why this property matters (Iter 8): the cell color must be the true
   * per-channel rounded mean of exactly the COLORED observations — mixing
   * in color-less observations (old recordings, rgb option off) or losing
   * precision over many accumulations would drift every voxel's color.
   */
  it('cell color equals the rounded per-channel mean of the colored observations only', () => {
    const rgbArb = fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    );
    fc.assert(
      fc.property(
        fc.array(rgbArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 10 }),
        (colors, colorlessObservations) => {
          const grid = new OccupancyGrid({ cellSizeM: 1 });
          for (const rgb of colors) {
            grid.addSample({
              ...makeSample([0, 0, 0], []),
              points: [{ screenX: 0.5, screenY: 0.5, depthM: 5, rgb }],
            });
          }
          for (let i = 0; i < colorlessObservations; i++) {
            grid.addSample(makeSample([0, 0, 0], [5]));
          }
          const expected = [0, 1, 2].map((channel) =>
            Math.round(
              colors.reduce((sum, rgb) => sum + rgb[channel]!, 0) /
                colors.length
            )
          );
          expect(grid.getCellColor([0, 0, -5])).toEqual(expected);
        }
      )
    );
  });

  it('getCellCenter(cellForPosition(p)) stays within cellSizeM/2 of p per axis', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        fc.tuple(
          fc.double({ min: -100, max: 100, noNaN: true }),
          fc.double({ min: -100, max: 100, noNaN: true }),
          fc.double({ min: -100, max: 100, noNaN: true })
        ),
        (cellSizeM, pos) => {
          const grid = new OccupancyGrid({ cellSizeM });
          const center = grid.getCellCenter(grid.cellForPosition(pos));
          for (let axis = 0; axis < 3; axis++) {
            // +1e-9 tolerates float rounding exactly at the boundary
            expect(Math.abs(center[axis] - pos[axis])).toBeLessThanOrEqual(
              cellSizeM / 2 + 1e-9
            );
          }
        }
      )
    );
  });

  /**
   * Why this property matters (follow-up Item A): `getCellPoint` is a centroid
   * of the exact points that fell in the cell, so it must always lie INSIDE
   * the cell — within cellSizeM/2 of the center per axis. A drifting or
   * mis-divided average (e.g. dividing by the wrong count) would push the
   * exported point outside its voxel.
   */
  it('getCellPoint stays within cellSizeM/2 of the cell center for every occupied cell', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        fc.array(fc.double({ min: 0.3, max: 50, noNaN: true }), {
          minLength: 1,
          maxLength: 20,
        }),
        (cellSizeM, depths) => {
          const grid = new OccupancyGrid({ cellSizeM });
          grid.addSample(makeSample([0, 0, 0], depths));
          for (const cell of grid.getOccupiedCells()) {
            const point = grid.getCellPoint(cell);
            expect(point).not.toBeNull();
            const center = grid.getCellCenter(cell);
            for (let axis = 0; axis < 3; axis++) {
              expect(Math.abs(point![axis] - center[axis])).toBeLessThanOrEqual(
                cellSizeM / 2 + 1e-9
              );
            }
          }
        }
      )
    );
  });

  it('an observed cell survives any number of repeat observations from any camera distance (incl. same-cell case)', () => {
    fc.assert(
      fc.property(
        // Depth in whole cells; 0 cells = camera and point share a cell
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (depthCells, observations, carveStopCells) => {
          const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells });
          // Depth 0 is an invalid read; use a small positive in-cell depth
          const depthM = depthCells === 0 ? 0.2 : depthCells;
          for (let i = 0; i < observations; i++) {
            grid.addSample(makeSample([0, 0, 0], [depthM]));
          }
          // The observed cell exists with the full observation count —
          // carving never reset it. (`+ 0` normalizes -0 for depthCells=0,
          // matching the grid's normalized cell coordinates.)
          expect(grid.getOccupiedCells(observations)).toContainEqual([
            0,
            0,
            -depthCells + 0,
          ]);
        }
      )
    );
  });

  it('a nearer cell on the ray is carved iff it is at least carveStopCells in front of a deeper observation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 4 }),
        (nearCells, extraCells, carveStopCells) => {
          const farCells = nearCells + extraCells;
          const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells });
          grid.addSample(makeSample([0, 0, 0], [nearCells]));
          grid.addSample(makeSample([0, 0, 0], [farCells]));

          const nearSurvives = grid
            .getOccupiedCells()
            .some((c) => c[0] === 0 && c[1] === 0 && c[2] === -nearCells);
          // Carve ray to -farCells stops carveStopCells dominant-axis
          // steps before the endpoint: the near cell is removed exactly
          // when its distance to the endpoint is >= carveStopCells.
          const shouldSurvive = extraCells < carveStopCells;
          expect(nearSurvives).toBe(shouldSurvive);
          // The deeper observation itself is always present.
          expect(grid.getOccupiedCells()).toContainEqual([0, 0, -farCells]);
        }
      )
    );
  });

  it('getOccupiedCellsFlat is exactly the flattened tuple snapshot for any observation history and floor (Step 1.3)', () => {
    // Why this property matters: the flat API feeds the mesh-worker pack path
    // and must never drift from the tuple API the cubes/COLMAP consumers read
    // — same cells, same order, for any interleaving of observations and any
    // minObservations floor (including floors above the memoized range).
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.double({ min: 0.6, max: 12, noNaN: true }), {
            minLength: 1,
            maxLength: 5,
          }),
          { minLength: 1, maxLength: 8 }
        ),
        fc.integer({ min: 1, max: 12 }),
        (samples, minObservations) => {
          const grid = new OccupancyGrid();
          for (const depths of samples) {
            grid.addSample(makeSample([0, 0, 0], depths));
          }
          const tuples = grid.getOccupiedCells(minObservations);
          const flat = grid.getOccupiedCellsFlat(minObservations);
          expect(Array.from(flat)).toEqual(tuples.flat());
        }
      )
    );
  });

  it('getOccupiedCellsWithin ≡ brute-force radius filter of getOccupiedCells for any grid, center and radius (Step 2)', () => {
    // Why this property matters: the chunk-index window is the structural
    // change that bounds consumer cost by the neighbourhood — if its
    // AABB-vs-sphere chunk walk or interior-chunk shortcut ever drops or
    // over-includes a cell relative to the plain distance filter, occlusion
    // and cubes silently diverge from the grid. Cameras at several origins
    // spread samples across chunk boundaries.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            camX: fc.integer({ min: -30, max: 30 }),
            camY: fc.integer({ min: -5, max: 5 }),
            depths: fc.array(fc.double({ min: 0.6, max: 20, noNaN: true }), {
              minLength: 1,
              maxLength: 4,
            }),
          }),
          { minLength: 1, maxLength: 6 }
        ),
        fc.tuple(
          fc.double({ min: -35, max: 35, noNaN: true }),
          fc.double({ min: -8, max: 8, noNaN: true }),
          fc.double({ min: -25, max: 5, noNaN: true })
        ),
        fc.double({ min: 0.3, max: 40, noNaN: true }),
        fc.integer({ min: 1, max: 3 }),
        (samples, center, radiusM, minObservations) => {
          const grid = new OccupancyGrid({ cellSizeM: 1 });
          for (const s of samples) {
            grid.addSample(makeSample([s.camX, s.camY, 0], s.depths));
          }
          const expected = grid
            .getOccupiedCells(minObservations)
            .filter((cell) => {
              const c = grid.getCellCenter(cell);
              const dx = c[0] - center[0];
              const dy = c[1] - center[1];
              const dz = c[2] - center[2];
              return dx * dx + dy * dy + dz * dz <= radiusM * radiusM;
            });
          const actual = grid.getOccupiedCellsWithin(
            center,
            radiusM,
            minObservations
          );
          // Same SET of cells (chunk iteration order differs from Map order).
          const key = (c: readonly number[]): string => c.join(',');
          expect(new Set(actual.map(key))).toEqual(new Set(expected.map(key)));
          expect(actual).toHaveLength(expected.length);
          // The flat variant carries exactly the tuple result.
          expect(
            Array.from(
              grid.getOccupiedCellsWithinFlat(center, radiusM, minObservations)
            )
          ).toEqual(actual.flat());
        }
      )
    );
  });
});
