/**
 * Derive-on-read layer for QR detections (decision D-A of the recorder live-QR
 * plan, docs `2026-06-17-recorder-live-qr-detection-recording-plan.md`).
 *
 * The `qrDetected` slice persists the RAW detector output per observation —
 * pixel corners + the raw WebXR camera pose + the detector-frame projection
 * matrix + frame dimensions + timestamp — and NOT a solved pose. The metric
 * size and the solved pose are DERIVED here, on read, so swapping the size or
 * PnP algorithm and re-running a recording yields a new result (the maintainer's
 * "record raw, re-test" principle). The same functions run live and on replay —
 * they only differ in the injected `resolveDepthAt` (live: the current depth
 * sample; replay: the recorded depth stream), so live == replay by construction.
 *
 * Depth is injected as a single {@link DeriveQrPoseDeps.resolveDepthAt} function:
 * that IS the as-of join — "the depth-sampling context active at this detection's
 * timestamp". The QR observation stays pure-raw and carries NO depth; the depth
 * grid lives in its own recorded stream (`recordDepthSample`), the single source
 * of truth for ALL sizing algorithms (so a denser/sub-pixel sizing variant can
 * still be re-tested from a recording). See the plan §3 / §6.
 *
 * This module lives in `ar/` (not `state/`) and is purely structural — it never
 * imports the `qrDetected` slice, so the `ar → state` cycle stays open. The slice
 * adapts its `QrDetectionEntry` to {@link RawQrObservation} and delegates here.
 *
 * @see qr-pose.ts — `solveQrPose` / `intrinsicsFromProjection` (the PnP it composes).
 * @see qr-size-measurer.ts — `createQrSizeMeasurer` (the depth→size accumulator).
 */

import type { Matrix4 } from 'gps-plus-slam-js';
import {
  intrinsicsFromProjection,
  solveQrPose,
  type Point2,
  type Pose,
  type SolvePnpSquare,
} from './qr-pose.js';
import {
  createQrSizeMeasurer,
  type QrSizeDepthContext,
  type QrSizeMeasurerOptions,
} from './qr-size-measurer.js';

/**
 * One RAW QR observation — the authoritative recorded shape (D-A). Everything
 * the derive layer needs to recompute size + pose is here EXCEPT depth (injected
 * via `resolveDepthAt`). Structural on purpose: the slice's `QrDetectionEntry`
 * supplies these fields; this module never imports the slice.
 */
export interface RawQrObservation {
  /** Decoded payload (text/URL) — also the marker key. */
  text: string;
  /** The 4 detected corners in detector-buffer PIXELS, order TL,TR,BR,BL. */
  corners: readonly Point2[];
  /** Capturing camera pose in raw-WebXR/odom space (rides `arWorldGroup`). */
  cameraPose: Pose;
  /** Column-major GL projection of the detector frame (→ PnP intrinsics). */
  projectionMatrix: Matrix4;
  /** Detector-buffer width in pixels (to normalize corners + build intrinsics). */
  imageWidth: number;
  /** Detector-buffer height in pixels. */
  imageHeight: number;
  /** Epoch ms (or injected clock) of the detection — the depth as-of join key. */
  timestamp: number;
}

/** Injected dependencies for the derive-on-read pose. */
export interface DeriveQrPoseDeps {
  /**
   * The as-of depth join: the depth-sampling context that was active at
   * `timestamp`, or `null` when no usable depth covers it. Live wires the
   * current depth sample; replay wires a lookup over the recorded depth stream.
   */
  resolveDepthAt: (timestamp: number) => QrSizeDepthContext | null;
  /** PnP backend — the pure-JS {@link PlanarPnpSquare} in production. */
  solver: SolvePnpSquare;
  /** Size-measurer tuning, forwarded to {@link createQrSizeMeasurer}. */
  sizeOptions?: QrSizeMeasurerOptions;
  /** Reprojection-error gate forwarded to {@link solveQrPose} (default 4 px). */
  maxReprojectionErrorPx?: number;
}

