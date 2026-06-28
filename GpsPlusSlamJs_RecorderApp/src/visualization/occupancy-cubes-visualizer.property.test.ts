/**
 * Property tests for `pickNearestSubset` — the viewer-local over-cap cube
 * selector (Issue B1 of the 2026-06-22 cube cadence/locality plan).
 *
 * Why this test file matters:
 * The whole point of B1 is "draw the cells around the user, not a random
 * scatter." A single example test cannot prove the ranking is correct for
 * arbitrary cell clouds and eye positions. These properties pin the contract
 * across the full space of inputs the way examples cannot:
 *  - result size is exactly min(count, n) — never over the cap, never short;
 *  - the partition is correct: EVERY kept cell is at least as near as EVERY
 *    dropped cell (the defining property of nearest-N);
 *  - the carried position matches what `positionOf` returns for that cell, so
 *    the draw loop never re-fetches or mismatches;
 *  - selection is deterministic for a fixed eye (no RNG).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { pickNearestSubset } from './occupancy-cubes-visualizer';

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const arbVec3: fc.Arbitrary<readonly [number, number, number]> = fc.tuple(
  finite(-50, 50),
  finite(-50, 50),
  finite(-50, 50)
);

/** A flat list of 3D points used as the "cells". */
const arbPoints = fc.array(arbVec3, { minLength: 0, maxLength: 40 });

const d2 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

describe('pickNearestSubset', () => {
  it('returns exactly min(count, n) items', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          const result = pickNearestSubset(points, count, eye, (p) => p);
          expect(result).toHaveLength(Math.min(count, points.length));
        }
      )
    );
  });

  it('keeps the nearest cells: every kept cell ≤ every dropped cell by distance', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          const kept = pickNearestSubset(points, count, eye, (p) => p);
          const keptSet = new Set(kept.map((k) => k.item));
          const dropped = points.filter((p) => !keptSet.has(p));

          const maxKept = Math.max(0, ...kept.map((k) => d2(k.item, eye)));
          for (const drop of dropped) {
            // Every dropped cell must be at least as far as the farthest kept
            // one (the defining nearest-N partition). `>=` not `>` because
            // equidistant ties may land on either side.
            expect(d2(drop, eye)).toBeGreaterThanOrEqual(maxKept);
          }
        }
      )
    );
  });

  it('carries each cell its own position from positionOf', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          // Offset position so a mismatch (carrying the wrong cell's pos) is
          // detectable, while keeping the ranking well-defined.
          const positionOf = (
            p: readonly [number, number, number]
          ): readonly [number, number, number] => [p[0] + 100, p[1], p[2]];
          const result = pickNearestSubset(points, count, eye, positionOf);
          for (const { item, pos } of result) {
            expect(pos).toEqual(positionOf(item));
          }
        }
      )
    );
  });

  it('is deterministic for a fixed eye (no RNG)', () => {
    fc.assert(
      fc.property(
        arbPoints,
        fc.integer({ min: 0, max: 60 }),
        arbVec3,
        (points, count, eye) => {
          const a = pickNearestSubset(points, count, eye, (p) => p);
          const b = pickNearestSubset(points, count, eye, (p) => p);
          expect(a.map((x) => x.item)).toEqual(b.map((x) => x.item));
        }
      )
    );
  });

  it('treats a negative or zero count as an empty selection', () => {
    const points: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0, 0],
      [2, 0, 0],
    ];
    expect(pickNearestSubset(points, 0, [0, 0, 0], (p) => p)).toHaveLength(0);
    expect(pickNearestSubset(points, -5, [0, 0, 0], (p) => p)).toHaveLength(0);
  });
});
