/**
 * QR pose aggregation — property tests.
 *
 * Why this test matters: the load-bearing claim of the whole sliding-window
 * design is "rotations sampled within ε of a base rotation aggregate back to
 * within ε of that base" (robust mean does not drift off the cluster), for
 * ARBITRARY axes and jitter — not just the hand-picked cases in the unit test.
 * The second property pins outlier rejection: adding a minority of wild
 * rotations must not move the result off the inlier cluster.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { quat } from 'gl-matrix';
import type { Quaternion } from 'gps-plus-slam-js';
import { averageRotation } from './qr-pose-aggregation';

function fromAxisAngle(
  axis: [number, number, number],
  rad: number
): Quaternion {
  const q = quat.create();
  quat.setAxisAngle(q, axis, rad);
  quat.normalize(q, q);
  return [q[0], q[1], q[2], q[3]];
}

function angleDeg(a: Quaternion, b: Quaternion): number {
  const ga = quat.normalize(
    quat.create(),
    quat.fromValues(a[0], a[1], a[2], a[3])
  );
  const gb = quat.normalize(
    quat.create(),
    quat.fromValues(b[0], b[1], b[2], b[3])
  );
  const d = quat.dot(ga, gb);
  const c = Math.min(1, Math.max(-1, 2 * d * d - 1));
  return (Math.acos(c) * 180) / Math.PI;
}

const unitAxis = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter(([x, y, z]) => Math.hypot(x, y, z) > 1e-3)
  .map(([x, y, z]) => {
    const n = Math.hypot(x, y, z);
    return [x / n, y / n, z / n] as [number, number, number];
  });

describe('averageRotation properties', () => {
  it('stays within ε of a base rotation for samples jittered within ε', () => {
    fc.assert(
      fc.property(
        unitAxis,
        fc.double({ min: 0, max: Math.PI, noNaN: true }),
        fc.array(fc.double({ min: -3, max: 3, noNaN: true }), {
          minLength: 3,
          maxLength: 12,
        }),
        (axis, baseAngleRad, jittersDeg) => {
          const base = fromAxisAngle(axis, baseAngleRad);
          const samples = jittersDeg.map((j) =>
            fromAxisAngle(axis, baseAngleRad + (j * Math.PI) / 180)
          );
          const r = averageRotation(samples, { inlierAngleDeg: 12 });
          expect(r).not.toBeNull();
          // All jitter ≤ 3° around the base on a single axis → mean within ~3°.
          expect(angleDeg(r!.quat, base)).toBeLessThan(3.5);
        }
      )
    );
  });

  it('ignores a minority of wild outliers (result stays on the inlier cluster)', () => {
    fc.assert(
      fc.property(
        unitAxis,
        fc.double({ min: 0.2, max: Math.PI - 0.2, noNaN: true }),
        fc.integer({ min: 3, max: 8 }),
        (axis, baseAngleRad, inlierCount) => {
          const base = fromAxisAngle(axis, baseAngleRad);
          const samples: Quaternion[] = [];
          for (let i = 0; i < inlierCount; i++) {
            // tight cluster within ±2° on the same axis
            samples.push(
              fromAxisAngle(
                axis,
                baseAngleRad + ((i % 2 ? 2 : -2) * Math.PI) / 180
              )
            );
          }
          // strictly fewer outliers than inliers, far away on an orthogonal-ish axis
          const outlierCount = Math.floor((inlierCount - 1) / 2);
          for (let i = 0; i < outlierCount; i++) {
            samples.push(
              fromAxisAngle(
                [axis[1], axis[2], axis[0]],
                baseAngleRad + Math.PI / 2
              )
            );
          }
          const r = averageRotation(samples, { inlierAngleDeg: 10 });
          expect(r).not.toBeNull();
          expect(r!.inlierCount).toBe(inlierCount);
          expect(angleDeg(r!.quat, base)).toBeLessThan(3);
        }
      )
    );
  });
});
