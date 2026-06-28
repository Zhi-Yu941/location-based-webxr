/**
 * Tests for the pure pose-motion helpers used by the capture motion gate.
 *
 * Why this matters: these two functions are the entire numeric basis for
 * deciding a frame is "too blurry to keep". The gate's correctness rests on
 * angular velocity being computed as a true geodesic rate (rad/s) and being
 * double-cover safe — the single most common quaternion bug. The dt<=0 guards
 * pin that a degenerate frame delta can never produce Infinity/NaN and flip the
 * gate. See 2026-06-23-blurry-frame-motion-gating-plan.md §4.1.
 */

import { describe, it, expect } from 'vitest';
import { quat } from 'gl-matrix';
import type { WebXRQuaternion, WebXRVec3 } from '../types/ar-types.js';
import { angularVelocity, linearVelocity } from './pose-motion.js';

/** WebXR-form unit quaternion for a rotation of `rad` about `axis`. */
function q(axis: [number, number, number], rad: number): WebXRQuaternion {
  const g = quat.setAxisAngle(quat.create(), axis, rad);
  quat.normalize(g, g);
  return { x: g[0], y: g[1], z: g[2], w: g[3] };
}

const IDENTITY: WebXRQuaternion = { x: 0, y: 0, z: 0, w: 1 };

function v(x: number, y: number, z: number): WebXRVec3 {
  return { x, y, z };
}

describe('angularVelocity', () => {
  it('returns angle/dt in rad/s for a known rotation', () => {
    // 1 rad about Y over 0.5 s => 2 rad/s.
    expect(angularVelocity(IDENTITY, q([0, 1, 0], 1), 0.5)).toBeCloseTo(2, 6);
  });

  it('is double-cover safe (q and -q give the same rate)', () => {
    const a = q([0, 1, 0], 0.3);
    const b = q([1, 0, 0], 0.7);
    const bNeg: WebXRQuaternion = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    expect(angularVelocity(a, bNeg, 0.25)).toBeCloseTo(
      angularVelocity(a, b, 0.25),
      10
    );
  });

  it('returns 0 for dt <= 0 (degenerate frame delta, no Infinity/NaN)', () => {
    const a = IDENTITY;
    const b = q([0, 1, 0], 1);
    for (const dt of [0, -0.016, -1]) {
      const result = angularVelocity(a, b, dt);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    }
  });

  it('tolerates un-normalized inputs (normalizes internally)', () => {
    // Scaling a quaternion does not change the orientation it represents.
    const scaled: WebXRQuaternion = { x: 0, y: 2, z: 0, w: 0 }; // 2x of (0,1,0,0) = π about Y
    expect(angularVelocity(IDENTITY, scaled, 1)).toBeCloseTo(Math.PI, 5);
  });
});

describe('linearVelocity', () => {
  it('returns straight-line distance / dt in m/s', () => {
    // 3-4-5 triangle => distance 5 m over 2 s => 2.5 m/s.
    expect(linearVelocity(v(0, 0, 0), v(3, 4, 0), 2)).toBeCloseTo(2.5, 9);
  });

  it('returns 0 for dt <= 0', () => {
    for (const dt of [0, -0.5]) {
      const result = linearVelocity(v(0, 0, 0), v(1, 1, 1), dt);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBe(0);
    }
  });

  it('is 0 for a stationary device', () => {
    expect(linearVelocity(v(1, 2, 3), v(1, 2, 3), 0.5)).toBe(0);
  });
});
