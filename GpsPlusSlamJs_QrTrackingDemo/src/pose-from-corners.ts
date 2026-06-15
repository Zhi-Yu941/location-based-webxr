/**
 * Rigid pose from 4 depth-unprojected QR corners — the demo's pose source.
 *
 * Note 4 caveat: "Pose itself can come from `solveQrPose` once a size is known,
 * or directly from a rigid fit to the depth-unprojected 3D corners (cleanest —
 * needs no size up front)." This module is that cleanest path: given the 4
 * corner points already unprojected into raw-WebXR/odom space (via
 * `createDepthUnprojector`), it recovers the QR's 6-DoF pose with metric scale
 * straight from depth — no `solvePnP`, no OpenCV, no size assumption.
 *
 * Convention matches `buildObjectPoints` / the detector corner-order
 * normalization: corners are TL, TR, BR, BL; the QR-local frame is +x right,
 * +y up, +z out of the printed face.
 */

import { Vector3 as TVec3, Matrix4, Quaternion as TQuat } from "three";
import type { Pose } from "gps-plus-slam-app-framework/ar";
import type { Vector3 } from "gps-plus-slam-app-framework/core";

const EPS = 1e-9;

/**
 * Fit a rigid pose to the 4 corner world points (TL, TR, BR, BL). Returns the
 * QR center + orientation, or `null` when the corners are degenerate
 * (collinear / zero-area) so no proper orthonormal basis exists.
 */
export function poseFromWorldCorners(corners: readonly Vector3[]): Pose | null {
  if (corners.length !== 4) return null;
  const [tl, tr, br, bl] = corners.map((c) => new TVec3(c[0], c[1], c[2])) as [
    TVec3,
    TVec3,
    TVec3,
    TVec3,
  ];

  const center = new TVec3()
    .add(tl)
    .add(tr)
    .add(br)
    .add(bl)
    .multiplyScalar(0.25);

  // +x (right): mid-right edge − mid-left edge. +y (up): mid-top − mid-bottom.
  const midRight = new TVec3().addVectors(tr, br).multiplyScalar(0.5);
  const midLeft = new TVec3().addVectors(tl, bl).multiplyScalar(0.5);
  const midTop = new TVec3().addVectors(tl, tr).multiplyScalar(0.5);
  const midBottom = new TVec3().addVectors(bl, br).multiplyScalar(0.5);
  const xAxis = new TVec3().subVectors(midRight, midLeft);
  const yAxis = new TVec3().subVectors(midTop, midBottom);
  if (xAxis.length() < EPS || yAxis.length() < EPS) return null;
  xAxis.normalize();
  yAxis.normalize();

  const zAxis = new TVec3().crossVectors(xAxis, yAxis);
  if (zAxis.length() < EPS) return null; // x ∥ y → degenerate quad
  zAxis.normalize();
  // Re-orthogonalize y so the basis is exactly orthonormal (corners may be
  // slightly non-square from depth noise).
  yAxis.crossVectors(zAxis, xAxis).normalize();

  const q = new TQuat().setFromRotationMatrix(
    new Matrix4().makeBasis(xAxis, yAxis, zAxis),
  );
  return {
    position: [center.x, center.y, center.z],
    rotation: [q.x, q.y, q.z, q.w],
  };
}
