/**
 * COLMAP Coordinate + Intrinsics Conversions
 *
 * Pure math turning the recorder's persisted WebXR data into the conventions
 * COLMAP's `sparse/0/` text files expect (occupancy/COLMAP export plan Iter 1,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-colmap-export-plan.md §2.3).
 * No THREE scene graph, no DOM, no Redux — mirrors the discipline of
 * `depth-unprojection.ts` / `frame-conversions.ts` (one tested seam owning the
 * axis/sign conventions).
 *
 * Two independent conversions:
 *  - {@link webxrToColmapPose}: a WebXR camera pose (−Z forward, +Y up,
 *    camera-to-world) → COLMAP `(qvec, tvec)` (+Z forward, +Y down,
 *    world-to-camera).
 *  - {@link pinholeFromProjection}: a WebXR/ARCore column-major projection
 *    matrix + image pixel size → PINHOLE intrinsics `(fx, fy, cx, cy)`.
 *
 * @see colmap-conversions.ts.md for the derivations and the on-device
 *   verification caveat on the principal point.
 */

import * as THREE from 'three';
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from 'gps-plus-slam-app-framework/core';

/**
 * World-to-camera quaternion in COLMAP's storage order `[qw, qx, qy, qz]`
 * (note: COLMAP lists the scalar component FIRST, unlike the library's
 * `Quaternion` which is `[x, y, z, w]`).
 */
type ColmapQuat = readonly [number, number, number, number];

/**
 * A COLMAP `images.txt` extrinsic: rotation + translation that map a world
 * point into the camera frame, `X_cam = R(qvec) · X_world + tvec`.
 */
export interface ColmapPose {
  readonly qvec: ColmapQuat;
  readonly tvec: Vector3;
}

/** PINHOLE intrinsics in pixels (COLMAP camera model `PINHOLE`). */
export interface PinholeIntrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * Basis change from the WebXR camera frame (+x right, +y up, −z forward) to
 * the COLMAP camera frame (+x right, +y down, +z forward): negate Y and Z.
 * This is a 180° rotation about the camera X axis (det = +1, a proper
 * rotation — so `decompose` below never folds a sign into the quaternion).
 * Module-constant: it never changes and the conversion treats it read-only.
 */
const WEBXR_TO_COLMAP_CAM = new THREE.Matrix4().makeScale(1, -1, -1);

/**
 * Basis change from the raw-WebXR **world** frame (+Y up, right-handed) to the
 * COLMAP/3DGS-viewer world convention (+Y-down gravity): negate Y and Z. Like
 * {@link WEBXR_TO_COLMAP_CAM} this is a 180° rotation about X (det = +1, a
 * *proper* rotation), so the reconstruction loads **upright** without mirroring.
 *
 * Without it the export is internally consistent but loads upside-down in
 * Lichtfeld Studio / gsplat / Nerfstudio, which treat the COLMAP world as
 * Y-down gravity while our world is WebXR Y-up. The SAME `G` is applied to the
 * camera extrinsics here and to exported points via {@link webxrToColmapWorldPoint},
 * so cameras and points stay registered (a surface point still projects to the
 * pixel its camera saw). See follow-up Item B:
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-colmap-export-followup-plan.md.
 */
const WEBXR_TO_COLMAP_WORLD = new THREE.Matrix4().makeScale(1, -1, -1);

/**
 * Convert a WebXR camera pose to a COLMAP extrinsic.
 *
 * WebXR hands back a *camera-to-world* pose in a frame whose camera looks down
 * −Z with +Y up. COLMAP stores a *world-to-camera* extrinsic in a frame whose
 * camera looks down +Z with +Y down. The conversion therefore (1) applies the
 * camera-frame basis change {@link WEBXR_TO_COLMAP_CAM} on the right of the
 * camera-to-world matrix, (2) inverts to world-to-camera, then (3) post-
 * multiplies by the world basis change {@link WEBXR_TO_COLMAP_WORLD} so the
 * extrinsic maps the *flipped* COLMAP world (Y-down gravity) into the camera —
 * `worldToCam · G` leaves `tvec` unchanged and only rotates `R`.
 *
 * @param position - camera position, raw WebXR (e.g. `ArImageCapture.position`
 *   after the NUE→WebXR conversion that `selectFrameTilesInWebXR` applies).
 * @param rotation - camera quaternion `[x, y, z, w]`, raw WebXR.
 * @returns `{ qvec: [qw, qx, qy, qz], tvec: [tx, ty, tz] }`.
 */
