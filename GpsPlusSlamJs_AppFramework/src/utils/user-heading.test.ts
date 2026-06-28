/**
 * Unit tests for the true-north user-heading kernel.
 *
 * Why this test matters:
 * Finding 2 of 2026-06-28-map-rings-transparency-and-view-direction-user-feedback.md
 * replaces the live-overlay blue dot with a dot + a thin blue line pointing in
 * the user's absolute (true-geographic-north) view direction. This kernel turns
 * the latest AR camera rotation (a NUE quaternion, as stored in
 * `gpsEvents.odometryRotations`) plus the GPS+SLAM alignment matrix into a
 * compass bearing in degrees. These tests pin the frame algebra that the rest
 * of the feature depends on:
 *   - the camera-forward basis vector in the NUE-AR frame is [1, 0, 0]
 *     (an identity camera looks North), derived from
 *     `webxrToNUE([0,0,-1]) = [1,0,0]`;
 *   - the alignment matrix rotates the AR-NUE forward into world NUE, and the
 *     bearing falls out as atan2(East, North);
 *   - heading is undefined (null) before the first alignment solve, with no
 *     rotation yet, and when the camera points near-vertically.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { quat, vec3 } from 'gl-matrix';
import fc from 'fast-check';
import { computeUserHeadingDeg } from './user-heading';
import type { Matrix4, Quaternion } from 'gps-plus-slam-js';

// Identity alignment: AR-NUE axes already equal world NUE (North/Up/East).
const IDENTITY_MAT4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A 90° alignment that maps AR-North -> world-East, AR-Up -> Up,
// AR-East -> world-(-North). Column-major; column 0 is the image of the
// North(+X) axis. Used to prove the alignment rotation is applied.
const ALIGN_NORTH_TO_EAST: Matrix4 = [
  0,
  0,
  1,
  0, // col0: image of North(+X) = East (0,0,1)
  0,
  1,
  0,
  0, // col1: image of Up(+Y) = Up
  -1,
  0,
  0,
  0, // col2: image of East(+Z) = -North (-1,0,0)
  0,
  0,
  0,
  1,
];

/** Build a NUE camera-rotation quaternion whose forward ([1,0,0]) points at `dir`. */
function quatForwardTo(dir: vec3): Quaternion {
  const out = quat.create();
  quat.rotationTo(out, [1, 0, 0], vec3.normalize(vec3.create(), dir));
  return [out[0], out[1], out[2], out[3]];
}

const NORTH: vec3 = [1, 0, 0];
const EAST: vec3 = [0, 0, 1];
const SOUTH: vec3 = [-1, 0, 0];
const WEST: vec3 = [0, 0, -1];
const UP: vec3 = [0, 1, 0];

describe('computeUserHeadingDeg', () => {
  it('returns 0° (North) for an identity camera under identity alignment', () => {
    const heading = computeUserHeadingDeg({
      odometryRotation: [0, 0, 0, 1],
      alignmentMatrix: IDENTITY_MAT4,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(0, 3);
  });

  it('maps cardinal camera-forward directions to compass bearings', () => {
    const cases: Array<{ dir: vec3; deg: number }> = [
      { dir: NORTH, deg: 0 },
      { dir: EAST, deg: 90 },
      { dir: SOUTH, deg: 180 },
      { dir: WEST, deg: 270 },
    ];
    for (const { dir, deg } of cases) {
      const heading = computeUserHeadingDeg({
        odometryRotation: quatForwardTo(dir),
        alignmentMatrix: IDENTITY_MAT4,
      });
      expect(heading).not.toBeNull();
      // Compare on the circle so 270 and -90 count as equal.
      const diff = (((heading! - deg) % 360) + 360) % 360;
      const circ = Math.min(diff, 360 - diff);
      expect(circ).toBeCloseTo(0, 2);
    }
  });

  it('applies the alignment rotation (identity camera + North→East alignment = 90°)', () => {
    const heading = computeUserHeadingDeg({
      odometryRotation: [0, 0, 0, 1],
      alignmentMatrix: ALIGN_NORTH_TO_EAST,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(90, 2);
  });

  it('composes camera and alignment rotations (East camera + North→East alignment = 180°)', () => {
    const heading = computeUserHeadingDeg({
      odometryRotation: quatForwardTo(EAST),
      alignmentMatrix: ALIGN_NORTH_TO_EAST,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(180, 2);
  });

  it('returns null before the first alignment solve (matrix null)', () => {
    expect(
      computeUserHeadingDeg({
        odometryRotation: [0, 0, 0, 1],
        alignmentMatrix: null,
      })
    ).toBeNull();
  });

  it('returns null when there is no rotation yet', () => {
    expect(
      computeUserHeadingDeg({
        odometryRotation: null,
        alignmentMatrix: IDENTITY_MAT4,
      })
    ).toBeNull();
  });

  it('returns null when the camera points near-vertically (heading undefined)', () => {
    expect(
      computeUserHeadingDeg({
        odometryRotation: quatForwardTo(UP),
        alignmentMatrix: IDENTITY_MAT4,
      })
    ).toBeNull();
  });
});

describe('computeUserHeadingDeg — properties', () => {
  it('always returns null or a bearing in [0, 360)', () => {
    expect(() =>
      fc.assert(
        fc.property(
          fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
          fc.double({ min: -Math.PI / 2.2, max: Math.PI / 2.2, noNaN: true }),
          (yaw, pitch) => {
            // Build an arbitrary look direction (avoid exactly vertical).
            const dir: vec3 = [
              Math.cos(pitch) * Math.cos(yaw),
              Math.sin(pitch),
              Math.cos(pitch) * Math.sin(yaw),
            ];
            const heading = computeUserHeadingDeg({
              odometryRotation: quatForwardTo(dir),
              alignmentMatrix: IDENTITY_MAT4,
            });
            if (heading === null) return true;
            return heading >= 0 && heading < 360;
          }
        )
      )
    ).not.toThrow();
  });

  it('is yaw-equivariant: rotating the camera yaw by Δ rotates the heading by a constant Δ (mod 360)', () => {
    const headingAt = (theta: number): number => {
      const q = quat.create();
      quat.setAxisAngle(q, [0, 1, 0], theta);
      const h = computeUserHeadingDeg({
        odometryRotation: [q[0], q[1], q[2], q[3]],
        alignmentMatrix: IDENTITY_MAT4,
      });
      return h!;
    };
    expect(() =>
      fc.assert(
        fc.property(
          fc.double({ min: -3, max: 3, noNaN: true }),
          fc.double({ min: 0.1, max: 1.0, noNaN: true }),
          (yaw, delta) => {
            const h0 = headingAt(yaw);
            const h1 = headingAt(yaw + delta);
            // Circular difference in degrees.
            const circ = ((h1 - h0 + 540) % 360) - 180;
            const expectedDeg = (delta * 180) / Math.PI;
            // Magnitude matches Δ regardless of the rotation's sign convention.
            return Math.abs(Math.abs(circ) - expectedDeg) < 0.5;
          }
        )
      )
    ).not.toThrow();
  });
});
