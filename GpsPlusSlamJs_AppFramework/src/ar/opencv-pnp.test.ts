/**
 * OpenCV planar-PnP adapter — unit + memory-leak tests.
 *
 * Why this test matters: opencv.js manages WASM memory manually, so a leaked
 * `cv.Mat` per detection sinks the throttled loop over time. The mock `cv` here
 * tracks every live Mat; the soak test asserts the live count is INVARIANT
 * across many solves (only the 3 constant Mats survive) and drops to zero after
 * `dispose()`. It also pins the solve contract (success → rvec/tvec, failure →
 * null) without needing the real WASM.
 */

import { describe, it, expect } from 'vitest';
import { OpenCvPnpSquare, type CvLike, type CvMat } from './opencv-pnp';
import { buildObjectPoints, type Point2 } from './qr-pose';

/** A mock `cv` that tracks live Mats so leaks are observable. */
function makeMockCv(
  opts: { success?: boolean; rvec?: number[]; tvec?: number[] } = {}
) {
  const live = new Set<CvMat>();
  const success = opts.success ?? true;
  const rvecOut = opts.rvec ?? [0.1, -0.2, 0.3];
  const tvecOut = opts.tvec ?? [0.01, 0.02, 1.5];

  function makeMat(data: number[]): CvMat {
    const mat = {
      data64F: new Float64Array(data),
      delete() {
        live.delete(mat);
      },
    };
    live.add(mat);
    return mat;
  }

  const cv: CvLike = {
    CV_64F: 6,
    SOLVEPNP_IPPE_SQUARE: 7,
    Mat: class {
      data64F = new Float64Array();
      constructor() {
        live.add(this);
      }
      delete() {
        live.delete(this);
      }
    },
    matFromArray: (_r, _c, _t, array) => makeMat([...array]),
    solvePnP: (_o, _i, _c, _d, rvec, tvec) => {
      // Emulate OpenCV writing into the output Mats.
      (rvec as { data64F: Float64Array }).data64F = new Float64Array(rvecOut);
      (tvec as { data64F: Float64Array }).data64F = new Float64Array(tvecOut);
      return success;
    },
  };
  return { cv, liveCount: () => live.size };
}

const obj = buildObjectPoints(0.2);
const img: Point2[] = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
  { x: 100, y: 200 },
];
const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };

describe('OpenCvPnpSquare', () => {
  it('returns the rvec/tvec written by solvePnP', () => {
    const { cv } = makeMockCv({
      rvec: [0.1, -0.2, 0.3],
      tvec: [0.01, 0.02, 1.5],
    });
    const pnp = new OpenCvPnpSquare(cv);
    const result = pnp.solve(obj, img, intr);
    expect(result).not.toBeNull();
    expect(result!.rvec).toEqual([0.1, -0.2, 0.3]);
    expect(result!.tvec).toEqual([0.01, 0.02, 1.5]);
    pnp.dispose();
  });

  it('returns null when solvePnP reports failure', () => {
    const { cv } = makeMockCv({ success: false });
    const pnp = new OpenCvPnpSquare(cv);
    expect(pnp.solve(obj, img, intr)).toBeNull();
    pnp.dispose();
  });

  it('returns null for fewer than 4 points or mismatched lengths', () => {
    const { cv } = makeMockCv();
    const pnp = new OpenCvPnpSquare(cv);
    expect(pnp.solve(obj.slice(0, 3), img.slice(0, 3), intr)).toBeNull();
    expect(pnp.solve(obj, img.slice(0, 3), intr)).toBeNull();
    pnp.dispose();
  });

  it('returns null when solvePnP yields a non-finite pose', () => {
    const { cv } = makeMockCv({ tvec: [0, 0, NaN] });
    const pnp = new OpenCvPnpSquare(cv);
    expect(pnp.solve(obj, img, intr)).toBeNull();
    pnp.dispose();
  });

  it('throws if solve() is called after dispose()', () => {
    const { cv } = makeMockCv();
    const pnp = new OpenCvPnpSquare(cv);
    pnp.dispose();
    expect(() => pnp.solve(obj, img, intr)).toThrow();
  });

  it('does not leak Mats across many solves (memory soak)', () => {
    const { cv, liveCount } = makeMockCv();
    const pnp = new OpenCvPnpSquare(cv);
    // 3 constant Mats survive construction: distCoeffs, rvec, tvec.
    expect(liveCount()).toBe(3);

    for (let i = 0; i < 200; i++) {
      pnp.solve(obj, img, intr);
      // Per-solve Mats (obj/img/cam) must be released each iteration.
      expect(liveCount()).toBe(3);
    }

    pnp.dispose();
    expect(liveCount()).toBe(0);
  });

  it('releases per-solve Mats even when solvePnP throws', () => {
    const { cv, liveCount } = makeMockCv();
    const throwingCv: CvLike = {
      ...cv,
      solvePnP: () => {
        throw new Error('boom');
      },
    };
    const pnp = new OpenCvPnpSquare(throwingCv);
    expect(() => pnp.solve(obj, img, intr)).toThrow('boom');
    expect(liveCount()).toBe(3); // obj/img/cam freed by the finally block
    pnp.dispose();
    expect(liveCount()).toBe(0);
  });
});
