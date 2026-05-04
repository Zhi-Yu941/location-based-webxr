/**
 * Property-based tests for gps-event-coordinator.ts
 *
 * Why these tests matter:
 * Unit tests verify specific examples, but property-based tests verify
 * invariants that MUST hold for ALL valid inputs. Quaternion math is
 * particularly prone to edge case bugs that property testing can catch.
 *
 * Properties tested:
 * 1. Unit quaternion invariant: |q| ≈ 1 for any valid Euler angles
 * 2. Periodicity: α±360° produces equivalent rotations
 * 3. Identity: eulerToQuaternion(0,0,0) ≈ [0,0,0,1]
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { vec3 as glVec3, quat as glQuat } from 'gl-matrix';
import {
  quaternionMagnitude,
  quaternionsEquivalent,
  multiplyQuaternions,
  invertQuaternion,
  type Vector3,
  type Quaternion,
} from 'gps-plus-slam-js';
import { eulerToQuaternion } from './gps-event-coordinator';

/**
 * Apply a quaternion rotation to a 3D vector.
 * Uses gl-matrix for the transformation.
 */
function transformVector(q: Quaternion, v: Vector3): Vector3 {
  const qGl = glQuat.fromValues(q[0], q[1], q[2], q[3]);
  const vGl = glVec3.fromValues(v[0], v[1], v[2]);
  const result = glVec3.create();
  glVec3.transformQuat(result, vGl, qGl);
  return [result[0], result[1], result[2]];
}

