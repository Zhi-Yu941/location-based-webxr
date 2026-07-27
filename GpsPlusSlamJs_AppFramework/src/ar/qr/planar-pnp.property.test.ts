/**
 * Pure-JS planar PnP — property tests.
 *
 * Why this test matters: the IPPE math must recover ANY plausible square pose
 * from its projected corners, not just the hand-picked unit cases. We generate
 * random poses inside a realistic viewing cone, project the 4 corners through an
 * exact pinhole model on a separate code path, solve, and assert (a) the chosen
 * pose reprojects the corners to ~0 px and (b) the recovered orientation matches
 * ground truth — proving the tilt-flip disambiguation picks the right candidate.
 * A sub-pixel-noise variant asserts bounded, graceful degradation (the corner
 * 90° symmetry is broken by the fixed TL,TR,BR,BL order, so a rotated square is
 * never a false positive).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { quat, vec3 } from 'gl-matrix';
import type { Vector3 } from 'gps-plus-slam-js';
import { PlanarPnpSquare } from './planar-pnp';
import { buildObjectPoints, type Point2 } from './qr-pose';

const intr = { fx: 600, fy: 600, cx: 320, cy: 240 };
const solver = new PlanarPnpSquare();

/** rvec (axis·angle) → gl-matrix quaternion. */
function rvecToQuat(rvec: Vector3): quat {
  const angle = Math.hypot(...rvec);
  if (angle < 1e-12) return quat.create();
  return quat.setAxisAngle(
    quat.create(),
    vec3.normalize(vec3.create(), vec3.fromValues(...rvec)),
    angle
  );
}

/** Project the object corners through an OpenCV pose to detector pixels. */
function projectOpenCv(obj: readonly Vector3[], R: quat, t: Vector3): Point2[] {
  return obj.map((o) => {
    const v = vec3.transformQuat(vec3.create(), vec3.fromValues(...o), R);
    const z = v[2] + t[2];
    return {
      x: intr.cx + (intr.fx * (v[0] + t[0])) / z,
      y: intr.cy + (intr.fy * (v[1] + t[1])) / z,
    };
  });
}

/** RMS reprojection error of an OpenCV pose against detected corners. */
function reproj(
  obj: readonly Vector3[],
  corners: readonly Point2[],
  R: quat,
  t: Vector3
): number {
  let sumSq = 0;
  for (let i = 0; i < obj.length; i++) {
    const v = vec3.transformQuat(vec3.create(), vec3.fromValues(...obj[i]!), R);
    const z = v[2] + t[2];
    const px = intr.cx + (intr.fx * (v[0] + t[0])) / z;
    const py = intr.cy + (intr.fy * (v[1] + t[1])) / z;
    const dx = px - corners[i]!.x;
    const dy = py - corners[i]!.y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / obj.length);
}

// A clear (non-degenerate) tilt so the planar flip is distinguishable, but well
// within view. Axis is arbitrary; angle is the tilt magnitude.
const arbAxis = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 0.1);
const arbAngle = fc.double({ min: 0.15, max: 0.75, noNaN: true });
const arbT = fc.record({
  x: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
  y: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
  z: fc.double({ min: 1.2, max: 3.5, noNaN: true }),
});
const arbSize = fc.double({ min: 0.05, max: 0.5, noNaN: true });

