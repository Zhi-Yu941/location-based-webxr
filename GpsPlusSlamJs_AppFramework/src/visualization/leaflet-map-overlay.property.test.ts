/**
 * Property tests for the F1 viewer-plane invariant of the CSS3D minimap
 * (2026-07-04 user feedback).
 *
 * Why these tests matter:
 * The map plane is parented to the CameraFollower — camera POSITION is
 * followed (lerped), rotation stays IDENTITY (GPS-world-aligned). CSS3D
 * content crossing the viewer plane (camera-space z ≥ 0) is cut off by the
 * browser; camera.near cannot move that plane. The defaults must therefore
 * guarantee: for EVERY camera yaw, EVERY heading-up rotation of the plane
 * about its own centre, every follower lerp-lag up to the margin, and every
 * pitch at or above the design pitch θ* = 51°, all four plane corners stay
 * strictly in front of the viewer plane. This encodes the geometric proof
 * from the F1 spec (GpsPlusSlamJs_Docs/docs/
 * 2026-07-04-1626-ar-clipping-planes-and-lifecycle-plan.md) as executable
 * documentation — including the yaw dimensions the original (pre-review)
 * fix draft missed.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_WORLD_SIZE,
  DEFAULT_HEIGHT_OFFSET,
  DEFAULT_Z_OFFSET,
} from './leaflet-map-overlay';

/** Follower position-lerp lag while walking (metres, conservative bound). */
const LAG_MARGIN_M = 0.5;
/** Design pitch (degrees down from level) above which the map never clips. */
const DESIGN_PITCH_DEG = 51;

const DEG = Math.PI / 180;

/**
 * Camera-space depth sign for a point P given camera yaw φ and downward
 * pitch θ: the camera forward unit vector is
 *   f = (cosθ·cosφ, −sinθ, cosθ·sinφ)
 * and P is "in front of the viewer plane" iff P·f > 0 (P is expressed
 * relative to the camera position, world axes, Y up).
 */
function inFrontOfViewerPlane(
  p: readonly [number, number, number],
  yawRad: number,
  pitchRad: number
): boolean {
  const fx = Math.cos(pitchRad) * Math.cos(yawRad);
  const fy = -Math.sin(pitchRad);
  const fz = Math.cos(pitchRad) * Math.sin(yawRad);
  return p[0] * fx + p[1] * fy + p[2] * fz > 0;
}

describe('F1: map-plane corners never cross the viewer plane at pitch ≥ θ*', () => {
  it('holds for all camera yaws, heading-up yaws, lags and pitches ∈ [θ*, 90°]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }), // camera yaw φ (deg)
        fc.double({ min: 0, max: 360, noNaN: true }), // heading-up yaw ψ (deg)
        fc.double({ min: DESIGN_PITCH_DEG, max: 90, noNaN: true }), // pitch θ
        fc.double({ min: 0, max: LAG_MARGIN_M, noNaN: true }), // lag magnitude
        fc.double({ min: 0, max: 360, noNaN: true }), // lag direction (deg)
        (yawDeg, headingUpDeg, pitchDeg, lagMag, lagDirDeg) => {
          const psi = headingUpDeg * DEG;
          const lagDir = lagDirDeg * DEG;

          // Plane centre relative to the camera, world axes: the follower
          // lags the camera by up to LAG_MARGIN_M in an arbitrary horizontal
          // direction; DEFAULT_Z_OFFSET is applied along the parent's local
          // (world-aligned) Z axis.
          const cx = lagMag * Math.cos(lagDir);
          const cz = lagMag * Math.sin(lagDir) + DEFAULT_Z_OFFSET;
          const cy = DEFAULT_HEIGHT_OFFSET;

          // Four corners, rotated by the heading-up yaw ψ about the plane's
          // own vertical axis (this is exactly what updatePosition() does to
          // the CSS3DObject's quaternion each frame in heading-up mode).
          const half = DEFAULT_WORLD_SIZE / 2;
          for (const [dx, dz] of [
            [half, half],
            [half, -half],
            [-half, half],
            [-half, -half],
          ] as const) {
            const rx = dx * Math.cos(psi) - dz * Math.sin(psi);
            const rz = dx * Math.sin(psi) + dz * Math.cos(psi);
            const corner: [number, number, number] = [cx + rx, cy, cz + rz];
            expect(
              inFrontOfViewerPlane(corner, yawDeg * DEG, pitchDeg * DEG)
            ).toBe(true);
          }
        }
      ),
      { numRuns: 2000 }
    );
  });

  it('documents that the guarantee is tight: below θ* a worst-case corner DOES cross', () => {
    // Why: pins that θ* is a real boundary, not slack — if someone enlarges
    // the plane or raises it, this test forces re-deriving θ* instead of
    // silently degrading the on-device experience.
    // Worst case: heading-up yaw 45° puts a corner at radius s/√2 from the
    // plane centre; maximal lag and the (zero) z-offset add on top; the
    // camera (yaw 0 looks toward +x here) faces exactly away from it.
    const half = DEFAULT_WORLD_SIZE / 2;
    const cornerRadius = Math.hypot(half, half); // = s/√2
    const behind = cornerRadius + LAG_MARGIN_M + Math.abs(DEFAULT_Z_OFFSET);
    const worst: [number, number, number] = [-behind, DEFAULT_HEIGHT_OFFSET, 0];
    // 5° below the design pitch the worst-case corner must be clipped…
    expect(inFrontOfViewerPlane(worst, 0, (DESIGN_PITCH_DEG - 5) * DEG)).toBe(
      false
    );
    // …and at the design pitch it must not be.
    expect(inFrontOfViewerPlane(worst, 0, DESIGN_PITCH_DEG * DEG)).toBe(true);
  });
});