describe('eulerToQuaternion property-based tests', () => {
  /**
   * Property: Output must always be a unit quaternion
   *
   * This is the most important invariant. If the magnitude is not 1,
   * the quaternion will cause scaling in addition to rotation, which
   * would corrupt all pose calculations.
   */
  it('should always produce a unit quaternion for any Euler angles', () => {
    fc.assert(
      fc.property(
        // Device orientation ranges from spec:
        // alpha: 0-360° (compass heading)
        // beta: -180 to 180° (front-to-back tilt)
        // gamma: -90 to 90° (left-to-right tilt)
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q = eulerToQuaternion(alpha, beta, gamma);
          const magnitude = quaternionMagnitude(q);
          // Allow floating-point tolerance (6 decimal places is sufficient
          // for device orientation where sensor noise is ~0.01°)
          expect(magnitude).toBeCloseTo(1, 6);
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * Property: 360° periodicity in alpha (compass heading)
   *
   * Rotating by alpha and alpha+360 should give the same orientation.
   * This tests that we handle the circular nature of compass headings.
   */
  it('should produce equivalent quaternions for alpha ± 360°', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q1 = eulerToQuaternion(alpha, beta, gamma);
          const q2 = eulerToQuaternion(alpha + 360, beta, gamma);
          const q3 = eulerToQuaternion(alpha - 360, beta, gamma);

          expect(quaternionsEquivalent(q1, q2)).toBe(true);
          expect(quaternionsEquivalent(q1, q3)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: 360° periodicity in beta (pitch)
   *
   * Even though beta is defined as -180 to 180, adding 360 should
   * wrap around to the same orientation.
   */
  it('should produce equivalent quaternions for beta ± 360°', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q1 = eulerToQuaternion(alpha, beta, gamma);
          const q2 = eulerToQuaternion(alpha, beta + 360, gamma);
          const q3 = eulerToQuaternion(alpha, beta - 360, gamma);

          expect(quaternionsEquivalent(q1, q2)).toBe(true);
          expect(quaternionsEquivalent(q1, q3)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: 360° periodicity in gamma (roll)
   *
   * Same as above but for the roll axis.
   */
  it('should produce equivalent quaternions for gamma ± 360°', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q1 = eulerToQuaternion(alpha, beta, gamma);
          const q2 = eulerToQuaternion(alpha, beta, gamma + 360);
          const q3 = eulerToQuaternion(alpha, beta, gamma - 360);

          expect(quaternionsEquivalent(q1, q2)).toBe(true);
          expect(quaternionsEquivalent(q1, q3)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Output is always a 4-element array
   *
   * The function signature says it returns a 4-tuple, but let's verify
   * it never returns undefined elements or wrong array length.
   */
  it('should always return exactly 4 finite numbers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (alpha, beta, gamma) => {
          const q = eulerToQuaternion(alpha, beta, gamma);

          expect(Array.isArray(q)).toBe(true);
          expect(q.length).toBe(4);
          expect(Number.isFinite(q[0])).toBe(true);
          expect(Number.isFinite(q[1])).toBe(true);
          expect(Number.isFinite(q[2])).toBe(true);
          expect(Number.isFinite(q[3])).toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * Property: All quaternion components should be in range [-1, 1]
   *
   * For a unit quaternion, no component can have magnitude > 1.
   */
  it('should have all components in [-1, 1] range', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q = eulerToQuaternion(alpha, beta, gamma);

          expect(q[0]).toBeGreaterThanOrEqual(-1);
          expect(q[0]).toBeLessThanOrEqual(1);
          expect(q[1]).toBeGreaterThanOrEqual(-1);
          expect(q[1]).toBeLessThanOrEqual(1);
          expect(q[2]).toBeGreaterThanOrEqual(-1);
          expect(q[2]).toBeLessThanOrEqual(1);
          expect(q[3]).toBeGreaterThanOrEqual(-1);
          expect(q[3]).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * Property: Consistency - same input should give same output
   *
   * This verifies the function is deterministic (no hidden state).
   */
  it('should be deterministic - same input gives same output', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q1 = eulerToQuaternion(alpha, beta, gamma);
          const q2 = eulerToQuaternion(alpha, beta, gamma);

          expect(q1[0]).toBe(q2[0]);
          expect(q1[1]).toBe(q2[1]);
          expect(q1[2]).toBe(q2[2]);
          expect(q1[3]).toBe(q2[3]);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: ZXY intrinsic rotation order per W3C DeviceOrientation spec §3.1.
   *
   * q = qZ · qX · qY, where qZ/qX/qY are single-axis quaternions.
   * We verify that the combined quaternion matches the manual composition
   * for arbitrary Euler angle triples.
   */
  it('should apply rotations in ZXY order for any angle combination', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }), // Avoid gimbal lock for this test
        fc.double({ min: -45, max: 45, noNaN: true }),
        (alpha, beta, gamma) => {
          // Get combined quaternion
          const qCombined = eulerToQuaternion(alpha, beta, gamma);

          // Build individual axis quaternions
          const qZ = eulerToQuaternion(alpha, 0, 0); // Z only
          const qX = eulerToQuaternion(0, beta, 0); // X only
          const qY = eulerToQuaternion(0, 0, gamma); // Y only

          // For intrinsic ZXY order: q = qZ * qX * qY
          const qManual = multiplyQuaternions(qZ, multiplyQuaternions(qX, qY));

          // Should produce equivalent rotations
          expect(quaternionsEquivalent(qCombined, qManual, 1e-6)).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Alpha-only rotation rotates around Z axis
   *
   * When only alpha is non-zero, the rotation should be purely around Z.
   * Vector [1, 0, 0] (east) rotated by alpha degrees around Z should go to
   * [cos(alpha), sin(alpha), 0].
   */
  it('should rotate around Z axis when only alpha is set', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (alpha) => {
        const q = eulerToQuaternion(alpha, 0, 0);
        const v: Vector3 = [1, 0, 0];
        const result = transformVector(q, v);

        const alphaRad = (alpha * Math.PI) / 180;
        const expectedX = Math.cos(alphaRad);
        const expectedY = Math.sin(alphaRad);

        expect(result[0]).toBeCloseTo(expectedX, 5);
        expect(result[1]).toBeCloseTo(expectedY, 5);
        expect(result[2]).toBeCloseTo(0, 5);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Beta-only rotation rotates around X axis
   *
   * When only beta is non-zero, the rotation should be purely around X.
   * Vector [0, 1, 0] (north) rotated by beta degrees around X should go to
   * [0, cos(beta), sin(beta)].
   */
  it('should rotate around X axis when only beta is set', () => {
    fc.assert(
      fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (beta) => {
        const q = eulerToQuaternion(0, beta, 0);
        const v: Vector3 = [0, 1, 0];
        const result = transformVector(q, v);

        const betaRad = (beta * Math.PI) / 180;
        const expectedY = Math.cos(betaRad);
        const expectedZ = Math.sin(betaRad);

        expect(result[0]).toBeCloseTo(0, 5);
        expect(result[1]).toBeCloseTo(expectedY, 5);
        expect(result[2]).toBeCloseTo(expectedZ, 5);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Gamma-only rotation rotates around Y axis
   *
   * When only gamma is non-zero, the rotation should be purely around Y.
   * Vector [0, 0, 1] (up) rotated by gamma degrees around Y should go to
   * [sin(gamma), 0, cos(gamma)].
   */
  it('should rotate around Y axis when only gamma is set', () => {
    fc.assert(
      fc.property(fc.double({ min: -90, max: 90, noNaN: true }), (gamma) => {
        const q = eulerToQuaternion(0, 0, gamma);
        const v: Vector3 = [0, 0, 1];
        const result = transformVector(q, v);

        const gammaRad = (gamma * Math.PI) / 180;
        const expectedX = Math.sin(gammaRad);
        const expectedZ = Math.cos(gammaRad);

        expect(result[0]).toBeCloseTo(expectedX, 5);
        expect(result[1]).toBeCloseTo(0, 5);
        expect(result[2]).toBeCloseTo(expectedZ, 5);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Inverse angles produce inverse rotations
   *
   * If we rotate by (alpha, beta, gamma) and then by (-alpha, -beta, -gamma),
   * we should get back to identity (approximately, due to order dependence).
   * For single-axis rotations this should be exact.
   */
  it('should produce inverse rotation for negated single-axis angles', () => {
    fc.assert(
      fc.property(fc.double({ min: -180, max: 180, noNaN: true }), (angle) => {
        // Test each axis independently
        const qAlpha = eulerToQuaternion(angle, 0, 0);
        const qAlphaInv = eulerToQuaternion(-angle, 0, 0);

        const qBeta = eulerToQuaternion(0, angle, 0);
        const qBetaInv = eulerToQuaternion(0, -angle, 0);

        const qGamma = eulerToQuaternion(0, 0, angle);
        const qGammaInv = eulerToQuaternion(0, 0, -angle);

        // Composing rotation with its inverse should give identity
        const identity: Quaternion = [0, 0, 0, 1];

        const resultAlpha = multiplyQuaternions(qAlpha, qAlphaInv);
        const resultBeta = multiplyQuaternions(qBeta, qBetaInv);
        const resultGamma = multiplyQuaternions(qGamma, qGammaInv);

        expect(quaternionsEquivalent(resultAlpha, identity, 1e-6)).toBe(true);
        expect(quaternionsEquivalent(resultBeta, identity, 1e-6)).toBe(true);
        expect(quaternionsEquivalent(resultGamma, identity, 1e-6)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Quaternion inverse correctly reverses transformation
   *
   * For any quaternion q, applying q then q^-1 should return the original vector.
   */
  it('should correctly reverse transformations with quaternion inverse', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -45, max: 45, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (alpha, beta, gamma, vx, vy, vz) => {
          const q = eulerToQuaternion(alpha, beta, gamma);
          const qInv = invertQuaternion(q);

          const original: Vector3 = [vx, vy, vz];
          const transformed = transformVector(q, original);
          const restored = transformVector(qInv, transformed);

          expect(restored[0]).toBeCloseTo(original[0], 5);
          expect(restored[1]).toBeCloseTo(original[1], 5);
          expect(restored[2]).toBeCloseTo(original[2], 5);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Near gimbal lock stability (beta ≈ ±90°)
   *
   * At beta = ±90°, we approach gimbal lock where alpha and gamma become
   * ambiguous. The function should still produce valid unit quaternions
   * without NaN or Infinity.
   */
  it('should remain stable near gimbal lock (beta ≈ ±90°)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 89, max: 91, noNaN: true }), // Near +90
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q = eulerToQuaternion(alpha, beta, gamma);
          const magnitude = quaternionMagnitude(q);

          expect(magnitude).toBeCloseTo(1, 6);
          expect(Number.isFinite(q[0])).toBe(true);
          expect(Number.isFinite(q[1])).toBe(true);
          expect(Number.isFinite(q[2])).toBe(true);
          expect(Number.isFinite(q[3])).toBe(true);
        }
      ),
      { numRuns: 200 }
    );

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -91, max: -89, noNaN: true }), // Near -90
        fc.double({ min: -90, max: 90, noNaN: true }),
        (alpha, beta, gamma) => {
          const q = eulerToQuaternion(alpha, beta, gamma);
          const magnitude = quaternionMagnitude(q);

          expect(magnitude).toBeCloseTo(1, 6);
          expect(Number.isFinite(q[0])).toBe(true);
          expect(Number.isFinite(q[1])).toBe(true);
          expect(Number.isFinite(q[2])).toBe(true);
          expect(Number.isFinite(q[3])).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property: Extreme angles don't cause overflow
   *
   * Even with very large angles (multiple full rotations), the output
   * should still be a valid unit quaternion.
   */
  it('should handle extreme angles without overflow', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        (alpha, beta, gamma) => {
          const q = eulerToQuaternion(alpha, beta, gamma);
          const magnitude = quaternionMagnitude(q);

          expect(magnitude).toBeCloseTo(1, 5);
          expect(Number.isFinite(q[0])).toBe(true);
          expect(Number.isFinite(q[1])).toBe(true);
          expect(Number.isFinite(q[2])).toBe(true);
          expect(Number.isFinite(q[3])).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property: Vector length preservation
   *
   * Rotation should preserve the length of any vector.
   */
  it('should preserve vector length for any rotation', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (alpha, beta, gamma, vx, vy, vz) => {
          const q = eulerToQuaternion(alpha, beta, gamma);
          const v: Vector3 = [vx, vy, vz];
          const result = transformVector(q, v);

          const originalLength = Math.sqrt(vx ** 2 + vy ** 2 + vz ** 2);
          const resultLength = Math.sqrt(
            result[0] ** 2 + result[1] ** 2 + result[2] ** 2
          );

          // Use relative tolerance for larger values
          // For small vectors, use absolute tolerance of 1e-10
          const tolerance = Math.max(originalLength * 1e-6, 1e-10);
          expect(Math.abs(resultLength - originalLength)).toBeLessThan(
            tolerance
          );
        }
      ),
      { numRuns: 500 }
    );
  });
});
