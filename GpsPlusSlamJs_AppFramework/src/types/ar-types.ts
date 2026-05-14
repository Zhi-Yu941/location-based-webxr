/**
 * Shared AR Types
 *
 * Common type definitions for AR-related modules.
 * These are extracted to a separate file to avoid circular dependencies
 * between webxr-session.ts and depth-sampler.ts.
 */

import type { Vector3, Quaternion } from 'gps-plus-slam-js';

/**
 * Tuple-form AR pose for storage/serialization.
 *
 * The tuple equivalent of ARPose — uses the library's readonly Vector3/Quaternion
 * tuples instead of object-form { x, y, z }. Used in storage interfaces where
 * poses are persisted as plain number arrays in JSON.
 *
 * @see ARPose for the object-form variant used in live AR tracking
 * @see 2026-03-03-code-review-inline-type-duplication.md Finding #6
 */
export interface ArPoseTuples {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/**
 * 3D position in object-form as returned by the WebXR API (XRViewerPose).
 * Distinct from the library's tuple-form `Vector3` (`readonly [number, number, number]`).
 */
export interface WebXRVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Quaternion orientation in object-form as returned by the WebXR API (XRViewerPose).
 * Distinct from the library's tuple-form `Quaternion` (`readonly [number, number, number, number]`).
 */
export interface WebXRQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * Device pose in AR space.
 * Position and orientation are in the local-floor reference space.
 * This is the RAW pose, NOT transformed by any alignment matrix.
 */
export interface ARPose {
  readonly position: WebXRVec3;
  readonly orientation: WebXRQuaternion;
}

/**
 * A single depth point sample from WebXR Depth API.
 * Used for 3D reconstruction and validating AR tracking accuracy.
 */
export interface DepthPoint {
  /** Normalized screen X coordinate (0-1) */
  readonly screenX: number;
  /** Normalized screen Y coordinate (0-1) */
  readonly screenY: number;
  /** Depth value in meters */
  readonly depthM: number;
}

/**
 * A complete depth sample with camera pose and grid of depth points.
 * Produced by the depth sampler at ~1 Hz, consumed by the store for
 * persistence and replay. This is the single canonical type, re-exported
 * by `store.ts` for dispatch convenience.
 */
export interface DepthSample {
  /** Timestamp in milliseconds */
  readonly timestamp: number;
  /**
   * Camera position in **raw WebXR** convention [x=East, y=Up, z=South].
   * NOT in NUE — the recordDepthSample reducer is a no-op, so no
   * webxrToNUE conversion is applied. Consumers must convert if needed.
   */
  readonly cameraPos: Vector3;
  /**
   * Camera rotation quaternion in **raw WebXR** convention [x, y, z, w].
   * NOT in NUE — same reasoning as cameraPos.
   */
  readonly cameraRot: Quaternion;
  /** Grid of depth points */
  readonly points: DepthPoint[];
}
