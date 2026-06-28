/**
 * Pose-motion helpers — stateless angular/linear velocity from two AR poses.
 *
 * The capture motion gate (blurry-frame skipping, see
 * `GpsPlusSlamJs_Docs/docs/2026-06-23-blurry-frame-motion-gating-plan.md` §4.1)
 * rejects frames whose device motion is too fast to yield a sharp image. Motion
 * is derived from consecutive WebXR poses — cheaper than any image-content
 * metric because it needs no GPU readback.
 *
 * This module holds ONLY the pure, stateless math (angle ÷ dt, distance ÷ dt).
 * The stateful policy (sliding window, glitch rejection, the capture decision)
 * lives in `ImageCaptureManager` and `capture-motion-gate.ts` — keeping the
 * reusable atom separate from the capture-specific policy (plan §4.1 "Scope").
 *
 * Angular velocity reuses the shared `geodesicAngleRad` kernel rather than a
 * fresh `acos` (CLAUDE.md: search first, prefer refactor over re-implementation).
 */

import { quat } from 'gl-matrix';
import type { WebXRQuaternion, WebXRVec3 } from '../types/ar-types.js';
import { geodesicAngleRad } from '../utils/geodesic-angle.js';

/**
 * Convert a WebXR object-form quaternion to a normalized gl-matrix quaternion.
 * Normalizing defends against slightly non-unit inputs (the gate must not throw
 * on imperfect tracking data).
 */
function toGlQuat(q: WebXRQuaternion): ReturnType<typeof quat.create> {
  const g = quat.fromValues(q.x, q.y, q.z, q.w);
  return quat.normalize(g, g);
}

/**
 * Angular velocity in radians/second between two orientations.
 *
 * @param qPrev - orientation at the previous frame.
 * @param qCur - orientation at the current frame.
 * @param dtSeconds - elapsed time in seconds (must be > 0).
 * @returns geodesic angle between the orientations divided by `dtSeconds`.
 *   Returns `0` when `dtSeconds <= 0` (degenerate/duplicate frame timestamp) so
 *   a bad delta can never produce `Infinity`/`NaN` and spuriously flip the
 *   motion gate. Double-cover safe (`q` ≡ `−q`) via the shared kernel.
 */
export function angularVelocity(
  qPrev: WebXRQuaternion,
  qCur: WebXRQuaternion,
  dtSeconds: number
): number {
  if (!(dtSeconds > 0)) return 0;
  const angle = geodesicAngleRad(toGlQuat(qPrev), toGlQuat(qCur));
  return angle / dtSeconds;
}

/**
 * Linear velocity in metres/second between two positions.
 *
 * @param pPrev - position at the previous frame.
 * @param pCur - position at the current frame.
 * @param dtSeconds - elapsed time in seconds (must be > 0).
 * @returns straight-line distance divided by `dtSeconds`. Returns `0` when
 *   `dtSeconds <= 0` (same guard rationale as {@link angularVelocity}).
 */
export function linearVelocity(
  pPrev: WebXRVec3,
  pCur: WebXRVec3,
  dtSeconds: number
): number {
  if (!(dtSeconds > 0)) return 0;
  const dx = pCur.x - pPrev.x;
  const dy = pCur.y - pPrev.y;
  const dz = pCur.z - pPrev.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / dtSeconds;
}
