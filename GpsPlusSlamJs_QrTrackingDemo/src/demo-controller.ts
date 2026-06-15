/**
 * QR-tracking demo controller — the orchestration brain (Note 4).
 *
 * Per throttled/coalesced frame it: detects a QR (front-end), samples the depth
 * map at the corners + an interior point, unprojects them to 3D, fits a rigid
 * pose ({@link poseFromWorldCorners}, no solvePnP / no size needed), measures
 * the size ({@link estimateQrSizeFromDepth} → a per-marker running median), and
 * — once the N-consecutive-lock fires — records the detection + size into the
 * `qrDetected` store and glues the debug axis + cube to the pose.
 *
 * Every device-specific dependency (detect, depth context, store dispatch,
 * scene update) is injected, so this whole flow is unit-testable without WebXR,
 * a camera, or depth hardware. It is geo-less: no GPS vote is ever cast.
 */

import {
  createDetectionScheduler,
  createQrSizeAccumulator,
  estimateQrSizeFromDepth,
  composePose,
  invertPose,
  type DetectionScheduler,
  type RgbaImage,
  type QrDetection,
  type Point2,
  type Pose,
  type DepthUnprojector,
  type QrSizeEstimate,
  type QrSizeAccumulator,
  type QrDetectionEvent,
} from "gps-plus-slam-app-framework/ar";
import type { DepthPoint } from "gps-plus-slam-app-framework/types";
import type { Vector3 } from "gps-plus-slam-app-framework/core";
import { poseFromWorldCorners } from "./pose-from-corners.js";
import type { DemoStatus } from "./hud-view.js";

/** Everything device-specific the controller needs to read one frame's depth. */
export interface DepthContext {
  /** Unprojector for the current depth sample (`createDepthUnprojector`). */
  unprojector: DepthUnprojector;
  /** Depth (m) at a normalized screen point, or `null` if unavailable there. */
  depthAt: (screenX: number, screenY: number) => number | null;
  /** Camera pose in raw-WebXR/odom space (for the camera-relative pose). */
  cameraPose: Pose;
}

export interface QrDemoControllerDeps {
  /** Detect + decode (BarcodeDetector front-end fed by `captureToPixels`). */
  detect: (image: RgbaImage) => Promise<QrDetection | null>;
  /** The current frame's depth context, or `null` when depth is unavailable. */
  getDepthContext: () => DepthContext | null;
  /** Dispatch `recordQrDetection` (Note 3 slice). */
  recordDetection: (event: QrDetectionEvent) => void;
  /** Dispatch `recordQrSizeEstimate` (Note 3 size lifecycle). */
  recordSize: (text: string, estimate: QrSizeEstimate) => void;
  /** Glue the debug axis + cube to the pose at the measured size (or `null`). */
  updateScene: (pose: Pose, sizeM: number | null) => void;
  /** Status-change notifications for the HUD. */
  onStatus?: (status: DemoStatus) => void;
  /** Injectable clock (ms) for the detection timestamp + scheduler. */
  now?: () => number;
  /** Scheduler tuning. */
  minIntervalMs?: number;
  requiredLockCount?: number;
}

export interface QrDemoController {
  /** Offer the latest camera frame; throttled/coalesced internally. */
  offerFrame(image: RgbaImage): void;
  readonly status: DemoStatus;
  /** Clear the measured-size accumulators and return to idle. */
  reset(): void;
}

interface DemoLockResult {
  event: QrDetectionEvent;
  pose: Pose;
  estimate: QrSizeEstimate;
}

/** Pixel corner → normalized screen point for the given frame. */
function toScreen(corner: Point2, image: RgbaImage): { x: number; y: number } {
  return { x: corner.x / image.width, y: corner.y / image.height };
}

