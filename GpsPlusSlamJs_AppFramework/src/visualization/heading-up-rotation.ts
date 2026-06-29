/**
 * Heading-up minimap rotation helper.
 *
 * The live in-AR minimap is a Leaflet map wrapped in a three.js `CSS3DObject`
 * lying flat below the camera. Its baseline orientation is a single −π/2
 * rotation about the local +X axis (`tilt`), which lays the DOM plane flat so
 * the user looks down on a NORTH-UP map (its plane normal points world +Y).
 *
 * "Heading-up" mode spins that flat map in its own plane so the user's view
 * direction always points up/forward. We do this by composing a yaw about the
 * world up axis (+Y) with the baseline tilt:
 *
 *     quaternion = yaw(−headingDeg about +Y) · tilt(−π/2 about +X)
 *
 * Because the yaw is about +Y and the tilted plane's normal is already +Y, the
 * normal is invariant under the yaw — the map stays flat and merely rotates
 * in-plane. The map's parent (`CameraFollower`) is rotation-identity, so the
 * object-local axes equal world axes; the yaw is therefore about true world up.
 *
 * Sign caveat: the *magnitude* and *axis* of the rotation are pinned by
 * `heading-up-rotation.test.ts`, but whether `−headingDeg` makes the map turn
 * the way a user perceives as correct on a north-up basemap is a device
 * spot-check (same open item as the heading line's sign — see
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-heading-up-minimap-rotation-plan.md
 * § Follow-ups). If the device check shows it turns the wrong way, flip the sign
 * of `YAW_SIGN` below — the one place that decides it.
 */

import { quat } from 'gl-matrix';

/** Baseline tilt: −π/2 about +X (lays the map flat, normal → world +Y). */
const TILT_X_RAD = -Math.PI / 2;

/**
 * Sign of the yaw applied for a positive (clockwise-from-north) heading.
 * Isolated as the single knob the on-device sign check would flip.
 */
const YAW_SIGN = -1;

const DEG_TO_RAD = Math.PI / 180;

// Baseline tilt quaternion, computed once (no per-call allocation churn).
const TILT = quat.setAxisAngle(quat.create(), [1, 0, 0], TILT_X_RAD);

const _yaw = quat.create();
const _out = quat.create();

/**
 * Quaternion (`[x, y, z, w]`) for the `CSS3DObject` so the flat minimap shows
 * `headingDeg` (clockwise from geographic north) pointing up.
 *
 * `headingDeg = 0` returns the baseline tilt-only orientation (north-up).
 *
 * @param headingDeg Absolute view bearing in degrees clockwise from north.
 * @returns A unit quaternion as a 4-tuple `[x, y, z, w]`.
 */
export function headingUpQuat(
  headingDeg: number
): [number, number, number, number] {
  quat.setAxisAngle(_yaw, [0, 1, 0], YAW_SIGN * headingDeg * DEG_TO_RAD);
  // Apply tilt first, then yaw: q = yaw · tilt.
  quat.multiply(_out, _yaw, TILT);
  return [_out[0], _out[1], _out[2], _out[3]];
}
