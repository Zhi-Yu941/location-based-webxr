/**
 * Unit tests for the heading-up minimap rotation helper.
 *
 * Why this matters: heading-up mode (2026-06-29 plan) spins the flat CSS3D
 * minimap so the user's heading points up. These tests pin the rotation
 * MECHANICS — that the map only ever spins in its own plane (its world-up
 * normal is invariant) and that the in-plane north edge rotates by the heading
 * about the vertical axis. The PERCEIVED sign (does it turn the way the user
 * expects on a north-up basemap) is a device spot-check, not asserted here.
 */

import { describe, it, expect } from 'vitest';
import { quat, vec3 } from 'gl-matrix';
import fc from 'fast-check';
import { headingUpQuat } from './heading-up-rotation';

/** Rotate a vector by a heading-up quaternion (as the CSS3DObject would). */
function applied(headingDeg: number, v: vec3): vec3 {
  const [x, y, z, w] = headingUpQuat(headingDeg);
  const q = quat.fromValues(x, y, z, w);
  return vec3.transformQuat(vec3.create(), v, q);
}

const LOCAL_NORMAL: vec3 = [0, 0, 1]; // DOM plane normal before tilt.
const LOCAL_NORTH_EDGE: vec3 = [0, 1, 0]; // DOM "up"/north edge before tilt.

describe('headingUpQuat', () => {
  it('returns the baseline tilt (−π/2 about +X) at heading 0', () => {
    const out = headingUpQuat(0);
    // −90° about X: [sin(−π/4), 0, 0, cos(−π/4)] = [−√2/2, 0, 0, √2/2].
    const h = Math.SQRT1_2;
    expect(out[0]).toBeCloseTo(-h, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(0, 6);
    expect(out[3]).toBeCloseTo(h, 6);
  });

  it('always returns a unit quaternion', () => {
    for (const deg of [0, 37, 90, 180, 270, 359]) {
      const out = headingUpQuat(deg);
      const len = Math.hypot(out[0], out[1], out[2], out[3]);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it('keeps the map flat: the plane normal stays world-up (+Y) for any heading', () => {
    for (const deg of [0, 45, 90, 137, 270]) {
      const n = applied(deg, LOCAL_NORMAL);
      expect(n[0]).toBeCloseTo(0, 6);
      expect(n[1]).toBeCloseTo(1, 6);
      expect(n[2]).toBeCloseTo(0, 6);
    }
  });

  it('lays the north edge to world −Z at heading 0 (north-up baseline)', () => {
    const e = applied(0, LOCAL_NORTH_EDGE);
    expect(e[0]).toBeCloseTo(0, 6);
    expect(e[1]).toBeCloseTo(0, 6);
    expect(e[2]).toBeCloseTo(-1, 6);
  });

  it('rotates the north edge about world-up by the heading (90° → world +X)', () => {
    // Baseline north edge is −Z; a 90° heading yaws it by −90° about +Y → +X.
    const e = applied(90, LOCAL_NORTH_EDGE);
    expect(e[0]).toBeCloseTo(1, 6);
    expect(e[1]).toBeCloseTo(0, 6);
    expect(e[2]).toBeCloseTo(0, 6);
  });

  it('property: the north edge stays horizontal (no vertical component) and unit-length', () => {
    expect(() =>
      fc.assert(
        fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (deg) => {
          const e = applied(deg, LOCAL_NORTH_EDGE);
          const horizontalOnly = Math.abs(e[1]) < 1e-6;
          const unit = Math.abs(Math.hypot(e[0], e[1], e[2]) - 1) < 1e-6;
          return horizontalOnly && unit;
        })
      )
    ).not.toThrow();
  });

  it('property: heading and heading+360 produce the same orientation', () => {
    expect(() =>
      fc.assert(
        fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (deg) => {
          const a = applied(deg, LOCAL_NORTH_EDGE);
          const b = applied(deg + 360, LOCAL_NORTH_EDGE);
          return (
            Math.abs(a[0] - b[0]) < 1e-6 &&
            Math.abs(a[1] - b[1]) < 1e-6 &&
            Math.abs(a[2] - b[2]) < 1e-6
          );
        })
      )
    ).not.toThrow();
  });
});