export function createQrDemoController(
  deps: QrDemoControllerDeps,
): QrDemoController {
  const {
    detect,
    getDepthContext,
    recordDetection,
    recordSize,
    updateScene,
    onStatus,
    now,
    minIntervalMs = 0,
    requiredLockCount = 2,
  } = deps;

  const timestampNow = now ?? (() => Date.now());
  const accumulators = new Map<string, QrSizeAccumulator>();
  let status: DemoStatus = "idle";

  function setStatus(next: DemoStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  function accumulatorFor(text: string): QrSizeAccumulator {
    let acc = accumulators.get(text);
    if (!acc) {
      acc = createQrSizeAccumulator();
      accumulators.set(text, acc);
    }
    return acc;
  }

  /** Build corner depth samples; `null` if any corner lacks a depth read. */
  function cornerDepthPoints(
    corners: readonly Point2[],
    image: RgbaImage,
    depthAt: DepthContext["depthAt"],
  ): DepthPoint[] | null {
    if (corners.length !== 4) return null;
    const out: DepthPoint[] = [];
    for (const corner of corners) {
      const s = toScreen(corner, image);
      const depthM = depthAt(s.x, s.y);
      if (depthM === null) return null;
      out.push({ screenX: s.x, screenY: s.y, depthM });
    }
    return out;
  }

  /** The QR centroid as a single interior depth sample (may be empty). */
  function interiorDepthPoints(
    corners: readonly Point2[],
    image: RgbaImage,
    depthAt: DepthContext["depthAt"],
  ): DepthPoint[] {
    const cx = corners.reduce((s, c) => s + c.x, 0) / corners.length;
    const cy = corners.reduce((s, c) => s + c.y, 0) / corners.length;
    const s = toScreen({ x: cx, y: cy }, image);
    const depthM = depthAt(s.x, s.y);
    return depthM === null ? [] : [{ screenX: s.x, screenY: s.y, depthM }];
  }

  async function runDetect(image: RgbaImage): Promise<DemoLockResult | null> {
    if (status === "idle") setStatus("scanning");

    const detection = await detect(image);
    if (!detection) return null;

    const ctx = getDepthContext();
    if (!ctx) return null; // no depth → cannot size/place (auto-size gate)

    const corners = cornerDepthPoints(detection.corners, image, ctx.depthAt);
    if (!corners) return null;

    const world: Vector3[] = [];
    for (const dp of corners) {
      const p = ctx.unprojector.unproject(dp);
      if (!p) return null;
      world.push(p);
    }
    const pose = poseFromWorldCorners(world);
    if (!pose) return null;

    const interior = interiorDepthPoints(detection.corners, image, ctx.depthAt);
    const observation = estimateQrSizeFromDepth(
      corners as [DepthPoint, DepthPoint, DepthPoint, DepthPoint],
      interior,
      ctx.unprojector,
    );
    const estimate = accumulatorFor(detection.text).add(observation);

    const event: QrDetectionEvent = {
      text: detection.text,
      qrPoseWorld: pose,
      // Depth-fit gives a world pose; derive the camera-relative pose for the
      // slice entry. (Depth-fit has no PnP reprojection metric → 0.)
      qrPoseInCamera: composePose(invertPose(ctx.cameraPose), pose),
      reprojectionErrorPx: 0,
      timestamp: timestampNow(),
    };
    return { event, pose, estimate };
  }

  const scheduler: DetectionScheduler =
    createDetectionScheduler<DemoLockResult>({
      detect: runDetect,
      minIntervalMs,
      requiredLockCount,
      ...(now ? { now } : {}),
      onLocked: (result) => {
        recordDetection(result.event);
        recordSize(result.event.text, result.estimate);
        updateScene(result.pose, result.estimate.estimateM);
        setStatus("tracking");
      },
      // Note 3 persistence: on a miss we do NOT clear the scene — the axis + cube
      // keep their last pose so they don't flicker between throttled detections.
      onMiss: () => {
        if (status === "tracking") setStatus("scanning");
      },
    });

  return {
    offerFrame(image: RgbaImage): void {
      scheduler.offerFrame(image);
    },
    get status() {
      return status;
    },
    reset(): void {
      accumulators.clear();
      setStatus("idle");
    },
  };
}
