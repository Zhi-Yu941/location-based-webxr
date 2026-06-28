/**
 * Property tests for the image-quality metrics.
 *
 * Why this matters: the unit tests pin hand-picked patterns; these pin the
 * invariants that must hold for ARBITRARY pixels — the gate would silently
 * misbehave if any failed:
 *  - sharpness is non-negative and unaffected by a global brightness offset (the
 *    Laplacian cancels the DC term, so exposure changes don't read as focus
 *    changes),
 *  - sharpness scales as s² under intensity scaling (the Laplacian is linear, so
 *    variance — a quadratic — scales by s²), and
 *  - mean luminance stays within [0, 255] and never decreases when every pixel
 *    is brightened.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sharpnessScore, meanLuminance } from './image-quality.js';

/** Arbitrary small grayscale image as a plain number[] (avoids byte clamping). */
const arbGray = fc
  .tuple(fc.integer({ min: 3, max: 12 }), fc.integer({ min: 3, max: 12 }))
  .chain(([w, h]) =>
    fc
      .array(fc.double({ min: 0, max: 100, noNaN: true }), {
        minLength: w * h,
        maxLength: w * h,
      })
      .map((gray) => ({ w, h, gray }))
  );

describe('sharpnessScore — properties', () => {
  it('is non-negative for any image', () => {
    fc.assert(
      fc.property(arbGray, ({ w, h, gray }) => {
        expect(sharpnessScore(gray, w, h)).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('is invariant to a uniform brightness offset', () => {
    fc.assert(
      fc.property(
        arbGray,
        fc.double({ min: -50, max: 50, noNaN: true }),
        ({ w, h, gray }, offset) => {
          const base = sharpnessScore(gray, w, h);
          const shifted = sharpnessScore(
            gray.map((v) => v + offset),
            w,
            h
          );
          // Relative tolerance — variance can be large, so an absolute bound is
          // unrealistic; the offset cancels exactly in float64.
          expect(Math.abs(shifted - base)).toBeLessThanOrEqual(
            1e-6 * (1 + base)
          );
        }
      )
    );
  });

  it('scales as s² under intensity scaling', () => {
    fc.assert(
      fc.property(
        arbGray,
        fc.double({ min: 0.1, max: 2, noNaN: true }),
        ({ w, h, gray }, s) => {
          const base = sharpnessScore(gray, w, h);
          const scaled = sharpnessScore(
            gray.map((v) => v * s),
            w,
            h
          );
          const expected = base * s * s;
          expect(Math.abs(scaled - expected)).toBeLessThanOrEqual(
            1e-6 * (1 + expected)
          );
        }
      )
    );
  });
});

/** Arbitrary RGBA buffer of N pixels. */
const arbRgba = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 4 * 64 })
  .map((vals) => {
    const n = Math.floor(vals.length / 4) * 4;
    return new Uint8ClampedArray(vals.slice(0, n));
  });

describe('meanLuminance — properties', () => {
  it('stays within [0, 255] for any RGBA buffer', () => {
    fc.assert(
      fc.property(arbRgba, (rgba) => {
        const m = meanLuminance(rgba);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(255);
      })
    );
  });

  it('never decreases when every channel is brightened (monotone)', () => {
    fc.assert(
      fc.property(arbRgba, fc.integer({ min: 0, max: 255 }), (rgba, add) => {
        const brighter = new Uint8ClampedArray(rgba.length);
        for (let i = 0; i < rgba.length; i++) brighter[i] = rgba[i]! + add; // clamps at 255
        expect(meanLuminance(brighter)).toBeGreaterThanOrEqual(
          meanLuminance(rgba) - 1e-9
        );
      })
    );
  });
});
