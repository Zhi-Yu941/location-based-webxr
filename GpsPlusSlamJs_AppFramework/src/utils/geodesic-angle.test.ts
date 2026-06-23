/**
 * Tests for the shared geodesic-angle kernel.
 *
 * Why this matters: this function is the single numeric definition of "angle
 * between two orientations" now reused by qr-pose-aggregation, tracking-quality
 * (matrixDelta) and the capture motion gate. A regression here silently shifts
 * all three. The cases below pin the contract the consolidation must preserve:
 * known angles, double-cover (sign) invariance, and the NaN-free identity case.
 */

import { describe, it, expect } from 'vitest';
import { quat } from 'gl-matrix';
import { geodesicAngleRad } from './geodesic-angle.js';

/** Unit quaternion for a rotation of `rad` about the Y axis. */
function quatY(rad: number): ReturnType<typeof quat.create> {
  const q = quat.create();
  return quat.setAxisAngle(q, [0, 1, 0], rad);
}

describe('geodesicAngleRad', () => {
  it('returns 0 for identical quaternions (no NaN)', () => {
    const q = quatY(0.37);
    const angle = geodesicAngleRad(q, q);
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeCloseTo(0, 10);
  });

  it('returns the known rotation angle for axis-angle pairs', () => {
    for (const expected of [0.1, 0.5, 1.0, Math.PI / 2, 2.5]) {
      const angle = geodesicAngleRad(quatY(0), quatY(expected));
      expect(angle).toBeCloseTo(expected, 6);
    }
  });

  it('caps at π for opposite orientations', () => {
    // A π rotation is the maximum geodesic distance between orientations.
    const angle = geodesicAngleRad(quatY(0), quatY(Math.PI));
    expect(angle).toBeCloseTo(Math.PI, 6);
  });

  it('is double-cover safe: q and -q give the same angle', () => {
    const a = quatY(0.3);
    const b = quatY(0.9);
    const bNeg = quat.fromValues(-b[0], -b[1], -b[2], -b[3]);
    expect(geodesicAngleRad(a, bNeg)).toBeCloseTo(geodesicAngleRad(a, b), 12);
  });

  it('matches gl-matrix quat.getAngle where the latter is finite', () => {
    // The consolidated helper must reproduce quat.getAngle (what matrixDelta
    // used) on the non-degenerate range — only the near-identical NaN case
    // differs (we return 0, see the dedicated test above).
    const a = quatY(0.2);
    const b = quatY(1.3);
    expect(geodesicAngleRad(a, b)).toBeCloseTo(quat.getAngle(a, b), 10);
  });
});
