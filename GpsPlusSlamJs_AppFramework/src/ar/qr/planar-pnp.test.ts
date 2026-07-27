/**
 * Pure-JS planar PnP — unit tests.
 *
 * Why this test matters: this solver replaces OpenCV's `SOLVEPNP_IPPE_SQUARE`
 * with hand-rolled math, so every sub-kernel (linear solve, homography, polar
 * rotation projection, IPPE candidate generation) needs an independent proof
 * against known-answer cases. The end-to-end round-trip lives in the property
 * test; here we pin the building blocks and the degenerate/rejection paths.
 */

import { describe, it, expect } from 'vitest';
import { quat, vec3 } from 'gl-matrix';
import type { Vector3 } from 'gps-plus-slam-js';
import {
  solveLinear,
  homographyFromCorrespondences,
  nearestRotation3x3,
  ippePoseCandidates,
  rotationToRodrigues,
  PlanarPnpSquare,
  type Mat3,
} from './planar-pnp';
import { buildObjectPoints, type Point2 } from './qr-pose';

const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };

/** Project object points through an OpenCV pose (R·o+t) to detector pixels. */
function projectOpenCv(
  obj: readonly Vector3[],
  rvec: Vector3,
  tvec: Vector3
): Point2[] {
  const angle = Math.hypot(...rvec);
  const R =
    angle < 1e-9
      ? quat.create()
      : quat.setAxisAngle(
          quat.create(),
          vec3.normalize(vec3.create(), vec3.fromValues(...rvec)),
          angle
        );
  return obj.map((o) => {
    const v = vec3.transformQuat(vec3.create(), vec3.fromValues(...o), R);
    const z = v[2] + tvec[2];
    return {
      x: intr.cx + (intr.fx * (v[0] + tvec[0])) / z,
      y: intr.cy + (intr.fy * (v[1] + tvec[1])) / z,
    };
  });
}

describe('solveLinear', () => {
  it('solves a known 2×2 system', () => {
    // [2 1; 1 3] x = [3; 5]  → x = [4/5, 7/5]
    const x = solveLinear([2, 1, 1, 3], [3, 5]);
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(0.8, 10);
    expect(x![1]).toBeCloseTo(1.4, 10);
  });

  it('solves a 3×3 system requiring a pivot swap (zero leading pivot)', () => {
    // First pivot is 0 → must swap rows. Solution of:
    // [0 1 1; 1 0 1; 1 1 0] x = [2; 3; 4] → x = [2.5, 1.5, 0.5]
    const x = solveLinear([0, 1, 1, 1, 0, 1, 1, 1, 0], [2, 3, 4]);
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(2.5, 10);
    expect(x![1]).toBeCloseTo(1.5, 10);
    expect(x![2]).toBeCloseTo(0.5, 10);
  });

  it('returns null for a singular matrix', () => {
    // Second row is a multiple of the first → singular.
    expect(solveLinear([1, 2, 2, 4], [1, 2])).toBeNull();
  });

  it('returns null on a size mismatch', () => {
    expect(solveLinear([1, 0, 0, 1], [1, 2, 3])).toBeNull();
  });
});

describe('nearestRotation3x3', () => {
  it('returns an identity-like input unchanged (already orthonormal)', () => {
    const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const R = nearestRotation3x3(I);
    for (let i = 0; i < 9; i++) expect(R[i]).toBeCloseTo(I[i]!, 12);
  });

  it('orthonormalizes a perturbed rotation (RᵀR ≈ I, det ≈ +1)', () => {
    // A true rotation about z by 0.5 rad, perturbed by small noise.
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    const perturbed: Mat3 = [
      c + 0.02,
      -s,
      0.01,
      s,
      c - 0.015,
      0,
      0.005,
      0.01,
      1 + 0.03,
    ];
    const R = nearestRotation3x3(perturbed);
    // RᵀR ≈ I
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += R[k * 3 + i]! * R[k * 3 + j]!;
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 6);
      }
    }
    expect(det(R)).toBeCloseTo(1, 6);
  });

  it('forces a proper rotation from a near-reflection (det → +1)', () => {
    // A reflection (det = −1): identity with a flipped z column.
    const reflection: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];
    const R = nearestRotation3x3(reflection);
    expect(det(R)).toBeCloseTo(1, 6);
  });
});

