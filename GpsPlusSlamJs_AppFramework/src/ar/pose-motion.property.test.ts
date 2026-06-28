/**
 * Property tests for the pose-motion helpers.
 *
 * Why this matters: the unit tests pin hand-picked angles; these pin the
 * invariants that must hold for ARBITRARY motion — the gate would silently
 * misbehave if any failed:
 *  - angular velocity is frame-invariant (rotating the whole world does not
 *    change how fast the device turned relative to the scene),
 *  - it is non-negative, and
 *  - it scales as 1/dt (same rotation observed over half the time reads twice
 *    as fast).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { quat } from 'gl-matrix';
import type { WebXRQuaternion } from '../types/ar-types.js';
import { angularVelocity } from './pose-motion.js';

function toWebXR(g: ReturnType<typeof quat.create>): WebXRQuaternion {
  return { x: g[0], y: g[1], z: g[2], w: g[3] };
}

/** Arbitrary unit quaternion (uniform enough for these invariants). */
const arbQuat = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter(([x, y, z, w]) => x * x + y * y + z * z + w * w > 1e-6)
  .map(([x, y, z, w]) => {
    const g = quat.normalize(quat.create(), quat.fromValues(x, y, z, w));
    return g;
  });

const arbDt = fc.double({ min: 0.001, max: 5, noNaN: true });

describe('angularVelocity — properties', () => {
  it('is non-negative for any pair and positive dt', () => {
    fc.assert(
      fc.property(arbQuat, arbQuat, arbDt, (a, b, dt) => {
        const w = angularVelocity(toWebXR(a), toWebXR(b), dt);
        expect(w).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('is invariant under a global rotation applied to both orientations', () => {
    // dt is fixed at 1 s so velocity == angle: invariance is a property of the
    // ANGLE and is independent of dt, and a tiny dt would otherwise amplify the
    // test's own Float32 error (gl-matrix quaternions are Float32; multiplying
    // a near-antipodal pair accumulates ~1e-3 rad). 5e-3 rad (~0.3°) bounds
    // that Float32 setup noise — the function under test is exact in float64.
    fc.assert(
      fc.property(arbQuat, arbQuat, arbQuat, (a, b, r) => {
        const base = angularVelocity(toWebXR(a), toWebXR(b), 1);
        // Pre-multiply both by the same rotation r (change of world frame).
        const ra = quat.multiply(quat.create(), r, a);
        const rb = quat.multiply(quat.create(), r, b);
        const rotated = angularVelocity(toWebXR(ra), toWebXR(rb), 1);
        expect(Math.abs(rotated - base)).toBeLessThanOrEqual(5e-3);
      })
    );
  });

  it('scales inversely with dt (halving dt doubles the rate)', () => {
    fc.assert(
      fc.property(arbQuat, arbQuat, arbDt, (a, b, dt) => {
        const full = angularVelocity(toWebXR(a), toWebXR(b), dt);
        const half = angularVelocity(toWebXR(a), toWebXR(b), dt / 2);
        // Relative tolerance: at ~10³ rad/s an absolute toBeCloseTo bound is
        // unrealistic; only ~1 ULP separates A/(dt/2) from (A/dt)·2.
        const expected = full * 2;
        expect(Math.abs(half - expected)).toBeLessThanOrEqual(
          1e-9 * (1 + Math.abs(expected))
        );
      })
    );
  });
});
