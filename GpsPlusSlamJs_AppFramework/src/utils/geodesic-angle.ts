/**
 * Geodesic-angle kernel — the single shared definition of the shortest-arc
 * rotation angle between two unit quaternions.
 *
 * This used to be hand-rolled in (at least) two places:
 * - `geodesicAngleRad` (private) in `ar/qr-pose-aggregation.ts`, and
 * - `quat.getAngle(...)` + a NaN guard inside `state/tracking-quality.ts`'s
 *   `matrixDelta`.
 *
 * Both compute the same number — `acos(2·dot² − 1)` — so they are consolidated
 * here so a third consumer (the capture motion gate's angular-velocity helper,
 * `ar/pose-motion.ts`) reuses one definition instead of adding a fourth copy.
 * See `GpsPlusSlamJs_Docs/docs/2026-06-23-followup-consolidate-geodesic-angle-kernel.md`.
 */

import { quat } from 'gl-matrix';
import type { ReadonlyQuat } from 'gl-matrix';

/**
 * Geodesic (shortest-arc) rotation angle in radians between two **unit**
 * quaternions.
 *
 * Uses `cos θ = 2·dot² − 1`, which is invariant to the sign of either input
 * (`q` ≡ `−q`, the quaternion double cover) because it depends only on `dot²`.
 * The argument is clamped to `[-1, 1]` before `acos` so float error on a
 * near-identical pair (where `2·dot² − 1` can drift slightly above 1) returns
 * `0` rather than `NaN` — this is the guard `matrixDelta` previously applied
 * explicitly around the raw `quat.getAngle`.
 *
 * Precondition: both inputs are (approximately) unit length. Callers that hold
 * un-normalized quaternions must normalize first (gl-matrix `quat.normalize`).
 *
 * @returns angle in radians, in `[0, π]`. Never `NaN` for finite unit inputs.
 */
export function geodesicAngleRad(a: ReadonlyQuat, b: ReadonlyQuat): number {
  const d = quat.dot(a, b);
  const c = Math.min(1, Math.max(-1, 2 * d * d - 1));
  return Math.acos(c);
}
