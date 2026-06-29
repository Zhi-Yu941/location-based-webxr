/**
 * Lerp Utilities Tests
 *
 * Why this test matters: R3 — both alignment-lerper and camera-follower
 * duplicated DEFAULT_LERP_RATE and the clamped-alpha formula. These tests
 * ensure the extracted utility has the expected constants and behaviour.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_LERP_RATE, clampedAlpha, lerpAngleDeg } from './lerp-utils';

describe('lerp-utils', () => {
  describe('DEFAULT_LERP_RATE', () => {
    it('equals 8 (matching the previously duplicated value)', () => {
      expect(DEFAULT_LERP_RATE).toBe(8);
    });
  });

  describe('clampedAlpha', () => {
    it('returns lerpRate * dt for small dt', () => {
      // 8 * 0.016 = 0.128 (typical 60fps frame)
      expect(clampedAlpha(8, 0.016)).toBeCloseTo(0.128, 5);
    });

    it('clamps to 1.0 when lerpRate * dt exceeds 1', () => {
      // 8 * 0.5 = 4.0 → clamped to 1.0
      expect(clampedAlpha(8, 0.5)).toBe(1.0);
    });

    it('returns exactly 1.0 at the boundary', () => {
      // 8 * 0.125 = 1.0 → exactly 1.0
      expect(clampedAlpha(8, 0.125)).toBe(1.0);
    });

    it('returns 0 when dt is 0', () => {
      expect(clampedAlpha(8, 0)).toBe(0);
    });

    // Why this matters: the docstring promises a result in [0, 1], but the
    // original `Math.min(lerpRate * dt, 1)` only clamped the UPPER bound. A
    // negative dt (system clock adjustment / a frame loop whose timestamp goes
    // backward / a paused-then-resumed tab) would yield a NEGATIVE alpha, and
    // lerpAngleDeg/slerp then extrapolate BACKWARD — away from the target —
    // producing a visible heading/alignment jump. The lower clamp keeps the
    // shared smoothing factor inside its documented domain for all three
    // callers (alignment-lerper, camera-follower, leaflet-map-overlay).
    it('clamps to 0 when dt is negative (lower-bound guard)', () => {
      expect(clampedAlpha(8, -0.1)).toBe(0);
      expect(clampedAlpha(8, -1000)).toBe(0);
    });

    it('property: result is always within [0, 1] for any finite rate/dt', () => {
      expect(() =>
        fc.assert(
          fc.property(
            fc.double({ min: -1000, max: 1000, noNaN: true }),
            fc.double({ min: -1000, max: 1000, noNaN: true }),
            (lerpRate, dt) => {
              const a = clampedAlpha(lerpRate, dt);
              return a >= 0 && a <= 1;
            }
          )
        )
      ).not.toThrow();
    });
  });

  // Why this matters: the heading-up minimap (2026-06-29 plan) interpolates the
  // map's yaw toward a ~1 Hz target every frame. A naive numeric lerp would spin
  // the "long way" across the 0°/360° seam (e.g. 350°→10° going down through
  // 180°). lerpAngleDeg must always take the shortest arc and stay in [0, 360).
  describe('lerpAngleDeg', () => {
    it('returns the (normalized) current value at alpha 0', () => {
      expect(lerpAngleDeg(350, 10, 0)).toBeCloseTo(350, 6);
    });

    it('returns the (normalized) target value at alpha 1', () => {
      expect(lerpAngleDeg(350, 10, 1)).toBeCloseTo(10, 6);
    });

    it('takes the SHORT arc across the 360°/0° seam (350°→10° via 0°)', () => {
      // Shortest path 350°→10° is +20° (through 0°), so the midpoint is 0°,
      // NOT 180° (the long way).
      expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 6);
    });

    it('takes the short arc in the other direction (10°→350° via 0°)', () => {
      expect(lerpAngleDeg(10, 350, 0.5)).toBeCloseTo(0, 6);
    });

    it('interpolates linearly within a non-wrapping span', () => {
      expect(lerpAngleDeg(0, 90, 0.25)).toBeCloseTo(22.5, 6);
    });

    it('normalizes the result into [0, 360)', () => {
      // current just below the seam, target just above → result wraps to ~0.
      const out = lerpAngleDeg(-10, 10, 0.5);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThan(360);
      expect(out).toBeCloseTo(0, 6);
    });

    it('property: result is always in [0, 360) and within the short arc of both endpoints', () => {
      expect(() =>
        fc.assert(
          fc.property(
            fc.double({ min: -720, max: 720, noNaN: true }),
            fc.double({ min: -720, max: 720, noNaN: true }),
            fc.double({ min: 0, max: 1, noNaN: true }),
            (current, target, alpha) => {
              const out = lerpAngleDeg(current, target, alpha);
              if (out < 0 || out >= 360) return false;
              // The result must never be farther from either endpoint than the
              // full short-arc gap between them (i.e. it stays on the short arc).
              const shortDiff = (a: number, b: number): number => {
                const d = (((a - b) % 360) + 360) % 360;
                return Math.min(d, 360 - d);
              };
              const gap = shortDiff(current, target);
              return (
                shortDiff(out, current) <= gap + 1e-6 &&
                shortDiff(out, target) <= gap + 1e-6
              );
            }
          )
        )
      ).not.toThrow();
    });
  });
});
