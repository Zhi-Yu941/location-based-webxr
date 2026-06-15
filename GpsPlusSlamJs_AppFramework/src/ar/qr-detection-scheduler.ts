/**
 * QR detection scheduler — Phase 2 of the QR-code detection & tracking plan
 * (§9 runtime + research2 stability). A small state machine that turns the
 * per-render-frame `offerFrame` firehose into a THROTTLED, COALESCED detection
 * cadence and applies the N-consecutive-lock gate:
 *
 * - **Throttle:** start a detection at most once per `minIntervalMs`
 *   (target 5–10 Hz), never per frame.
 * - **Coalesce:** never start a second detection while one is in flight (the
 *   heavy WASM solve runs off the render thread; skipping is cheaper than
 *   queueing stale frames).
 * - **N-consecutive-lock:** only report a "lock" after `requiredLockCount`
 *   consecutive successful detections; a single miss resets the counter. This
 *   hides the lower cadence and rejects one-off bad detections.
 *
 * The actual detect→solve work is injected as one async `detect`, so this is a
 * pure, device-free, clock-injectable unit. It is transport-agnostic: the same
 * scheduler drives a worker-hosted pipeline or a main-thread one.
 */

import type { QrPoseSolution } from './qr-pose.js';
import type { RgbaImage } from './qr-frontend.js';

export interface QrDetectionSchedulerConfig {
  /** The full detect→solve step; resolves to a solution or `null` (no QR / rejected). */
  detect: (image: RgbaImage) => Promise<QrPoseSolution | null>;
  /** Minimum ms between detection STARTS (throttle). 100 ms ≈ 10 Hz. */
  minIntervalMs: number;
  /** Consecutive successes required before a lock is reported. Default 3. */
  requiredLockCount?: number;
  /** Injectable clock (ms). Defaults to `performance.now()`/`Date.now()`. */
  now?: () => number;
  /** Called on each success once locked (consecutiveLocks ≥ requiredLockCount). */
  onLocked?: (solution: QrPoseSolution) => void;
  /** Called when a detection completes with no usable QR. */
  onMiss?: () => void;
  /** Called when `detect` rejects (the counter is reset). */
  onError?: (err: unknown) => void;
}

export interface QrDetectionScheduler {
  /** Offer the latest camera frame; may or may not start a detection. */
  offerFrame(image: RgbaImage): void;
  /** True while a detection is awaiting `detect`. */
  readonly inFlight: boolean;
  /** Current consecutive-success count (capped at requiredLockCount). */
  readonly consecutiveLocks: number;
  /** True once `consecutiveLocks` has reached `requiredLockCount`. */
  readonly locked: boolean;
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export function createQrDetectionScheduler(
  config: QrDetectionSchedulerConfig
): QrDetectionScheduler {
  const {
    detect,
    minIntervalMs,
    requiredLockCount = 3,
    now = defaultNow,
    onLocked,
    onMiss,
    onError,
  } = config;

  let inFlight = false;
  let consecutiveLocks = 0;
  // -Infinity so the first offered frame always passes the throttle.
  let lastStart = -Infinity;

  const scheduler: QrDetectionScheduler = {
    get inFlight() {
      return inFlight;
    },
    get consecutiveLocks() {
      return consecutiveLocks;
    },
    get locked() {
      return consecutiveLocks >= requiredLockCount;
    },
    offerFrame(image: RgbaImage): void {
      if (inFlight) return; // coalesce
      const t = now();
      if (t - lastStart < minIntervalMs) return; // throttle
      lastStart = t;
      inFlight = true;

      detect(image)
        .then((solution) => {
          if (solution) {
            consecutiveLocks = Math.min(
              consecutiveLocks + 1,
              requiredLockCount
            );
            if (consecutiveLocks >= requiredLockCount) onLocked?.(solution);
          } else {
            consecutiveLocks = 0;
            onMiss?.();
          }
        })
        .catch((err: unknown) => {
          consecutiveLocks = 0;
          onError?.(err);
        })
        .finally(() => {
          inFlight = false;
        });
    },
  };

  return scheduler;
}
