/**
 * QR-tracking demo controller — the orchestration brain (Note 4).
 *
 * Per throttled/coalesced frame it: detects a QR (front-end), measures the size
 * from depth via the shared framework {@link createQrSizeMeasurer} (samples the
 * corners + an interior point, accumulates a per-marker running median), fits a
 * rigid pose ({@link poseFromWorldCorners}, no solvePnP / no size needed) from
 * the same sampled corners, and — once the N-consecutive-lock fires — records
 * the detection + size into the `qrDetected` store and glues the debug axis +
 * cube to the pose.
 *
 * Every device-specific dependency (detect, depth context, store dispatch,
 * scene update) is injected, so this whole flow is unit-testable without WebXR,
 * a camera, or depth hardware. It is geo-less: no GPS vote is ever cast.
 */

import {
  createDetectionScheduler,
  createQrSizeMeasurer,
  composePose,
  invertPose,
  validateQuad,
  type DetectionScheduler,
  type RgbaImage,
  type QrDetection,
  type Pose,
  type DepthUnprojector,
  type QrSizeEstimate,
  type QrSizeMeasurer,
  type QrDetectionEvent,
} from "gps-plus-slam-app-framework/ar";
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
  /**
   * Resolve the STABLE (sliding-window filtered) world pose for the OVERLAY —
   * e.g. `selectStableQrPose(store.getState(), text)`. When wired, the rendered
   * axis/cube use the filtered pose so they stop swinging between throttled
   * detections; a `null` (not yet converged) falls back to this frame's raw pose
   * so the overlay still appears while the window fills. `recordDetection` runs
   * first, so the window this reads already includes the current frame.
   */
  resolveStablePose?: (text: string) => Pose | null;
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

export function createQrDemoController(
  deps: QrDemoControllerDeps,
): QrDemoController {
  const {
    detect,
    getDepthContext,
    recordDetection,
    recordSize,
    updateScene,
    resolveStablePose,
    onStatus,
    now,
    minIntervalMs = 0,
    requiredLockCount = 2,
  } = deps;

  const timestampNow = now ?? (() => Date.now());
  // The shared framework piece: per-marker depth→size accumulation (Part B,
  // Option 2). Both this demo and the Recorder wire the same measurer.
  const measurer: QrSizeMeasurer = createQrSizeMeasurer();
  let status: DemoStatus = "idle";

  function setStatus(next: DemoStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  async function runDetect(image: RgbaImage): Promise<DemoLockResult | null> {
    if (status === "idle") setStatus("scanning");

    const detection = await detect(image);
    if (!detection) return null;

    // Guard the same failure modes the framework's `solveQrPose` rejects:
    // a mirrored winding or a degenerate (tiny / collinear) quad. This keeps
    // the demo's rigid-fit path consistent with the PnP path and prevents an
    // inside-out basis from a bad read. (It does NOT reorder corners — the
    // detector's order carries the QR's reading orientation; see the
    // on-device follow-up §2.3.)
    if (!validateQuad(detection.corners).ok) return null;

    const ctx = getDepthContext();
    if (!ctx) return null; // no depth → cannot size/place (auto-size gate)

    // Measure size + sample corner depth in one shared step; `null` means a
    // corner lacked a depth read (cannot size/place this frame).
    const measurement = measurer.measure(
      detection.text,
      detection.corners,
      image,
      ctx,
    );
    if (!measurement) return null;

    // Depth-fit pose from the SAME sampled corners (no re-sampling).
    const world: Vector3[] = [];
    for (const dp of measurement.cornerSamples) {
      const p = ctx.unprojector.unproject(dp);
      if (!p) return null;
      world.push(p);
    }
    const pose = poseFromWorldCorners(world);
    if (!pose) return null;

    const estimate = measurement.estimate;

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
        // Render the windowed stable pose when available (smooth overlay); fall
        // back to the raw frame pose while the window is still converging.
        const renderPose =
          resolveStablePose?.(result.event.text) ?? result.pose;
        updateScene(renderPose, result.estimate.estimateM);
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
      measurer.reset();
      setStatus("idle");
    },
  };
}
