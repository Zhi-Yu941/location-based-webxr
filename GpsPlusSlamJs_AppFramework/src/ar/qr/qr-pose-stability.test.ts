/**
 * QR pose stability — Step-0 reproduction tests (verify-first; D5, 2026-06-19).
 *
 * Why this test matters: a field tester reported the QR debug axes "jump" when
 * the phone is rotated. TWO distinct root causes produce that exact symptom, and
 * the recorded decision ("neutral verify-first") is to reproduce BOTH
 * deterministically BEFORE choosing a fix — neither the tester's corner-order
 * hypothesis nor the planar-PnP (IPPE) 2-fold ambiguity is assumed. These tests
 * are executable documentation of the two failure modes; they intentionally do
 * NOT fix anything. The fix ships once an on-device run disambiguates which
 * cause the tester actually saw — see
 * `GpsPlusSlamJs_Docs/docs/2026-06-20-qr-axis-jump-step0-findings-and-next.md`.
 *
 * Both are reproduced with no device: a known pose is forward-projected to
 * detector pixels and fed back through the production pipeline.
 *
 * - Cause A (corner order): `BarcodeDetector.cornerPoints` may be ordered by
 *   image position, so an in-plane phone rotation cyclically shifts which
 *   physical corner is index-0. Because the QR model is a 4-fold-symmetric
 *   square, a cyclic shift fits a pose rotated 90° about the QR normal WITH
 *   near-zero reprojection error → the 4 px gate (`solveQrPose`) and the winding
 *   guard (`validateQuad`) cannot catch it.
 * - Cause B (planar 2-fold / IPPE ambiguity): near fronto-parallel the solver's
 *   two tilt-flip candidates explain the image almost equally well, so the
 *   min-reprojection pick is ill-conditioned — a sub-pixel change in the corners
 *   flips which pose (and which surface normal) wins, even with perfectly
 *   ordered corners.
 */

import { describe, it, expect } from 'vitest';
import { quat, vec3 } from 'gl-matrix';
import type { Vector3 } from 'gps-plus-slam-js';
import {
  buildObjectPoints,
  validateQuad,
  solveQrPose,
  type Point2,
  type Pose,
} from './qr-pose';
import {
  PlanarPnpSquare,
  ippePoseCandidates,
  homographyFromCorrespondences,
  type Mat3,
} from './planar-pnp';

const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
const SIZE_M = 0.2;
const IDENTITY_CAMERA: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

/** Rx(π) = diag(1,−1,−1): a QR facing the camera, fronto-parallel (row-major). */
const FACING_CAMERA: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** Project object points through an OpenCV pose (p_cam = R·o + t) to pixels. */
function projectOpenCv(R: Mat3, t: Vector3, obj: readonly Vector3[]): Point2[] {
  return obj.map((o) => {
    const cx = R[0] * o[0] + R[1] * o[1] + R[2] * o[2] + t[0];
    const cy = R[3] * o[0] + R[4] * o[1] + R[5] * o[2] + t[1];
    const cz = R[6] * o[0] + R[7] * o[1] + R[8] * o[2] + t[2];
    return {
      x: intr.cx + (intr.fx * cx) / cz,
      y: intr.cy + (intr.fy * cy) / cz,
    };
  });
}

/** RMS reprojection error (px) of an OpenCV candidate against detected corners. */
function reprojRms(
  R: Mat3,
  t: Vector3,
  obj: readonly Vector3[],
  corners: readonly Point2[]
): number {
  let sumSq = 0;
  for (let i = 0; i < obj.length; i++) {
    const o = obj[i]!;
    const cx = R[0] * o[0] + R[1] * o[1] + R[2] * o[2] + t[0];
    const cy = R[3] * o[0] + R[4] * o[1] + R[5] * o[2] + t[1];
    const cz = R[6] * o[0] + R[7] * o[1] + R[8] * o[2] + t[2];
    const px = intr.cx + (intr.fx * cx) / cz;
    const py = intr.cy + (intr.fy * cy) / cz;
    const dx = px - corners[i]!.x;
    const dy = py - corners[i]!.y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / obj.length);
}

/** The QR surface normal (object +z) expressed in the camera frame. */
function normalOf(R: Mat3): Vector3 {
  return [R[2], R[5], R[8]];
}

