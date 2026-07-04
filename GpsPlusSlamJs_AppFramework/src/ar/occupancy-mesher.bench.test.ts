/**
 * Occupancy mesher — performance benchmark (opt-in, not a CI gate).
 *
 * Run with `BENCH=1`:
 *   $env:BENCH='1'; pnpm run test:unit -- src/ar/occupancy-mesher.bench.test.ts --disable-console-intercept
 *
 * Drives the 2026-06-30 mesher perf optimization: measures grid build,
 * getOccupiedCells, and each mesh mode (median of N runs) on a deterministic
 * synthetic grid at scale, so before/after deltas are comparable. Wall-clock is
 * machine-dependent — this is a measurement tool, never an assertion gate.
 */

import { describe, it, expect } from 'vitest';
import {
  meshOccupiedCells,
  type MeshOccupiedCellsOptions,
} from './occupancy-mesher';
import { buildSyntheticSurfaceGrid } from '../test-utils/synthetic-occupancy-grid';
import type { OccupancyGrid } from './occupancy-grid';

const RUN = process.env.BENCH === '1';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function timeMs(runs: number, fn: () => void): number {
  for (let i = 0; i < 3; i++) fn(); // warm up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return +median(samples).toFixed(2);
}

describe.skipIf(!RUN)('occupancy mesher — perf benchmark', () => {
  // Benchmarks legitimately run for tens of seconds — an explicit timeout so
  // the documented BENCH=1 invocation is green instead of tripping vitest's
  // 5 s default (plan step 1, 2026-07-04 code-health pass).
  it(
    'measures grid build + getOccupiedCells + each mesh mode at scale',
    { timeout: 120_000 },
    () => {
      const SIDE = 160; // 160×160×1 = 25,600 cells
      const RUNS = 15;

      const buildMs = timeMs(5, () => {
        buildSyntheticSurfaceGrid({ cellsX: SIDE, cellsZ: SIDE, thickness: 1 });
      });

      const { grid, cellSizeM } = buildSyntheticSurfaceGrid({
        cellsX: SIDE,
        cellsZ: SIDE,
        thickness: 1,
      });
      const occMs = timeMs(RUNS, () => {
        grid.getOccupiedCells(5);
      });
      const cells = grid.getOccupiedCells(5);
      const getCellPoint = (c: Parameters<OccupancyGrid['getCellPoint']>[0]) =>
        grid.getCellPoint(c);

      const modes: {
        name: string;
        opts: MeshOccupiedCellsOptions | undefined;
      }[] = [
        { name: 'per-face', opts: undefined },
        { name: 'greedy', opts: { greedy: true } },
        { name: 'smooth', opts: { mode: 'smooth', getCellPoint } },
        { name: 'corner-fit', opts: { mode: 'corner-fit', getCellPoint } },
      ];
      const meshMs = modes.map(({ name, opts }) => ({
        name,
        ms: timeMs(RUNS, () => {
          meshOccupiedCells(cells, cellSizeM, opts);
        }),
      }));

      console.info(
        '[mesher bench] ' +
          JSON.stringify({
            cells: cells.length,
            gridBuildMs: buildMs,
            getOccupiedCellsMs: occMs,
            meshMs,
          })
      );
      expect(cells.length).toBeGreaterThan(0);
    }
  );

  it(
    'long-session scaling: per-refresh cost + memory at ~100k cells',
    { timeout: 120_000 },
    () => {
      const RUNS = 8;
      const heap0 = process.memoryUsage().heapUsed;
      const { grid, cellSizeM } = buildSyntheticSurfaceGrid({
        cellsX: 320,
        cellsZ: 320,
        thickness: 1,
      }); // 102,400 cells
      const heap1 = process.memoryUsage().heapUsed;
      const cells = grid.getOccupiedCells(5);
      const getCellPoint = (c: Parameters<OccupancyGrid['getCellPoint']>[0]) =>
        grid.getCellPoint(c);

      const occMs = timeMs(RUNS, () => grid.getOccupiedCells(5));
      const perFaceMs = timeMs(RUNS, () =>
        meshOccupiedCells(cells, cellSizeM, undefined)
      );
      const greedyMs = timeMs(RUNS, () =>
        meshOccupiedCells(cells, cellSizeM, { greedy: true })
      );
      const smoothMs = timeMs(RUNS, () =>
        meshOccupiedCells(cells, cellSizeM, { mode: 'smooth', getCellPoint })
      );

      console.info(
        '[long-session bench] ' +
          JSON.stringify({
            cells: cells.length,
            gridHeapKiB: +((heap1 - heap0) / 1024).toFixed(0),
            bytesPerCell: +((heap1 - heap0) / cells.length).toFixed(0),
            getOccupiedCellsMs: occMs,
            perFaceMs,
            greedyMs,
            smoothMs,
            // A persistent-occluder refresh = getOccupiedCells + mesh, every
            // depth.intervalMs (default 500 ms). This grows O(total cells).
            refreshMs_perFace: +(occMs + perFaceMs).toFixed(1),
          })
      );
      expect(cells.length).toBeGreaterThan(0);
    }
  );
});
