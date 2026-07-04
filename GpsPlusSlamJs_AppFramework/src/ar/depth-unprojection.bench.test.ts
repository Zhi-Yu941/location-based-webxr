/**
 * Depth unprojection — performance benchmark (opt-in, not a CI gate).
 *
 * Run with `BENCH=1`:
 *   $env:BENCH='1'; pnpm run test:unit -- src/ar/depth-unprojection.bench.test.ts --disable-console-intercept
 *
 * Drives the 2026-06-30 unprojection optimization: times N `unproject` calls
 * (the per-depth-point hot path that dominates OccupancyGrid build / replay).
 * Wall-clock is machine-dependent — a measurement tool, never an assertion gate.
 */

import { describe, it, expect } from 'vitest';
import { createDepthUnprojector } from './depth-unprojection';
import type { DepthPoint } from '../types/ar-types';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';

const RUN = process.env.BENCH === '1';

// A realistic perspective projection (column-major), camera pose with a real
// rotation — so the inverse-projection + quaternion rotation are both exercised.
const PROJECTION = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0,
] as unknown as Matrix4;
const CAMERA_POS: Vector3 = [1.5, -0.5, 2.25];
// normalized quaternion (~25° about a tilted axis)
const q = ((): Quaternion => {
  const v = [0.1, 0.2, 0.3, 0.95];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!, v[3]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n, v[3]! / n];
})();

function makePoints(count: number): DepthPoint[] {
  const points: DepthPoint[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic spread across the view; depth 0.5–5 m.
    points.push({
      screenX: ((i * 7919) % 1000) / 1000,
      screenY: ((i * 6131) % 1000) / 1000,
      depthM: 0.5 + (((i * 5003) % 1000) / 1000) * 4.5,
    });
  }
  return points;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

describe.skipIf(!RUN)('depth unprojection — perf benchmark', () => {
  // Explicit timeout: benchmark runs exceed vitest's 5 s default (plan step 1).
  it('times N unproject calls', { timeout: 120_000 }, () => {
    const N = 128_000;
    const RUNS = 15;
    const points = makePoints(N);
    const unprojector = createDepthUnprojector(CAMERA_POS, q, PROJECTION)!;
    expect(unprojector).not.toBeNull();

    // warm up
    for (let w = 0; w < 3; w++)
      for (const p of points) unprojector.unproject(p);

    const samples: number[] = [];
    let live = 0;
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      for (const p of points) {
        if (unprojector.unproject(p)) live++;
      }
      samples.push(performance.now() - t0);
    }
    console.info(
      '[unproject bench] ' +
        JSON.stringify({
          points: N,
          medianMs: +median(samples).toFixed(2),
          nsPerPoint: +((median(samples) * 1e6) / N).toFixed(1),
        })
    );
    expect(live).toBeGreaterThan(0);
  });
});
