/**
 * Occupancy mesh — real-recording integration + performance probe.
 *
 * Why this test matters (2026-06-13-occupancy-mesh-options-plan.md §8 "Test
 * data strategy"): the pure mesher's correctness is pinned by synthetic fixtures
 * + property tests (`occupancy-mesher.*.test.ts` in the framework). THIS test is
 * the *second* layer — it runs a real recorded session through the EXISTING
 * `loadRecording` → `OccupancyGrid.addSample` path and meshes the result, to:
 *   1. assert oracle-free invariants that hold for ANY input (watertight even
 *      edge cover for the per-face mesh, in-range indices, finite positions,
 *      one AABB per cell, greedy ≤ per-face triangles), and
 *   2. record the real-room SCALE/PERF numbers (occupied-cell count, triangle
 *      counts, greedy reduction, single-pass mesh time) the plan's §7 budget
 *      gate needs as a CI-measurable proxy ahead of the on-device check.
 *
 * Skip-if-missing: `TestDataJs-Other` is local-only (absent in CI), so this
 * enriches local runs and probes perf but never gates — exactly as the plan
 * specifies. It does NOT replace the synthetic unit/property gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { meshOccupiedCells } from 'gps-plus-slam-app-framework/ar/occupancy-mesher';
import type { DepthSample } from 'gps-plus-slam-app-framework/types';
import { loadRecording } from '../storage/recording-loader';

// A recent depth-bearing recording (its recordDepthSample actions carry real
// {screenX,screenY,depthM,rgb} points + cameraPos/cameraRot + projectionMatrix).
const ZIP = path.resolve(
  __dirname,
  '../../../../gps-plus-slam/TestDataJs-Other/compass-tests/2026-06-28_16-14-44utc.zip'
);
const HAS_ZIP = fs.existsSync(ZIP);

/** Quantize a coordinate to an integer half-cell lattice index (exact). */
function halfIndex(coord: number, cellSizeM: number): number {
  return Math.round(coord / (cellSizeM / 2));
}

/** Every edge of a watertight (closed) surface is covered an even # of times. */
function maxOddEdgeCount(positions: Float32Array, cellSizeM: number): number {
  const edges = new Map<string, number>();
  const key = (i: number): string => {
    const o = i * 3;
    return `${halfIndex(positions[o]!, cellSizeM)},${halfIndex(
      positions[o + 1]!,
      cellSizeM
    )},${halfIndex(positions[o + 2]!, cellSizeM)}`;
  };
  const add = (a: number, b: number): void => {
    const ka = key(a);
    const kb = key(b);
    const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edges.set(e, (edges.get(e) ?? 0) + 1);
  };
  // positions are 4 verts per quad; indices follow (0,1,2,0,2,3) — reconstruct
  // the two triangles per quad directly from the vertex stream.
  const quadCount = positions.length / 3 / 4;
  for (let q = 0; q < quadCount; q++) {
    const b = q * 4;
    for (const [i, j] of [
      [b, b + 1],
      [b + 1, b + 2],
      [b + 2, b],
      [b, b + 2],
      [b + 2, b + 3],
      [b + 3, b],
    ] as const) {
      add(i, j);
    }
  }
  let odd = 0;
  for (const c of edges.values()) if (c % 2 !== 0) odd++;
  return odd;
}

describe.skipIf(!HAS_ZIP)(
  'occupancy mesh — real recording integration + perf probe',
  () => {
    // 60 s: replays a real recorded room through grid + mesher — ~5-10 s on a
    // dev machine, so the 5 s vitest default flaked (worse under full-suite
    // parallel load). Invariant assertions are structural, not wall-clock.
    it(
      'meshes a real recorded room: invariants hold + scale/perf recorded',
      { timeout: 60_000 },
      async () => {
        const loaded = await loadRecording(
          new Uint8Array(fs.readFileSync(ZIP))
        );
        const depthSamples = loaded.actions
          .map((e) => e.action)
          .filter((a) => a.type === 'recording/recordDepthSample')
          .map((a) => a.payload as DepthSample);

        // The recording must actually contain depth (this fixture does); if a
        // future fixture lacks projection-bearing depth the grid stays empty and
        // this assertion flags it rather than silently passing on nothing.
        expect(depthSamples.length).toBeGreaterThan(0);

        const grid = new OccupancyGrid({ cellSizeM: 0.15 });
        for (const s of depthSamples) grid.addSample(s);
        const cells = grid.getOccupiedCells(3); // same minConfidence floor as the cubes
        expect(cells.length).toBeGreaterThan(0);

        const t0 = performance.now();
        const perFace = meshOccupiedCells(cells, grid.cellSizeM);
        const tPerFace = performance.now() - t0;

        const t1 = performance.now();
        const greedy = meshOccupiedCells(cells, grid.cellSizeM, {
          greedy: true,
        });
        const tGreedy = performance.now() - t1;

        const perFaceTris = perFace.indices.length / 3;
        const greedyTris = greedy.indices.length / 3;

        // --- Oracle-free invariants (hold for ANY input) ---
        // Per-face surface is watertight: no edge covered an odd number of times.
        expect(maxOddEdgeCount(perFace.positions, grid.cellSizeM)).toBe(0);
        // One AABB per occupied cell, unaffected by greedy.
        expect(perFace.aabbs.length).toBe(cells.length);
        expect(greedy.aabbs.length).toBe(cells.length);
        // Greedy never adds triangles and produces a non-empty surface.
        expect(greedyTris).toBeGreaterThan(0);
        expect(greedyTris).toBeLessThanOrEqual(perFaceTris);
        // Indices in range; positions finite.
        const verts = perFace.positions.length / 3;
        for (const idx of perFace.indices) expect(idx).toBeLessThan(verts);
        expect(perFace.positions.every((p) => Number.isFinite(p))).toBe(true);

        // --- Scale / perf numbers (the §7 budget proxy) ---
        // Logged, not asserted as a hard time bound (machine-dependent). The
        // structural bounds above are the assertions; these inform the budget.
        console.info(
          '[occupancy-mesh perf probe]',
          JSON.stringify({
            depthSamples: depthSamples.length,
            occupiedCells: cells.length,
            perFaceTriangles: perFaceTris,
            greedyTriangles: greedyTris,
            greedyReduction: +(perFaceTris / Math.max(1, greedyTris)).toFixed(
              1
            ),
            perFaceMeshMs: +tPerFace.toFixed(1),
            greedyMeshMs: +tGreedy.toFixed(1),
            cellSizeM: grid.cellSizeM,
          })
        );
      }
    );
  }
);