describe('PlanarPnpSquare — recovers any plausible pose (noise-free)', () => {
  it('reprojects to ~0 px and recovers ground-truth orientation', () => {
    fc.assert(
      fc.property(arbAxis, arbAngle, arbT, arbSize, (axis, angle, t, sizeM) => {
        const R = quat.setAxisAngle(
          quat.create(),
          vec3.normalize(vec3.create(), vec3.fromValues(...axis)),
          angle
        );
        const tvec: Vector3 = [t.x, t.y, t.z];
        const obj = buildObjectPoints(sizeM);
        const corners = projectOpenCv(obj, R, tvec);

        // All corners must be finite / in front (always true for this cone).
        for (const c of corners) {
          fc.pre(Number.isFinite(c.x) && Number.isFinite(c.y));
        }

        const result = solver.solve(obj, corners, intr);
        expect(result).not.toBeNull();

        const Rrec = rvecToQuat(result!.rvec);
        // (a) the chosen pose reprojects the corners essentially exactly.
        // Threshold 1e-2 px (not 1e-3): the worst-conditioned poses in this cone
        // are near-fronto-parallel squares (tilt → the 0.15 rad floor) with an
        // in-plane roll, where IPPE's depth/tilt disambiguation is ill-conditioned
        // and the noise-free residual rises. A 60k-pose sweep put the empirical
        // worst case at ~5.1e-3 px (verified identical in float32 and float64, so
        // it is solver conditioning, NOT measurement precision); 1e-2 clears that
        // with margin while still asserting sub-1/100th-pixel reprojection.
        // (The old 1e-3 made this test flake ~1/1600 — see lessons-learned.)
        expect(reproj(obj, corners, Rrec, result!.tvec)).toBeLessThan(1e-2);
        // (b) orientation matches ground truth (|dot| ≈ 1 → same rotation).
        const d =
          Rrec[0] * R[0] + Rrec[1] * R[1] + Rrec[2] * R[2] + Rrec[3] * R[3];
        expect(Math.abs(d)).toBeGreaterThan(0.999);
        // translation recovered to mm.
        for (let i = 0; i < 3; i++) {
          expect(Math.abs(result!.tvec[i] - tvec[i]!)).toBeLessThan(2e-3);
        }
      }),
      { numRuns: 400 }
    );
  });

  /**
   * Deterministic regression for the exact pose that made the property above
   * flake (~1/1600 runs, surfaced under the full suite). It is the worst-
   * conditioned configuration the generator can hit: a near-fronto-parallel
   * square (tilt at the 0.15 rad floor) rotated purely about the optical (z)
   * axis, centred and at the minimum 1.2 m distance. The solver recovers it
   * accurately — orientation/translation to ~1e-7 — but the noise-free
   * reprojection residual is ~1.2e-3 px, which the old 1e-3 px threshold
   * rejected. This pins the case so the tolerance is never silently re-tightened.
   */
  it('recovers the worst-conditioned fronto-parallel/optical-roll pose (regression)', () => {
    const axis: Vector3 = [0, 0, 0.10000000000000002];
    const angle = 0.15;
    const tvec: Vector3 = [0, 0.00007759346825959858, 1.2000000000000004];
    const sizeM = 0.36054664067921594;

    const R = quat.setAxisAngle(
      quat.create(),
      vec3.normalize(vec3.create(), vec3.fromValues(...axis)),
      angle
    );
    const obj = buildObjectPoints(sizeM);
    const corners = projectOpenCv(obj, R, tvec);

    const result = solver.solve(obj, corners, intr);
    expect(result).not.toBeNull();

    const Rrec = rvecToQuat(result!.rvec);
    const rp = reproj(obj, corners, Rrec, result!.tvec);
    // Residual here is ~1.2e-3 px — small (sub-1/100th px) yet above the old
    // 1e-3 gate that flaked. Assert only the robust upper bound (a future solver
    // refinement is free to drive it lower; we must not lock in the conditioning).
    expect(rp).toBeLessThan(1e-2);
    // Orientation + translation are still recovered essentially exactly.
    const d = Rrec[0] * R[0] + Rrec[1] * R[1] + Rrec[2] * R[2] + Rrec[3] * R[3];
    expect(Math.abs(d)).toBeGreaterThan(0.999);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(result!.tvec[i]! - tvec[i]!)).toBeLessThan(2e-3);
    }
  });
});

describe('PlanarPnpSquare — bounded, graceful degradation under sub-pixel noise', () => {
  it('stays finite, in front, and low-reprojection with ≤0.5 px corner noise', () => {
    const arbNoise = fc.array(
      fc.tuple(
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true })
      ),
      { minLength: 4, maxLength: 4 }
    );
    fc.assert(
      fc.property(
        arbAxis,
        arbAngle,
        arbT,
        arbSize,
        arbNoise,
        (axis, angle, t, sizeM, noise) => {
          const R = quat.setAxisAngle(
            quat.create(),
            vec3.normalize(vec3.create(), vec3.fromValues(...axis)),
            angle
          );
          const tvec: Vector3 = [t.x, t.y, t.z];
          const obj = buildObjectPoints(sizeM);
          const clean = projectOpenCv(obj, R, tvec);
          const corners = clean.map((c, i) => ({
            x: c.x + noise[i]![0],
            y: c.y + noise[i]![1],
          }));

          const result = solver.solve(obj, corners, intr);
          // Noise can occasionally make a quad too degenerate; that legitimately
          // returns null and is not a failure.
          if (result === null) return;

          // Pose stays physically valid.
          expect(result.tvec.every(Number.isFinite)).toBe(true);
          expect(result.tvec[2]).toBeGreaterThan(0);
          // Reprojection against the NOISY corners stays bounded (the solver did
          // not diverge); a few px is the most 0.5 px input noise can produce.
          const Rrec = rvecToQuat(result.rvec);
          expect(reproj(obj, corners, Rrec, result.tvec)).toBeLessThan(4);
        }
      ),
      { numRuns: 300 }
    );
  });
});