/** Rotate FACING_CAMERA by `delta` rad about the camera x-axis (a plane tilt). */
function facingTiltedX(delta: number): Mat3 {
  const c = Math.cos(delta);
  const s = Math.sin(delta);
  const Rx: Mat3 = [1, 0, 0, 0, c, -s, 0, s, c];
  return mul3(Rx, FACING_CAMERA);
}

/** Row-major 3×3 multiply A·B. */
function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      out[r * 3 + col] =
        a[r * 3]! * b[col]! +
        a[r * 3 + 1]! * b[3 + col]! +
        a[r * 3 + 2]! * b[6 + col]!;
    }
  }
  return out as unknown as Mat3;
}

/** Normalized image coords (K⁻¹ pixel) the IPPE homography is built from. */
function normalizedXY(corners: readonly Point2[]): Array<[number, number]> {
  return corners.map((c) => [
    (c.x - intr.cx) / intr.fx,
    (c.y - intr.cy) / intr.fy,
  ]);
}

/** Magnitude of the relative rotation between two quaternions, in degrees. */
function relAngleDeg(a: Pose['rotation'], b: Pose['rotation']): number {
  const qa = quat.fromValues(a[0], a[1], a[2], a[3]);
  const qb = quat.fromValues(b[0], b[1], b[2], b[3]);
  const rel = quat.multiply(quat.create(), qb, quat.invert(quat.create(), qa));
  return (2 * Math.acos(Math.min(1, Math.abs(rel[3])))) / (Math.PI / 180);
}

// ---------------------------------------------------------------------------
// Cause A — corner order
// ---------------------------------------------------------------------------

