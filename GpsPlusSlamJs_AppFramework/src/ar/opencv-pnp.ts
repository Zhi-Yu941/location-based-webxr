/**
 * OpenCV planar-PnP adapter — Phase 2 of the QR-code detection & tracking plan
 * (§3, §9). Implements `qr-pose.ts`'s injected {@link SolvePnpSquare} by wrapping
 * `cv.solvePnP(..., SOLVEPNP_IPPE_SQUARE)`, with strict `cv.Mat` lifetime
 * discipline so the throttled detection loop never leaks WASM memory.
 *
 * OpenCV is taken as an injected {@link CvLike} (the slim subset actually used),
 * so this module — and its memory-leak test — need no opencv.js WASM. The real
 * `cv` is loaded lazily in the worker (`importScripts('<pinned CDN opencv.js>')`,
 * a classic worker — opencv.js is not an ES module; see plan §9) and passed in.
 *
 * Memory rules (all three briefs stress this):
 * - Constant Mats (dist coeffs, the reusable rvec/tvec outputs) are allocated
 *   ONCE in the constructor and reused for every solve.
 * - Per-solve Mats (object points, image points, camera matrix) are deleted in a
 *   `finally`, even when `solvePnP` throws.
 * - `dispose()` frees the constant Mats; the instance must not be used after.
 */

import type {
  CameraIntrinsics,
  OpenCvPnpResult,
  Point2,
  SolvePnpSquare,
} from './qr-pose.js';
import type { Vector3 } from 'gps-plus-slam-js';

/** A single OpenCV matrix (the slice we use). */
export interface CvMat {
  delete(): void;
  /** Row-major 64-bit float data (rvec/tvec are 3×1). */
  readonly data64F: Float64Array;
}

/** The minimal OpenCV.js surface {@link OpenCvPnpSquare} depends on. */
export interface CvLike {
  readonly CV_64F: number;
  readonly SOLVEPNP_IPPE_SQUARE: number;
  /** Construct an empty Mat (used for the rvec/tvec outputs). */
  Mat: new () => CvMat;
  /** Build a `rows×cols` Mat of `type` from a flat row-major array. */
  matFromArray(
    rows: number,
    cols: number,
    type: number,
    array: readonly number[]
  ): CvMat;
  /** OpenCV solvePnP; returns success. Writes into `rvec`/`tvec`. */
  solvePnP(
    objectPoints: CvMat,
    imagePoints: CvMat,
    cameraMatrix: CvMat,
    distCoeffs: CvMat,
    rvec: CvMat,
    tvec: CvMat,
    useExtrinsicGuess: boolean,
    flags: number
  ): boolean;
}

/**
 * `SolvePnpSquare` backed by OpenCV. Construct once per worker with the loaded
 * `cv`; reuse across frames; `dispose()` on teardown.
 */
export class OpenCvPnpSquare implements SolvePnpSquare {
  private readonly cv: CvLike;
  /** Zero distortion — constant, allocated once. */
  private readonly distCoeffs: CvMat;
  /** Reusable solve outputs — overwritten each call, never reallocated. */
  private readonly rvec: CvMat;
  private readonly tvec: CvMat;
  private disposed = false;

  constructor(cv: CvLike) {
    this.cv = cv;
    this.distCoeffs = cv.matFromArray(1, 5, cv.CV_64F, [0, 0, 0, 0, 0]);
    this.rvec = new cv.Mat();
    this.tvec = new cv.Mat();
  }

  solve(
    objectPoints: readonly Vector3[],
    imagePoints: readonly Point2[],
    intrinsics: CameraIntrinsics
  ): OpenCvPnpResult | null {
    if (this.disposed) {
      throw new Error('OpenCvPnpSquare: solve() called after dispose()');
    }
    if (objectPoints.length !== imagePoints.length || objectPoints.length < 4) {
      return null;
    }
    const cv = this.cv;

    const objArr: number[] = [];
    for (const p of objectPoints) objArr.push(p[0], p[1], p[2]);
    const imgArr: number[] = [];
    for (const p of imagePoints) imgArr.push(p.x, p.y);

    const objMat = cv.matFromArray(objectPoints.length, 3, cv.CV_64F, objArr);
    const imgMat = cv.matFromArray(imagePoints.length, 2, cv.CV_64F, imgArr);
    const camMat = cv.matFromArray(3, 3, cv.CV_64F, [
      intrinsics.fx,
      0,
      intrinsics.cx,
      0,
      intrinsics.fy,
      intrinsics.cy,
      0,
      0,
      1,
    ]);

    try {
      const ok = cv.solvePnP(
        objMat,
        imgMat,
        camMat,
        this.distCoeffs,
        this.rvec,
        this.tvec,
        false,
        cv.SOLVEPNP_IPPE_SQUARE
      );
      if (!ok) return null;

      const r = this.rvec.data64F;
      const t = this.tvec.data64F;
      // `?? NaN` covers a short output array; the finite check then rejects it.
      const rvec: Vector3 = [r[0] ?? NaN, r[1] ?? NaN, r[2] ?? NaN];
      const tvec: Vector3 = [t[0] ?? NaN, t[1] ?? NaN, t[2] ?? NaN];
      if (![...rvec, ...tvec].every(Number.isFinite)) return null;
      return { rvec, tvec };
    } finally {
      objMat.delete();
      imgMat.delete();
      camMat.delete();
    }
  }

  /** Free the constant Mats. The instance must not be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.distCoeffs.delete();
    this.rvec.delete();
    this.tvec.delete();
  }
}
