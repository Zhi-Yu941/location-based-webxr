/**
 * Occupancy Grid Tests.
 *
 * Why this test matters:
 * OccupancyGrid is the TS port of the Unity PointCloudData voxel grid —
 * the persisted depth-sample stream is folded into occupied 15 cm cells
 * with free-space carving. These tests pin the port's deliberate
 * deviations from Unity: per-cell observation counts (instead of render
 * buffer indices), skipping carving when camera and point share a cell
 * (instead of Unity's carve-then-re-add), and the round-consistent
 * getCellCenter formula (NOT Unity's +half-cell offset).
 */

import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { DepthSample } from '../types/ar-types';
import { OccupancyGrid } from './occupancy-grid';

const PROJECTION: Matrix4 = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

/**
 * Build a DepthSample with an identity-rotation camera, so a center-screen
 * point at depth d unprojects to cameraPos + (0, 0, -d).
 */
function makeSample(
  cameraPos: Vector3,
  depths: number[],
  options?: { withMatrix?: boolean }
): DepthSample {
  const withMatrix = options?.withMatrix ?? true;
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: depths.map((depthM) => ({ screenX: 0.5, screenY: 0.5, depthM })),
    ...(withMatrix ? { projectionMatrix: PROJECTION } : {}),
  };
}

/**
 * Build a single-cell sample (center-screen point) carrying an optional
 * per-point color — the Iter-8 RGB voxel-coloring shape.
 */
function makeColoredSample(
  cameraPos: Vector3,
  depthM: number,
  rgb?: readonly [number, number, number]
): DepthSample {
  return {
    timestamp: 0,
    cameraPos,
    cameraRot: [0, 0, 0, 1],
    points: [{ screenX: 0.5, screenY: 0.5, depthM, ...(rgb ? { rgb } : {}) }],
    projectionMatrix: PROJECTION,
  };
}

