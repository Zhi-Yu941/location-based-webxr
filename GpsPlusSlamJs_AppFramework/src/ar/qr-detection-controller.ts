/**
 * QR detection controller — the THIN, geo-less RAW producer (decision D-X of the
 * recorder live-QR plan, realized as "thin producer + shared derive-on-read
 * consumer").
 *
 * Under the RAW model (decision D-A) the record path collapses to
 * `detect → validateQuad → emit RAW observation`. There is NO size measure and
 * NO PnP solve here — those moved to the derive-on-read layer
 * (`qr-derived-pose.ts`), so they no longer gate the record and the same raw
 * recording can be re-tested under a different size/PnP algorithm later.
 *
 * Everything device-specific (detect, the camera-pose + projection accessors,
 * the record sink, the clock) is injected, so the whole flow is unit-testable
 * without WebXR, a camera, or depth. It is geo-less: it casts no GPS vote and
 * never imports the `qrDetected` slice (the record sink is injected) — the
 * `ar → state` cycle stays open. Both the Recorder and (eventually) the QR demo
 * wire this one tested producer.
 *
 * @see qr-derived-pose.ts — the shared derive-on-read consumer (size + pose).
 * @see detection-scheduler.ts — the throttle / N-consecutive-lock cadence owner.
 * @see qr-tracking-controller.ts — the SEPARATE level-based geo/vote brain (untouched).
 */

import type { Matrix4 } from 'gps-plus-slam-js';
import {
  createDetectionScheduler,
  type DetectionScheduler,
} from './detection-scheduler.js';
import type { QrDetection, RgbaImage } from './qr-frontend.js';
import { validateQuad, type Pose } from './qr-pose.js';
import type { RawQrObservation } from './qr-derived-pose.js';

/** Minimal scan-status machine (NO QR detail — per the recorder scope). */
export type QrScanStatus = 'idle' | 'scanning' | 'tracking';

/** Sink for one recorded RAW observation — e.g. dispatch `recordQrDetection`. */
export type RawObservationSink = (observation: RawQrObservation) => void;

export interface QrDetectionControllerDeps {
  /** Detect + decode one frame (BarcodeDetector front-end fed by the capture). */
  detect: (image: RgbaImage) => Promise<QrDetection | null>;
  /**
   * Capturing camera pose in raw-WebXR/odom space, read when a detection
   * resolves (mirrors the demo's post-detect depth read). `null` → skip record.
   */
  getCameraPose: () => Pose | null;
  /**
   * Column-major GL projection matrix of the detector-frame buffer the corners
   * are in (→ PnP intrinsics on read). `null` → skip record.
   */
  getProjectionMatrix: () => Matrix4 | null;
  /** Record one RAW observation — e.g. `(o) => store.dispatch(recordQrDetection(o))`. */
  recordDetection: RawObservationSink;
  /** Injectable clock (ms) for the detection timestamp + scheduler. */
  now?: () => number;
  /** Throttle: start a detection at most once per this many ms. Default 0. */
  minIntervalMs?: number;
  /** Consecutive successes before a lock is recorded. Default 2. */
  requiredLockCount?: number;
  /** Status-change notifications (idle → scanning → tracking). */
  onStatus?: (status: QrScanStatus) => void;
}

export interface QrDetectionController {
  /** Offer the latest camera frame; throttled/coalesced internally. */
  offerFrame(image: RgbaImage): void;
  readonly status: QrScanStatus;
  /** Return to idle (e.g. on session end). */
  reset(): void;
}

/**
 * Create the thin RAW producer. On each accepted decode it emits a
 * {@link RawQrObservation} via `recordDetection`; it does not size or solve.
 */
export function createQrDetectionController(
  deps: QrDetectionControllerDeps
): QrDetectionController {
  const {
    detect,
    getCameraPose,
    getProjectionMatrix,
    recordDetection,
    now,
    minIntervalMs = 0,
    requiredLockCount = 2,
    onStatus,
  } = deps;

  const timestampNow = now ?? (() => Date.now());
  let status: QrScanStatus = 'idle';

  function setStatus(next: QrScanStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  async function runDetect(image: RgbaImage): Promise<RawQrObservation | null> {
    if (status === 'idle') setStatus('scanning');

    const detection = await detect(image);
    if (!detection) return null;
    // Guard the same failure modes solveQrPose rejects: a mirrored winding or a
    // degenerate (tiny / collinear) quad — keep a bad read out of the recording.
    if (!validateQuad(detection.corners).ok) return null;

    // Snapshot pose + projection at detection-resolve time (mirrors the demo's
    // post-detect depth read). Without both we cannot derive a pose later.
    const cameraPose = getCameraPose();
    const projectionMatrix = getProjectionMatrix();
    if (!cameraPose || !projectionMatrix) return null;

    return {
      text: detection.text,
      corners: detection.corners,
      cameraPose,
      projectionMatrix,
      imageWidth: image.width,
      imageHeight: image.height,
      timestamp: timestampNow(),
    };
  }

  const scheduler: DetectionScheduler =
    createDetectionScheduler<RawQrObservation>({
      detect: runDetect,
      minIntervalMs,
      requiredLockCount,
      ...(now ? { now } : {}),
      onLocked: (observation) => {
        recordDetection(observation);
        setStatus('tracking');
      },
      onMiss: () => {
        if (status === 'tracking') setStatus('scanning');
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
      setStatus('idle');
    },
  };
}
