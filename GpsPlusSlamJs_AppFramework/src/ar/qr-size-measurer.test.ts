/**
 * Tests for createQrSizeMeasurer — the shared depth→size piece.
 *
 * Why these tests matter:
 * - This is the extraction the Recorder reuses; its contract (sample → estimate,
 *   per-marker accumulation, null when un-sampleable) must be pinned so the
 *   refactor of the demo controller didn't change behaviour.
 * - WS-A made the dense interior plane fit the PRIMARY path: corner depth is no
 *   longer required (a small QR whose corners fall between depth nodes is still
 *   sized from the interior). The corner-based estimate remains a FALLBACK for
 *   when the interior lattice is too sparse to fit. These tests pin both paths.
 * - A fake unprojector that maps a normalized corner to a planar square lets us
 *   assert the full pipeline without a device.
 */

import { describe, it, expect } from 'vitest';
import {
  createQrSizeMeasurer,
  type QrSizeDepthContext,
} from './qr-size-measurer';
import type { Point2 } from './qr-pose';
import type { Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types';

const IMAGE = { width: 100, height: 100 };

// A 0.2 m planar square: corners at screen 0.4/0.6, depth 1.
const SQUARE_CORNERS: Point2[] = [
  { x: 40, y: 40 }, // TL → screen (0.4, 0.4)
  { x: 60, y: 40 }, // TR
  { x: 60, y: 60 }, // BR
  { x: 40, y: 60 }, // BL
];

/** unproject([sx, sy, d]) = [sx, sy, d] — a planar square at z = d. */
const PLANAR_UNPROJECTOR = {
  unproject: (p: DepthPoint): Vector3 | null => [
    p.screenX,
    p.screenY,
    p.depthM,
  ],
};

/**
 * Fake depth context: every screen point reads depth 1 and unprojects onto the
 * z=1 plane, so the 0.4↔0.6 corners give a 0.2 m planar square (perfect quality).
 */
function planarSquareCtx(): QrSizeDepthContext {
  return { depthAt: () => 1, unprojector: PLANAR_UNPROJECTOR };
}

/** Screen positions of the 4 corners (normalized) for the corner-only ctx. */
const CORNER_SCREENS = [
  { x: 0.4, y: 0.4 },
  { x: 0.6, y: 0.4 },
  { x: 0.6, y: 0.6 },
  { x: 0.4, y: 0.6 },
];

/**
 * Depth ONLY near the corners (within `r`), null in the interior — so the dense
 * lattice is empty and the corner-based FALLBACK path is exercised. `skip` drops
 * depth at the listed corner indices (to simulate an un-sampleable corner).
 */
function cornersOnlyCtx(opts?: {
  r?: number;
  skip?: number[];
  unproject?: (p: DepthPoint) => Vector3 | null;
}): QrSizeDepthContext {
  // r below the corner→nearest-interior-lattice-point distance (~0.02) so the
  // interior lattice stays empty and the corner-based fallback is exercised.
  const r = opts?.r ?? 0.015;
  const skip = new Set(opts?.skip ?? []);
  return {
    depthAt: (sx, sy) => {
      for (let i = 0; i < CORNER_SCREENS.length; i++) {
        if (skip.has(i)) continue;
        const c = CORNER_SCREENS[i] as { x: number; y: number };
        if (Math.hypot(sx - c.x, sy - c.y) <= r) return 1;
      }
      return null;
    },
    unprojector: { unproject: opts?.unproject ?? PLANAR_UNPROJECTOR.unproject },
  };
}

describe('createQrSizeMeasurer', () => {
  it('returns null when there are not exactly 4 corners', () => {
    const measurer = createQrSizeMeasurer();
    const three = SQUARE_CORNERS.slice(0, 3);
    expect(measurer.measure('q', three, IMAGE, planarSquareCtx())).toBeNull();
  });

  it('returns null when depth is unavailable everywhere (neither path can run)', () => {
    const measurer = createQrSizeMeasurer();
    const ctx: QrSizeDepthContext = {
      ...planarSquareCtx(),
      depthAt: () => null,
    };
    expect(measurer.measure('q', SQUARE_CORNERS, IMAGE, ctx)).toBeNull();
  });

  it('measures a planar square via the dense path and converges to "estimated"', () => {
    const measurer = createQrSizeMeasurer({ minSamples: 2, maxSpreadM: 0.01 });

    const first = measurer.measure(
      'q',
      SQUARE_CORNERS,
      IMAGE,
      planarSquareCtx()
    );
    expect(first).not.toBeNull();
    // Dense path: interiorSamples is the lattice (latticeSize 7 → 49 reads),
    // not the single centroid; corners are still sampled best-effort.
    expect(first!.interiorSamples).toHaveLength(49);
    expect(first!.cornerSamples).toHaveLength(4);
    expect(first!.estimate.status).toBe('measuring'); // 1 < minSamples
    expect(first!.estimate.estimateM).toBeCloseTo(0.2, 6);

    const second = measurer.measure(
      'q',
      SQUARE_CORNERS,
      IMAGE,
      planarSquareCtx()
    );
    expect(second!.estimate.status).toBe('estimated'); // ≥ minSamples, spread 0
    expect(second!.estimate.estimateM).toBeCloseTo(0.2, 6);
    expect(second!.estimate.sampleCount).toBe(2);
  });

  it('accumulates per marker text (independent estimates)', () => {
    const measurer = createQrSizeMeasurer({ minSamples: 1 });
    measurer.measure('a', SQUARE_CORNERS, IMAGE, planarSquareCtx());
    expect(measurer.current('a').sampleCount).toBe(1);
    expect(measurer.current('b').status).toBe('unknown');
    expect(measurer.current('b').sampleCount).toBe(0);
  });

  it('reset(text) clears one marker; reset() clears all', () => {
    const measurer = createQrSizeMeasurer({ minSamples: 1 });
    measurer.measure('a', SQUARE_CORNERS, IMAGE, planarSquareCtx());
    measurer.measure('b', SQUARE_CORNERS, IMAGE, planarSquareCtx());

    measurer.reset('a');
    expect(measurer.current('a').sampleCount).toBe(0);
    expect(measurer.current('b').sampleCount).toBe(1);

    measurer.reset();
    expect(measurer.current('b').sampleCount).toBe(0);
  });

  it('current(text) is "unknown" before any measurement', () => {
    const measurer = createQrSizeMeasurer();
    const e = measurer.current('never-seen');
    expect(e.status).toBe('unknown');
    expect(e.estimateM).toBeNull();
  });
});

describe('createQrSizeMeasurer — dense path is independent of corner depth (WS-A)', () => {
  // A ctx whose depth grid has HOLES on the corners (the high-contrast print
  // boundary where the coarse depth map has no near reading), depth 1 elsewhere.
  function holeyCtx(
    holes: Array<{ x: number; y: number; r: number }>
  ): QrSizeDepthContext {
    return {
      depthAt: (sx, sy) => {
        for (const h of holes) {
          if (Math.hypot(sx - h.x, sy - h.y) <= h.r) return null;
        }
        return 1;
      },
      unprojector: PLANAR_UNPROJECTOR,
    };
  }

  it('measures despite a corner hole even with the corner fallbacks disabled', () => {
    // The dense interior fit does not need corner depth, so a corner hole + a
    // disabled inset/reconstruct fallback no longer forces null (it did before
    // WS-A). cornerSamples is null (corner un-sampleable) but the size is exact.
    const ctx = holeyCtx([{ x: 0.4, y: 0.4, r: 0.05 }]);
    const measurer = createQrSizeMeasurer({
      minSamples: 1,
      cornerInsetFractions: [],
      maxReconstructedCorners: 0,
    });
    const m = measurer.measure('q', SQUARE_CORNERS, IMAGE, ctx);
    expect(m).not.toBeNull();
    expect(m!.estimate.estimateM).toBeCloseTo(0.2, 6);
    expect(m!.cornerSamples).toBeNull(); // corner could not be sampled…
    expect(m!.interiorSamples.length).toBeGreaterThan(10); // …but the lattice could
  });

  it('measures even when TWO corner regions are missing (the small-QR win)', () => {
    // Two corners + their insets unsampleable previously returned null; the dense
    // interior fit still recovers the size from the rest of the face.
    const ctx = holeyCtx([
      { x: 0.4, y: 0.4, r: 0.05 },
      { x: 0.6, y: 0.4, r: 0.05 },
    ]);
    const measurer = createQrSizeMeasurer({ minSamples: 1 });
    const m = measurer.measure('q', SQUARE_CORNERS, IMAGE, ctx);
    expect(m).not.toBeNull();
    expect(m!.estimate.estimateM).toBeCloseTo(0.2, 6);
  });

  it('still reports best-effort corner samples (inset fallback) on the dense path', () => {
    // A tiny hole exactly on the TL corner: the dense path measures the size, and
    // cornerSamples is still filled via the inset fallback at the TRUE corner pos.
    const ctx = holeyCtx([{ x: 0.4, y: 0.4, r: 0.01 }]);
    const measurer = createQrSizeMeasurer({ minSamples: 1 });
    const m = measurer.measure('q', SQUARE_CORNERS, IMAGE, ctx);
    expect(m).not.toBeNull();
    expect(m!.estimate.estimateM).toBeCloseTo(0.2, 6);
    expect(m!.cornerSamples).not.toBeNull();
    expect(m!.cornerSamples![0].screenX).toBeCloseTo(0.4, 6);
    expect(m!.cornerSamples![0].screenY).toBeCloseTo(0.4, 6);
  });
});

describe('createQrSizeMeasurer — corner-based FALLBACK (sparse interior)', () => {
  it('falls back to the corner estimate when the interior lattice is empty', () => {
    // Depth only near the corners → the dense lattice is empty → the corner-based
    // estimate runs. interiorSamples is the (empty) centroid sample set.
    const measurer = createQrSizeMeasurer({ minSamples: 1 });
    const m = measurer.measure('q', SQUARE_CORNERS, IMAGE, cornersOnlyCtx());
    expect(m).not.toBeNull();
    expect(m!.estimate.estimateM).toBeCloseTo(0.2, 6);
    expect(m!.cornerSamples).toHaveLength(4);
    expect(m!.interiorSamples).toHaveLength(0); // centroid has no depth here
  });

  it('returns null when the interior is empty AND a corner is un-sampleable', () => {
    // No interior depth (dense fails) and TL has no depth with fallbacks disabled
    // (corner estimate fails) → neither path can run.
    const measurer = createQrSizeMeasurer({
      cornerInsetFractions: [],
      maxReconstructedCorners: 0,
    });
    const ctx = cornersOnlyCtx({ skip: [0] });
    expect(measurer.measure('q', SQUARE_CORNERS, IMAGE, ctx)).toBeNull();
  });

  it('the quality threshold is configurable on the fallback path', () => {
    // Corner-only depth (forces the fallback) with TL lifted out of the z=1 plane
    // → a non-planar read whose quality drops below the default 0.8 but above 0.3.
    const noisyUnproject = (p: DepthPoint): Vector3 | null => {
      const z =
        p.screenX < 0.45 && p.screenY < 0.45 ? p.depthM + 0.05 : p.depthM;
      return [p.screenX, p.screenY, z];
    };
    const ctx = cornersOnlyCtx({ unproject: noisyUnproject });
    const strict = createQrSizeMeasurer({
      minSamples: 1,
      qualityThreshold: 0.8,
    });
    const relaxed = createQrSizeMeasurer({
      minSamples: 1,
      qualityThreshold: 0.3,
    });
    const s = strict.measure('q', SQUARE_CORNERS, IMAGE, ctx);
    const r = relaxed.measure('q', SQUARE_CORNERS, IMAGE, ctx);
    expect(s).not.toBeNull();
    expect(r).not.toBeNull();
    expect(s!.estimate.sampleCount).toBe(0); // rejected by strict 0.8 gate
    expect(r!.estimate.sampleCount).toBe(1); // accepted by relaxed 0.3 gate
  });
});