describe('OccupancyGrid', () => {
  describe('construction', () => {
    it('defaults to 15 cm cells and carve stop distance 2 (Unity parity)', () => {
      const grid = new OccupancyGrid();
      expect(grid.cellSizeM).toBeCloseTo(0.15);
      expect(grid.carveStopCells).toBe(2);
      expect(grid.size).toBe(0);
    });

    it('rejects invalid configuration', () => {
      expect(() => new OccupancyGrid({ cellSizeM: 0 })).toThrow(RangeError);
      expect(() => new OccupancyGrid({ cellSizeM: NaN })).toThrow(RangeError);
      expect(() => new OccupancyGrid({ carveStopCells: -1 })).toThrow(
        RangeError
      );
      expect(() => new OccupancyGrid({ carveStopCells: 1.5 })).toThrow(
        RangeError
      );
    });
  });

  describe('cell colors (Iter 8 RGB voxel coloring)', () => {
    /**
     * Why these tests matter:
     * The per-cell running-average color is what the cube visualizer
     * renders; the contract has two subtle parts a naive implementation
     * gets wrong: (1) color-less observations (rgb option off, old
     * recordings) must increment the OBSERVATION count without diluting
     * the color average toward black; (2) the average must be a true
     * per-channel mean of however many colored observations arrived.
     */
    it('returns null for unknown cells and for cells observed without color', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
      grid.addSample(makeColoredSample([0, 0, 0], 5)); // no rgb
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });

    it('stores a single colored observation verbatim', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [120, 45, 200]));
      expect(grid.getCellColor([0, 0, -5])).toEqual([120, 45, 200]);
    });

    it('averages repeated colored observations per channel (rounded)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [100, 0, 10]));
      grid.addSample(makeColoredSample([0, 0, 0], 5, [200, 100, 15]));
      expect(grid.getCellColor([0, 0, -5])).toEqual([150, 50, 13]); // 12.5 → 13
    });

    it('color-less observations do not dilute the average', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [100, 100, 100]));
      grid.addSample(makeColoredSample([0, 0, 0], 5)); // observed, no rgb
      expect(grid.getCellColor([0, 0, -5])).toEqual([100, 100, 100]);
      // …while the observation count still advanced to 2
      expect(grid.getOccupiedCells(2)).toContainEqual([0, 0, -5]);
    });

    it('ignores non-finite color channels defensively (bad persisted data)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(
        makeColoredSample([0, 0, 0], 5, [NaN, 10, 10] as unknown as readonly [
          number,
          number,
          number,
        ])
      );
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });

    it('clear() drops colors with the cells', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeColoredSample([0, 0, 0], 5, [1, 2, 3]));
      grid.clear();
      expect(grid.getCellColor([0, 0, -5])).toBeNull();
    });
  });

  describe('cell points (exact surface points — follow-up Item A)', () => {
    /**
     * Why these tests matter:
     * `getCellPoint` is what the COLMAP `points3D` export and the debug cubes
     * draw, instead of the 15 cm-lattice `getCellCenter`. The contract: it is
     * the running-average of the EXACT unprojected points that fell in the
     * cell (hugging the real surface), it differs from the cell center, and it
     * always stays inside the cell (|point − center| ≤ cellSizeM/2 per axis).
     */
    it('returns null for an unknown cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      expect(grid.getCellPoint([0, 0, -5])).toBeNull();
    });

    it('returns the exact unprojected point, NOT the cell center', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // depth 5.3 at center screen → exact point [0,0,-5.3]; it quantizes to
      // cell [0,0,-5] whose center is [0,0,-5].
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const cell: Vector3 = [0, 0, -5];
      expect(grid.getCellCenter(cell)).toEqual([0, 0, -5]);
      const point = grid.getCellPoint(cell)!;
      expect(point[0]).toBeCloseTo(0, 6);
      expect(point[1]).toBeCloseTo(0, 6);
      expect(point[2]).toBeCloseTo(-5.3, 6); // exact, not the -5 center
      // …and it lies inside the cell.
      expect(
        Math.abs(point[2] - grid.getCellCenter(cell)[2])
      ).toBeLessThanOrEqual(grid.cellSizeM / 2);
    });

    it('averages the exact points of repeated observations in a cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // 5.2 and 5.4 both quantize to cell [0,0,-5]; centroid z = -5.3.
      grid.addSample(makeSample([0, 0, 0], [5.2]));
      grid.addSample(makeSample([0, 0, 0], [5.4]));
      const point = grid.getCellPoint([0, 0, -5])!;
      expect(point[2]).toBeCloseTo(-5.3, 6);
    });

    it('carving that deletes a cell resets its retained point', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 0 });
      // Observe a cell at -5, then see a surface BEYOND it (-8) so the ray
      // passes through the -5 cell and carves it away as free space.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      expect(grid.getCellPoint([0, 0, -5])).not.toBeNull();
      grid.addSample(makeSample([0, 0, 0], [8.0])); // ray passes through -5 cell
      expect(grid.getCellPoint([0, 0, -5])).toBeNull();
    });

    it('clear() drops retained points with the cells', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.clear();
      expect(grid.getCellPoint([0, 0, -5])).toBeNull();
    });
  });

  describe('addSample', () => {
    it('adds an occupied cell per unprojected point and returns the count', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      // Two points on diverging rays (different screen positions), landing
      // in two distinct cells. (Same-ray points within a sample no longer
      // carve each other — see the point-order-independence test below.)
      const sample: DepthSample = {
        timestamp: 0,
        cameraPos: [0, 0, 0],
        cameraRot: [0, 0, 0, 1],
        points: [
          { screenX: 0.5, screenY: 0.5, depthM: 5 },
          { screenX: 0.9, screenY: 0.5, depthM: 8 },
        ],
        projectionMatrix: PROJECTION,
      };
      const added = grid.addSample(sample);
      expect(added).toBe(2);
      expect(grid.size).toBe(2);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
    });

    it('skips all points of samples without a projectionMatrix (old recordings)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(
        makeSample([0, 0, 0], [5], { withMatrix: false })
      );
      expect(added).toBe(0);
      expect(grid.size).toBe(0);
    });

    it('skips invalid depth points (zero, negative, non-finite)', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(makeSample([0, 0, 0], [0, -2, NaN, 4]));
      expect(added).toBe(1);
      expect(grid.getOccupiedCells()).toEqual([[0, 0, -4]]);
    });

    it('skips samples with a non-finite camera position', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      const added = grid.addSample(makeSample([NaN, 0, 0], [5]));
      expect(added).toBe(0);
      expect(grid.size).toBe(0);
    });

    it('counts repeated observations of the same cell', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.size).toBe(1);
      expect(grid.getOccupiedCells(2)).toEqual([[0, 0, -5]]);
    });

    it('does not carve the observed cell on re-observation (carve stop distance)', () => {
      // Unity parity: the carve ray stops carveStopCells dominant-axis
      // steps before the endpoint, so the endpoint's count accumulates
      // instead of being reset by carve-then-re-add.
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.getOccupiedCells(2)).toHaveLength(1);
    });

    it('keeps the cell when camera and point share it (deliberate Unity deviation)', () => {
      // Unity would carve the shared cell and immediately re-add it,
      // resetting per-cell state; the TS port skips carving instead (§2
      // edge case in the port plan).
      const grid = new OccupancyGrid({ cellSizeM: 10 });
      grid.addSample(makeSample([0, 0, 0], [2]));
      grid.addSample(makeSample([0, 0, 0], [2]));
      expect(grid.size).toBe(1);
      expect(grid.getOccupiedCells(2)).toHaveLength(1);
    });

    it('carves a previously observed cell when the scene is later seen through', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      // Surface at 5 m, then the surface disappears and a wall at 10 m
      // becomes visible along the same ray: the 5 m cell must be carved.
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -5]);
      grid.addSample(makeSample([0, 0, 0], [10]));
      expect(grid.getOccupiedCells()).not.toContainEqual([0, 0, -5]);
      expect(grid.getOccupiedCells()).toContainEqual([0, 0, -10]);
    });

    it('is independent of point order within a sample (endpoints survive same-sample carving)', () => {
      // Two points on the SAME center-screen ray at 5 and 10 cells, in one
      // sample. With a single carve+increment pass the outcome depends on
      // iteration order: if the near point is incremented before the far
      // point's ray is carved, the far ray erases the near endpoint.
      // Carving runs as a first pass so neither order can erase the other's
      // endpoint — both survive. (Deeper-carves-nearer still applies ACROSS
      // samples, see the test above.)
      const near: Vector3 = [0, 0, -5];
      const far: Vector3 = [0, 0, -10];

      const nearFirst = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      nearFirst.addSample(makeSample([0, 0, 0], [5, 10]));

      const farFirst = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 2 });
      farFirst.addSample(makeSample([0, 0, 0], [10, 5]));

      for (const grid of [nearFirst, farFirst]) {
        expect(grid.getOccupiedCells()).toContainEqual(near);
        expect(grid.getOccupiedCells()).toContainEqual(far);
      }
    });
  });

  describe('getOccupiedCells / getCellCenter', () => {
    it('filters by minimum observation count', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [5]));
      // Second cell from a sideways-shifted camera (separate ray)
      grid.addSample(makeSample([10, 0, 0], [8]));
      expect(grid.getOccupiedCells()).toHaveLength(2);
      expect(grid.getOccupiedCells(2)).toEqual([[0, 0, -5]]);
    });

    it('returns the round-consistent cell center (cell · cellSizeM)', () => {
      // Deliberately NOT Unity's CellToWorldPos (+cellSize/2), which is
      // off by half a cell under round-quantization (§2 of the port plan).
      const grid = new OccupancyGrid({ cellSizeM: 0.5 });
      expect(grid.getCellCenter([2, -4, 0])).toEqual([1, -2, 0]);
    });
  });

  describe('raycast', () => {
    // A large carve stop keeps carving out of the way: these tests need
    // two occupied cells on one straight test ray, which depth samples on
    // that same ray would otherwise carve away.
    function gridWithCellsAt5And8(): OccupancyGrid {
      const grid = new OccupancyGrid({ cellSizeM: 1, carveStopCells: 10 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      grid.addSample(makeSample([0, 0, 0], [8]));
      return grid;
    }

    it('returns the center of the first occupied cell along the ray', () => {
      const hit = gridWithCellsAt5And8().raycast([0, 0, 0], [0, 0, -20]);
      expect(hit).toEqual([0, 0, -5]);
    });

    it('returns null when no occupied cell is on the ray', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.raycast([10, 10, 10], [10, 10, -20])).toBeNull();
      expect(grid.raycast([0, 0, 0], [NaN, 0, -20])).toBeNull();
    });

    it('respects a minimum observation count', () => {
      const grid = gridWithCellsAt5And8();
      grid.addSample(makeSample([0, 0, 0], [8]));
      expect(grid.raycast([0, 0, 0], [0, 0, -20], 2)).toEqual([0, 0, -8]);
    });
  });

  describe('clear', () => {
    it('empties the grid', () => {
      const grid = new OccupancyGrid({ cellSizeM: 1 });
      grid.addSample(makeSample([0, 0, 0], [5]));
      expect(grid.size).toBe(1);
      grid.clear();
      expect(grid.size).toBe(0);
      expect(grid.getOccupiedCells()).toEqual([]);
    });
  });

  /**
   * Why this matters: a long session re-observes already-mapped surfaces for
   * minutes. `getRevision()` lets consumers (cube refresh / occluder re-mesh)
   * skip their O(cells) re-derive when the occupied set can no longer change —
   * the dominant idle-time saving. It must bump while a cell could still cross
   * some `minConfidence` threshold (count ≤ 10), then go quiet.
   */
  describe('getRevision — settled-scene skip signal', () => {
    it('starts at 0', () => {
      expect(new OccupancyGrid().getRevision()).toBe(0);
    });

    it('bumps while count ≤ 10 (possible threshold crossings), then stays put', () => {
      const grid = new OccupancyGrid();
      expect(grid.getRevision()).toBe(0);

      // 1st observation creates the cell (count 1) → bump.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const r1 = grid.getRevision();
      expect(r1).toBeGreaterThan(0);

      // Observations 2..10 raise the count through 10 — each a possible
      // threshold crossing → each bumps.
      for (let i = 0; i < 9; i++) grid.addSample(makeSample([0, 0, 0], [5.3]));
      const r10 = grid.getRevision();
      expect(r10).toBe(r1 + 9);

      // The 11th pushes count past 10; from here re-observing the SETTLED cell
      // can change no consumer's occupied set → no more bumps.
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      grid.addSample(makeSample([0, 0, 0], [5.3]));
      expect(grid.getRevision()).toBe(r10);
    });

    it('bumps on clear when non-empty (and not when already empty)', () => {
      const grid = new OccupancyGrid();
      expect(grid.getRevision()).toBe(0);
      grid.clear(); // empty → no-op
      expect(grid.getRevision()).toBe(0);

      grid.addSample(makeSample([0, 0, 0], [5.3]));
      const r = grid.getRevision();
      grid.clear();
      expect(grid.getRevision()).toBe(r + 1);
    });
  });
});