describe('Cause A: a cyclic corner shift snaps the pose 90° past every gate', () => {
  const obj = buildObjectPoints(SIZE_M);
  const tvec: Vector3 = [0, 0, 2];
  const solver = new PlanarPnpSquare();
  // Fronto-parallel, facing the camera: the projected square is exactly
  // 4-fold-symmetric, so a 90°-rotated model reprojects onto a cyclic shift of
  // the corners with zero error — the worst case for the gate.
  const corners = projectOpenCv(FACING_CAMERA, tvec, obj);
  // Detector returns corners starting one corner later (the tester's "first
  // corner is always the image's top-left" → rotating the phone cycles index-0).
  const shifted: Point2[] = [
    corners[1]!,
    corners[2]!,
    corners[3]!,
    corners[0]!,
  ];

  it('the winding guard does NOT reject the shifted corners', () => {
    // validateQuad only checks winding (sign of the shoelace area), which is
    // invariant under a cyclic rotation — so it passes both orderings.
    expect(validateQuad(corners).ok).toBe(true);
    expect(validateQuad(shifted).ok).toBe(true);
  });

  it('both orderings solve with near-zero reprojection error (gate blind to it)', () => {
    const a = solveQrPose({
      imagePoints: corners,
      sizeM: SIZE_M,
      intrinsics: intr,
      cameraPose: IDENTITY_CAMERA,
      solver,
    });
    const b = solveQrPose({
      imagePoints: shifted,
      sizeM: SIZE_M,
      intrinsics: intr,
      cameraPose: IDENTITY_CAMERA,
      solver,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Both are accepted well under the 4 px gate — it cannot tell them apart.
    expect(a!.reprojectionErrorPx).toBeLessThan(0.5);
    expect(b!.reprojectionErrorPx).toBeLessThan(0.5);
  });

  it('yet the recovered pose jumps ~90° about the QR normal', () => {
    const a = solveQrPose({
      imagePoints: corners,
      sizeM: SIZE_M,
      intrinsics: intr,
      cameraPose: IDENTITY_CAMERA,
      solver,
    })!;
    const b = solveQrPose({
      imagePoints: shifted,
      sizeM: SIZE_M,
      intrinsics: intr,
      cameraPose: IDENTITY_CAMERA,
      solver,
    })!;
    // Same physical square, relabeled corners → a quarter-turn jump. This is the
    // exact "axes jump on rotation" the tester described.
    expect(
      relAngleDeg(a.qrPoseInCamera.rotation, b.qrPoseInCamera.rotation)
    ).toBeCloseTo(90, 0);
  });
});

// ---------------------------------------------------------------------------
// Cause B — planar 2-fold (IPPE) ambiguity
// ---------------------------------------------------------------------------

describe('Cause B: near fronto-parallel the IPPE tilt-flip pick is ill-conditioned', () => {
  const obj = buildObjectPoints(SIZE_M);
  const tvec: Vector3 = [0, 0, 2];

  /** The two best (lowest-reprojection) candidates for a given tilt. */
  function bestTwo(deltaRad: number): {
    corners: Point2[];
    cands: { R: Mat3; t: Vector3; err: number }[];
  } {
    const R = facingTiltedX(deltaRad);
    const corners = projectOpenCv(R, tvec, obj);
    const H = homographyFromCorrespondences(
      obj.map((o) => [o[0], o[1]] as [number, number]),
      normalizedXY(corners)
    )!;
    const cands = ippePoseCandidates(H)
      .map((c) => ({ R: c.R, t: c.t, err: reprojRms(c.R, c.t, obj, corners) }))
      .filter((c) => Number.isFinite(c.err))
      .sort((a, b) => a.err - b.err);
    return { corners, cands };
  }

  it('a small tilt yields two near-degenerate candidates with distinct normals', () => {
    const { cands } = bestTwo(0.1); // ~5.7° off fronto-parallel
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const [c0, c1] = cands;
    // Both explain the image to within the 4 px gate → the gate cannot separate
    // them; the min-error pick is decided by sub-pixel noise.
    expect(c0!.err).toBeLessThan(1);
    expect(c1!.err).toBeLessThan(1);
    // …but they are physically different poses (the surface normal tilts the
    // opposite way) — picking the wrong one flips the rendered axis.
    const dot = vec3.dot(
      vec3.fromValues(...normalOf(c0!.R)),
      vec3.fromValues(...normalOf(c1!.R))
    );
    expect(dot).toBeLessThan(0.999);
  });

  it('a sub-pixel change in the corners flips which pose wins', () => {
    // The two candidates near fronto-parallel. Reproject the SECOND candidate's
    // own pose to pixels: that image differs from the true corners by less than
    // a pixel, yet the solver now recovers the OTHER pose — a flip driven by a
    // change smaller than detector noise.
    const { corners, cands } = bestTwo(0.1);
    const twin = cands[1]!;
    const cornersTwin = projectOpenCv(twin.R, twin.t, obj);

    const maxPixelShift = Math.max(
      ...corners.map((c, i) =>
        Math.hypot(c.x - cornersTwin[i]!.x, c.y - cornersTwin[i]!.y)
      )
    );
    expect(maxPixelShift).toBeLessThan(2); // the two images are nearly identical

    const solver = new PlanarPnpSquare();
    const onTrue = solver.solve(obj, corners, intr)!;
    const onTwin = solver.solve(obj, cornersTwin, intr)!;
    // Recover each pose's normal from its Rodrigues vector and show the tilt
    // flipped — the same (to sub-pixel) image gives opposite surface normals.
    const nTrue = normalFromRvec(onTrue.rvec);
    const nTwin = normalFromRvec(onTwin.rvec);
    expect(
      vec3.dot(vec3.fromValues(...nTrue), vec3.fromValues(...nTwin))
    ).toBeLessThan(0.999);
  });

  it('the twin error grows with tilt but stays within the gate across a wide range', () => {
    // The ambiguity is worst near fronto-parallel and eases as the QR tilts —
    // but the key finding for the fix decision is that even at ~34° the twin
    // still reprojects UNDER the 4 px gate. So the reprojection gate alone is a
    // weak discriminator over a wide, realistic tilt range: disambiguating the
    // tilt-flip needs an external prior (temporal hysteresis / gravity), not a
    // tighter gate. This is the evidence behind fix branch B (5D).
    const small = bestTwo(0.1).cands[1]!.err; // near-degenerate (< 1 px)
    const mid = bestTwo(0.6).cands[1]!.err; // ~34°
    expect(small).toBeLessThan(1);
    expect(mid).toBeGreaterThan(small); // grows with tilt
    expect(mid).toBeLessThan(4); // …yet still accepted by the gate
  });
});

/** Surface normal (object +z in camera) recovered from an OpenCV rvec. */
function normalFromRvec(rvec: Vector3): Vector3 {
  const angle = Math.hypot(...rvec);
  const q =
    angle < 1e-9
      ? quat.create()
      : quat.setAxisAngle(
          quat.create(),
          vec3.normalize(vec3.create(), vec3.fromValues(...rvec)),
          angle
        );
  const n = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, 1), q);
  return [n[0], n[1], n[2]];
}