/**
 * Replay a marker's observation history through a fresh size measurer (each
 * observation sized against its own as-of depth context) and return the running
 * median size in meters, or `null` if no observation could be sized yet.
 *
 * Re-runs the whole history per call — O(history), bounded by the slice ring
 * buffer. Cheap for v1; memoize if the debug-viz cadence makes it hot.
 */
export function deriveQrSizeM(
  text: string,
  observations: readonly RawQrObservation[],
  resolveDepthAt: DeriveQrPoseDeps['resolveDepthAt'],
  sizeOptions?: QrSizeMeasurerOptions
): number | null {
  if (observations.length === 0) return null;
  const measurer = createQrSizeMeasurer(sizeOptions);
  for (const o of observations) {
    const ctx = resolveDepthAt(o.timestamp);
    if (!ctx) continue;
    measurer.measure(
      text,
      o.corners,
      { width: o.imageWidth, height: o.imageHeight },
      ctx
    );
  }
  return measurer.current(text).estimateM;
}

/**
 * Solve the world pose of ONE raw observation given a known metric size. Pure
 * (no depth): intrinsics come from the observation's projection + frame size,
 * the corners + camera pose are recorded. Returns `null` when PnP rejects the
 * quad or exceeds the reprojection gate.
 */
export function solveQrPoseFromObservation(
  observation: RawQrObservation,
  sizeM: number,
  solver: SolvePnpSquare,
  maxReprojectionErrorPx?: number
): Pose | null {
  const intrinsics = intrinsicsFromProjection(
    observation.projectionMatrix,
    observation.imageWidth,
    observation.imageHeight
  );
  const solution = solveQrPose({
    imagePoints: observation.corners,
    sizeM,
    intrinsics,
    cameraPose: observation.cameraPose,
    solver,
    ...(maxReprojectionErrorPx !== undefined ? { maxReprojectionErrorPx } : {}),
  });
  return solution ? solution.qrPoseWorld : null;
}

/** A best-effort derived placement: the solved world pose AND the metric size
 * that solved it (the size the debug cube needs). */
export interface DerivedQrPlacement {
  /** Solved QR world pose (rides `arWorldGroup`). */
  pose: Pose;
  /** Running-median metric side length used to solve `pose`. */
  sizeM: number;
}

/**
 * Derive the best-effort {@link DerivedQrPlacement} for a marker: accumulate the
 * size across the whole observation history (each against its as-of depth), then
 * solve the LATEST observation with that size — returning BOTH the pose and the
 * size (the debug cube needs the size; deriving once avoids two history passes).
 * Returns `null` when there is no history, no observation can be sized, or PnP
 * rejects the latest quad — callers render nothing (best-effort viz) rather than
 * throwing.
 */
export function deriveQrPlacement(
  text: string,
  observations: readonly RawQrObservation[],
  deps: DeriveQrPoseDeps
): DerivedQrPlacement | null {
  if (observations.length === 0) return null;
  const sizeM = deriveQrSizeM(
    text,
    observations,
    deps.resolveDepthAt,
    deps.sizeOptions
  );
  if (sizeM === null) return null;
  const latest = observations[observations.length - 1] as RawQrObservation;
  const pose = solveQrPoseFromObservation(
    latest,
    sizeM,
    deps.solver,
    deps.maxReprojectionErrorPx
  );
  return pose ? { pose, sizeM } : null;
}

/**
 * Derive only the best-effort solved WORLD pose for a marker (the size is an
 * internal of {@link deriveQrPlacement}). Returns `null` under the same
 * conditions. Kept for callers that need the pose alone.
 */
export function deriveSolvedQrPose(
  text: string,
  observations: readonly RawQrObservation[],
  deps: DeriveQrPoseDeps
): Pose | null {
  return deriveQrPlacement(text, observations, deps)?.pose ?? null;
}
