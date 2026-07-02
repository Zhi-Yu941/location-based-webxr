/**
 * Parameter sweep for "usable mesh ASAP" — on a real recording (local-only).
 *
 * Goal (user, 2026-06-30): find the grid-derivation defaults that build a usable
 * occluder mesh fastest. The recorded depth-point stream has the capture params
 * (`depth.intervalMs` / `depth.gridSize`) baked in, so a replay can only vary the
 * GRID params — `occupancy.minConfidence`, `occupancy.cellSizeM` — which are
 * exactly what gate how quickly an observed surface becomes a meshed cell.
 *
 * Method (no manual extraction — the recording drives the exploration): replay
 * the depth samples ONE AT A TIME and, at sample milestones, count occupied
 * cells (the occluder's mesh-coverage proxy — triangles scale with surface
 * cells) at each minConfidence, for a few cell sizes. Reports:
 *   - coverage(sample, minConfidence, cellSize) — how fast each config fills,
 *   - samples-to-80%-of-its-own-final — time-to-converge per config.
 *
 * Skip-if-missing: local-only test data; logs a table, asserts only sanity.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import type { DepthSample } from 'gps-plus-slam-app-framework/types';
import { loadRecording } from '../storage/recording-loader';

const ZIP = path.resolve(
  __dirname,
  '../../../../gps-plus-slam/TestDataJs-Other/2026-06-30_22-04-58utc-param-sweep.zip'
);
const HAS_ZIP = fs.existsSync(ZIP);

const MIN_CONFIDENCES = [1, 2, 3, 5] as const;
const CELL_SIZES = [0.1, 0.15, 0.2] as const;

describe.skipIf(!HAS_ZIP)('occupancy param sweep — fastest usable mesh', () => {
  // 60 s: the sweep replays every depth sample × 4 minConfidences × 3 cell
  // sizes on a real recording — ~5 s alone on a dev machine, so the 5 s vitest
  // default flaked (worse under full-suite parallel load). The assertions are
  // sanity checks, not wall-clock, so the generous budget weakens nothing.
  it(
    'measures coverage growth vs minConfidence / cellSize on the recording',
    { timeout: 60_000 },
    async () => {
      const loaded = await loadRecording(new Uint8Array(fs.readFileSync(ZIP)));
      const samples = loaded.actions
        .map((e) => e.action)
        .filter((a) => a.type === 'recording/recordDepthSample')
        .map((a) => a.payload as DepthSample);
      expect(samples.length).toBeGreaterThan(0);

      const milestones = [5, 10, 20, 40, 80, samples.length].filter(
        (m, i, arr) => m <= samples.length && arr.indexOf(m) === i
      );

      type Row = {
        cellSizeM: number;
        minConfidence: number;
        coverageAtSample: Record<number, number>;
        finalCells: number;
        samplesTo80pct: number | null;
      };
      const rows: Row[] = [];

      for (const cellSizeM of CELL_SIZES) {
        const grid = new OccupancyGrid({ cellSizeM });
        // Per-sample coverage curve for each minConfidence (one grid, many queries).
        const curve: Record<number, number[]> = {};
        for (const mc of MIN_CONFIDENCES) curve[mc] = [];
        for (let i = 0; i < samples.length; i++) {
          grid.addSample(samples[i]!);
          for (const mc of MIN_CONFIDENCES) {
            curve[mc]!.push(grid.getOccupiedCells(mc).length);
          }
        }
        for (const mc of MIN_CONFIDENCES) {
          const series = curve[mc]!;
          const finalCells = series[series.length - 1]!;
          const target = finalCells * 0.8;
          const idx = series.findIndex((v) => v >= target);
          rows.push({
            cellSizeM,
            minConfidence: mc,
            coverageAtSample: Object.fromEntries(
              milestones.map((m) => [m, series[m - 1] ?? finalCells])
            ),
            finalCells,
            samplesTo80pct: idx >= 0 ? idx + 1 : null,
          });
        }
      }

      // Compact table: coverage (occupied cells) at each milestone per config.
      const header = `cellSz mc | ${milestones.map((m) => `s${m}`.padStart(6)).join(' ')} | final`;
      const lines = rows.map(
        (r) =>
          `${r.cellSizeM.toFixed(2)}  ${String(r.minConfidence).padStart(1)} | ` +
          milestones
            .map((m) => String(r.coverageAtSample[m] ?? '').padStart(6))
            .join(' ') +
          ` | ${r.finalCells}`
      );
      // eslint-disable-next-line no-console
      console.info(
        `[param sweep] samples=${samples.length}\n${header}\n${lines.join('\n')}`
      );
      expect(rows.every((r) => r.finalCells >= 0)).toBe(true);
    }
  );
});
