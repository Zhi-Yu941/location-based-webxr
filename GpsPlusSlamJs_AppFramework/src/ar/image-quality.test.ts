/**
 * Unit tests for the pure image-quality metrics + verdict policy.
 *
 * Why this matters: these are the building blocks the off-thread image gate
 * relies on. The metrics must rank a sharp frame above a blurred one and flag a
 * black frame; the verdict policy must (a) never block before it has a baseline,
 * (b) reject blur only relative to the recent scene, and (c) never let a black
 * frame's ~0 sharpness poison the baseline. Each is pinned here so the worker
 * (the untested device layer) can be a thin shell over this logic.
 */

import { describe, it, expect } from 'vitest';
import {
  sharpnessScore,
  meanLuminance,
  rgbaToGrayscale,
  ImageQualityGate,
  DEFAULT_QUALITY_FILTER,
  type QualityFilterConfig,
} from './image-quality.js';

/** A w×h checkerboard (0/255) — maximally high-frequency, so very "sharp". */
function checkerboard(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.push((x + y) % 2 === 0 ? 255 : 0);
    }
  }
  return out;
}

/** 3×3 box blur with edge-clamped neighbours — smooths high frequencies. */
function boxBlur(gray: readonly number[], w: number, h: number): number[] {
  const at = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    return gray[cy * w + cx] as number;
  };
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy);
      }
      out.push(sum / 9);
    }
  }
  return out;
}

describe('sharpnessScore', () => {
  it('scores a sharp checkerboard far above its blurred copy', () => {
    const w = 16;
    const h = 16;
    const sharp = checkerboard(w, h);
    const blurred = boxBlur(sharp, w, h);
    const sSharp = sharpnessScore(sharp, w, h);
    const sBlur = sharpnessScore(blurred, w, h);
    expect(sSharp).toBeGreaterThan(0);
    expect(sBlur).toBeLessThan(sSharp);
  });

  it('is 0 for a constant (flat) image — no high-frequency content', () => {
    const w = 8;
    const h = 8;
    const flat = new Array(w * h).fill(128);
    expect(sharpnessScore(flat, w, h)).toBe(0);
  });

  it('is invariant to a uniform brightness offset (Laplacian cancels DC)', () => {
    const w = 10;
    const h = 10;
    const base = checkerboard(w, h).map((v) => v / 4); // keep < 255 after +offset
    const brighter = base.map((v) => v + 30);
    expect(sharpnessScore(brighter, w, h)).toBeCloseTo(
      sharpnessScore(base, w, h),
      6
    );
  });

  it('returns 0 for degenerate dimensions or short buffers (defensive)', () => {
    expect(sharpnessScore([1, 2, 3, 4], 2, 2)).toBe(0); // < 3 px each side
    expect(sharpnessScore([1, 2, 3], 3, 3)).toBe(0); // buffer too short
    expect(sharpnessScore(checkerboard(4, 4), 2.5, 4)).toBe(0); // non-integer
  });
});

describe('meanLuminance', () => {
  it('is 0 for an all-black buffer and ~255 for an all-white buffer', () => {
    const black = new Uint8ClampedArray(4 * 16); // all zero incl. alpha
    const white = new Uint8ClampedArray(4 * 16).fill(255);
    expect(meanLuminance(black)).toBe(0);
    expect(meanLuminance(white)).toBeCloseTo(255, 5);
  });

  it('is ~128 for a mid-grey buffer', () => {
    const grey = new Uint8ClampedArray(4 * 16);
    for (let p = 0; p < 16; p++) {
      grey[p * 4] = 128;
      grey[p * 4 + 1] = 128;
      grey[p * 4 + 2] = 128;
      grey[p * 4 + 3] = 255;
    }
    expect(meanLuminance(grey)).toBeCloseTo(128, 5);
  });

  it('returns 0 for an empty buffer', () => {
    expect(meanLuminance(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe('rgbaToGrayscale', () => {
  it('maps each pixel to its Rec. 601 luma and ignores alpha', () => {
    // One pure-red, one pure-green, one pure-blue pixel.
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128,
    ]);
    const gray = rgbaToGrayscale(rgba);
    expect(gray.length).toBe(3);
    expect(gray[0]).toBe(Math.round(0.299 * 255)); // 76 (clamped)
    expect(gray[1]).toBe(Math.round(0.587 * 255)); // 150
    expect(gray[2]).toBe(Math.round(0.114 * 255)); // 29
  });
});

describe('ImageQualityGate', () => {
  const cfg: QualityFilterConfig = {
    ...DEFAULT_QUALITY_FILTER,
    enabled: true,
    blurRelativeThreshold: 0.5,
    minMeanLuminance: 10,
  };

  it('accepts during cold start (before minSamples), even a low score', () => {
    const gate = new ImageQualityGate(15, 3);
    // First three frames: no baseline yet → accept regardless of sharpness.
    expect(gate.evaluate(1, 200, cfg).accept).toBe(true);
    expect(gate.evaluate(1000, 200, cfg).accept).toBe(true);
    expect(gate.evaluate(5, 200, cfg).accept).toBe(true);
  });

  it('rejects a frame far below the recent sharpness median once warmed up', () => {
    const gate = new ImageQualityGate(15, 3);
    // Establish a sharp baseline (median 100).
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    // 40 < 0.5·100 = 50 → blurry.
    const v = gate.evaluate(40, 200, cfg);
    expect(v.accept).toBe(false);
    expect(v.reason).toBe('blurry');
    // 60 > 50 → accepted.
    expect(gate.evaluate(60, 200, cfg).accept).toBe(true);
  });

  it('rejects a black frame on the absolute cutoff', () => {
    const gate = new ImageQualityGate(15, 3);
    const v = gate.evaluate(9999, 5, cfg); // very sharp but luminance 5 < 10
    expect(v.accept).toBe(false);
    expect(v.reason).toBe('black');
  });

  it('does NOT let a black frame pollute the sharpness baseline', () => {
    const gate = new ImageQualityGate(15, 3);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    expect(gate.historyLength()).toBe(3);
    // A black frame with ~0 sharpness must be ignored for the baseline...
    gate.evaluate(0, 1, cfg);
    expect(gate.historyLength()).toBe(3); // unchanged
    // ...so the median is still 100 and a 40-score frame is still blurry.
    expect(gate.evaluate(40, 200, cfg).reason).toBe('blurry');
  });

  it('caps the rolling history at historySize (no unbounded growth)', () => {
    const gate = new ImageQualityGate(4, 3);
    for (let i = 0; i < 20; i++) gate.evaluate(100, 200, cfg);
    expect(gate.historyLength()).toBe(4);
  });

  it('reset() clears the baseline back to cold start', () => {
    const gate = new ImageQualityGate(15, 3);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.reset();
    expect(gate.historyLength()).toBe(0);
    // Back in cold start → a tiny score is accepted again.
    expect(gate.evaluate(1, 200, cfg).accept).toBe(true);
  });
});