export function webxrToColmapPose(
  position: Vector3,
  rotation: Quaternion
): ColmapPose {
  const quat = new THREE.Quaternion(
    rotation[0],
    rotation[1],
    rotation[2],
    rotation[3]
  );
  const pos = new THREE.Vector3(position[0], position[1], position[2]);

  // camera-to-world (WebXR) → COLMAP-camera-to-world → world-to-camera, then
  // re-express in the flipped COLMAP world frame (post-multiply by G).
  const worldToCam = new THREE.Matrix4()
    .compose(pos, quat, UNIT_SCALE)
    .multiply(WEBXR_TO_COLMAP_CAM)
    .invert()
    .multiply(WEBXR_TO_COLMAP_WORLD);

  const outQuat = new THREE.Quaternion();
  const outPos = new THREE.Vector3();
  worldToCam.decompose(outPos, outQuat, new THREE.Vector3());

  return {
    qvec: [outQuat.w, outQuat.x, outQuat.y, outQuat.z],
    tvec: [outPos.x, outPos.y, outPos.z],
  };
}

/**
 * Map a raw-WebXR world point into the COLMAP world frame: negate Y and Z (the
 * 180°-about-X {@link WEBXR_TO_COLMAP_WORLD} basis change). This is the SAME `G`
 * that {@link webxrToColmapPose} folds into the camera extrinsics, applied to
 * the exported `points3D` so the seed cloud and the cameras stay registered and
 * the reconstruction loads upright. Pure component negation — no matrix needed.
 */
export function webxrToColmapWorldPoint(point: Vector3): Vector3 {
  return [point[0], -point[1], -point[2]];
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

/**
 * Recover PINHOLE intrinsics from a column-major WebXR/ARCore projection
 * matrix and the image's pixel dimensions.
 *
 * Derivation (see sidecar): for an OpenGL-style perspective matrix `m` stored
 * column-major (`m[col*4 + row]`), projecting a view-space point and mapping
 * NDC → pixels (top-left origin, y down) gives:
 *  - `fx = 0.5 · W · m[0]`   (m00)
 *  - `fy = 0.5 · H · m[5]`   (m11)
 *  - `cx = 0.5 · W · (1 − m[8])`   (m20, the x skew/offset term)
 *  - `cy = 0.5 · H · (1 + m[9])`   (m21, the y skew/offset term)
 *
 * For a centered, symmetric frustum (`m[8] = m[9] = 0`) this yields the
 * expected `cx = W/2`, `cy = H/2`. The off-center principal-point terms are
 * derived, not eyeballed, but their sign convention against real ARCore
 * matrices is only decisively confirmed by the Iter 4 on-device check.
 *
 * **W, H are the JPEG frame's pixel dimensions** (after any
 * `resolutionDivisor`), not the depth buffer's — the matrix is resolution
 * independent (it encodes the frustum in normalized coords).
 *
 * @throws RangeError if the matrix is not 16 finite numbers or W/H are not
 *   positive finite numbers, or if the recovered focal lengths are not finite
 *   (a degenerate/non-perspective matrix).
 */
export function pinholeFromProjection(
  projectionMatrix: Matrix4,
  width: number,
  height: number
): PinholeIntrinsics {
  if (
    projectionMatrix.length !== 16 ||
    !projectionMatrix.every(Number.isFinite)
  ) {
    throw new RangeError('projectionMatrix must be 16 finite numbers');
  }
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) {
    throw new RangeError(
      `width and height must be positive finite numbers, got ${width}×${height}`
    );
  }

  const m00 = projectionMatrix[0];
  const m11 = projectionMatrix[5];
  const m20 = projectionMatrix[8];
  const m21 = projectionMatrix[9];

  const fx = 0.5 * width * m00;
  const fy = 0.5 * height * m11;
  const cx = 0.5 * width * (1 - m20);
  const cy = 0.5 * height * (1 + m21);

  if (!(fx > 0) || !(fy > 0)) {
    throw new RangeError(
      `recovered non-positive focal length (fx=${fx}, fy=${fy}); ` +
        'matrix is not a forward-facing perspective projection'
    );
  }

  return { fx, fy, cx, cy };
}

function isPositiveFinite(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}