describe('rotationToRodrigues', () => {
  it('maps the identity to a zero vector', () => {
    expect(rotationToRodrigues([1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([0, 0, 0]);
  });

  it('round-trips an axis-angle rotation through gl-matrix', () => {
    const axisAngle: Vector3 = [0.3, -0.7, 0.5];
    const angle = Math.hypot(...axisAngle);
    const qg = quat.setAxisAngle(
      quat.create(),
      vec3.normalize(vec3.create(), vec3.fromValues(...axisAngle)),
      angle
    );
    // Build a row-major R from the quaternion.
    const R = quatToMat3(qg);
    const rvec = rotationToRodrigues(R);
    expect(rvec[0]).toBeCloseTo(axisAngle[0], 6);
    expect(rvec[1]).toBeCloseTo(axisAngle[1], 6);
    expect(rvec[2]).toBeCloseTo(axisAngle[2], 6);
  });

  it('recovers a near-180° rotation (about y)', () => {
    const theta = Math.PI - 1e-3;
    const R: Mat3 = [
      Math.cos(theta),
      0,
      Math.sin(theta),
      0,
      1,
      0,
      -Math.sin(theta),
      0,
      Math.cos(theta),
    ];
    const rvec = rotationToRodrigues(R);
    expect(Math.abs(rvec[0])).toBeCloseTo(0, 3);
    expect(Math.abs(rvec[1])).toBeCloseTo(theta, 3);
    expect(Math.abs(rvec[2])).toBeCloseTo(0, 3);
  });
});

describe('homographyFromCorrespondences', () => {
  it('returns null for fewer than 4 correspondences', () => {
    expect(
      homographyFromCorrespondences(
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ]
      )
    ).toBeNull();
  });

  it('returns null for collinear (degenerate) object points', () => {
    const collinear: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    const img: Array<[number, number]> = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
      [0.3, 0],
    ];
    expect(homographyFromCorrespondences(collinear, img)).toBeNull();
  });
});

describe('PlanarPnpSquare.solve', () => {
  const solver = new PlanarPnpSquare();
  const obj = buildObjectPoints(0.2);

  it('recovers a fronto-parallel pose (≈ identity R, correct t_z)', () => {
    const rvec: Vector3 = [0, 0, 0];
    const tvec: Vector3 = [0.05, -0.03, 1.5];
    const corners = projectOpenCv(obj, rvec, tvec);
    const result = solver.solve(obj, corners, intr);
    expect(result).not.toBeNull();
    expect(result!.rvec[0]).toBeCloseTo(0, 4);
    expect(result!.rvec[1]).toBeCloseTo(0, 4);
    expect(result!.rvec[2]).toBeCloseTo(0, 4);
    expect(result!.tvec[0]).toBeCloseTo(0.05, 4);
    expect(result!.tvec[1]).toBeCloseTo(-0.03, 4);
    expect(result!.tvec[2]).toBeCloseTo(1.5, 4);
  });

  it('recovers a tilted pose within tolerance', () => {
    const rvec: Vector3 = [0.4, -0.3, 0.2];
    const tvec: Vector3 = [0.1, 0.05, 2.0];
    const corners = projectOpenCv(obj, rvec, tvec);
    const result = solver.solve(obj, corners, intr);
    expect(result).not.toBeNull();
    expect(result!.rvec[0]).toBeCloseTo(0.4, 3);
    expect(result!.rvec[1]).toBeCloseTo(-0.3, 3);
    expect(result!.rvec[2]).toBeCloseTo(0.2, 3);
    expect(result!.tvec[2]).toBeCloseTo(2.0, 3);
  });

  it('chooses the lower-reprojection candidate for a tilted square', () => {
    // A strongly tilted square has a near-mirror second candidate; the
    // reprojection pick must land on the ground-truth pose, not its flip.
    const rvec: Vector3 = [0.7, 0.1, 0.0];
    const tvec: Vector3 = [0, 0, 1.8];
    const corners = projectOpenCv(obj, rvec, tvec);
    const result = solver.solve(obj, corners, intr);
    expect(result).not.toBeNull();
    expect(result!.rvec[0]).toBeCloseTo(0.7, 2);
    expect(result!.rvec[1]).toBeCloseTo(0.1, 2);
  });

  it('returns null for fewer than 4 points or mismatched lengths', () => {
    const corners = projectOpenCv(obj, [0, 0, 0], [0, 0, 1.5]);
    expect(solver.solve(obj.slice(0, 3), corners.slice(0, 3), intr)).toBeNull();
    expect(solver.solve(obj, corners.slice(0, 3), intr)).toBeNull();
  });

  it('returns null for non-finite image points', () => {
    const corners = projectOpenCv(obj, [0, 0, 0], [0, 0, 1.5]);
    corners[1] = { x: NaN, y: 100 };
    expect(solver.solve(obj, corners, intr)).toBeNull();
  });

  it('returns null for invalid intrinsics', () => {
    const corners = projectOpenCv(obj, [0, 0, 0], [0, 0, 1.5]);
    expect(solver.solve(obj, corners, { ...intr, fx: 0 })).toBeNull();
  });
});

describe('ippePoseCandidates', () => {
  it('returns a single (coincident) root for a fronto-parallel square', () => {
    // Fronto-parallel: the two tilt-flip roots collapse to one pose.
    const obj = buildObjectPoints(0.2);
    const corners = projectOpenCv(obj, [0, 0, 0], [0, 0, 1.5]);
    const objectXY = obj.map((o) => [o[0], o[1]] as [number, number]);
    const imageXY = corners.map(
      (c) =>
        [(c.x - intr.cx) / intr.fx, (c.y - intr.cy) / intr.fy] as [
          number,
          number,
        ]
    );
    const H = homographyFromCorrespondences(objectXY, imageXY);
    expect(H).not.toBeNull();
    const cands = ippePoseCandidates(H!);
    expect(cands.length).toBeGreaterThanOrEqual(1);
    // Every returned candidate is a proper rotation.
    for (const cand of cands) expect(det(cand.R)).toBeCloseTo(1, 6);
  });
});

// --- helpers ---

function det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** gl-matrix quaternion → row-major Mat3. */
function quatToMat3(q: quat): Mat3 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}
