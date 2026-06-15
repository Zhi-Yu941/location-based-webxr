/**
 * QR tracking controller — Phase 6 of the QR-code detection & tracking plan.
 *
 * The orchestration "brain" of the demonstrator, reusable across apps: it wires
 * a {@link QrFrontEnd} → level-file fetch (§8) → pose solve (§1/§5) → the
 * synthetic GPS-vote bridge (§6), driven at a throttled, coalesced cadence by
 * {@link createQrDetectionScheduler}, and exposes a small async-status state
 * machine so the UI can satisfy the "feedback for async actions" rule:
 *
 *   idle → scanning → loading-level → tracking, with `error` on any failure.
 *
 * Every heavy/external step (detect, level fetch, pose solve, vote dispatch,
 * camera pose / intrinsics access) is injected, so the controller is pure logic
 * and fully unit-testable without WASM, a device, or a real store.
 */

import type { RecordGpsEventPayload } from 'gps-plus-slam-js';
import type {
  CameraIntrinsics,
  Point2,
  Pose,
  QrPoseSolution,
} from './qr-pose.js';
import type { QrFrontEnd, RgbaImage } from './qr-frontend.js';
import type { QrLevel } from './qr-level.js';
import { buildQrGpsVotes } from './qr-gps-vote.js';
import {
  createQrDetectionScheduler,
  type QrDetectionScheduler,
} from './qr-detection-scheduler.js';

export type QrTrackingStatus =
  | 'idle'
  | 'scanning'
  | 'loading-level'
  | 'tracking'
  | 'error';

/** Inputs to the injected pose solve (so the controller doesn't import OpenCV). */
export interface QrSolvePoseInput {
  imagePoints: readonly Point2[];
  sizeM: number;
  intrinsics: CameraIntrinsics;
  cameraPose: Pose;
}

export interface QrTrackingControllerConfig {
  /** Detect + decode (BarcodeDetector / OpenCV front-end). */
  frontEnd: QrFrontEnd;
  /** Solve the QR world pose from corners (production: wraps `solveQrPose`). */
  solvePose: (input: QrSolvePoseInput) => QrPoseSolution | null;
  /** Fetch + validate a level file from the decoded URL (cached by the controller). */
  fetchLevel: (url: string) => Promise<QrLevel>;
  /** Dispatch the synthetic GPS votes (production: `recordGpsEvent` per payload). */
  dispatchVotes: (votes: RecordGpsEventPayload[]) => void;
  /** Current camera pose in raw-WebXR/odom space, or `null` if unavailable. */
  getCameraPose: () => Pose | null;
  /** Intrinsics for the exact frame buffer, or `null` if unavailable. */
  getIntrinsics: (image: RgbaImage) => CameraIntrinsics | null;
  /** Synthetic GPS accuracy (m) → vote weight. */
  syntheticAccuracyM: number;
  /** Optional plausibility gate (e.g. occupancy self-check); `false` rejects. */
  isPlausible?: (solution: QrPoseSolution, cameraPose: Pose) => boolean;
  /** Status-change notifications for the UI. */
  onStatus?: (status: QrTrackingStatus) => void;
  /** Called each time a locked detection dispatches votes. */
  onLocked?: (solution: QrPoseSolution, level: QrLevel) => void;
  /** Surfaced failures (level fetch, detect throw). */
  onError?: (err: unknown) => void;
  /** Scheduler tuning (see `qr-detection-scheduler.ts`). */
  minIntervalMs?: number;
  requiredLockCount?: number;
  now?: () => number;
}

export interface QrTrackingController {
  /** Offer the latest camera frame; throttled/coalesced internally. */
  offerFrame(image: RgbaImage): void;
  /** Current status. */
  readonly status: QrTrackingStatus;
  /** Stop tracking and reset to `idle` (clears the level cache). */
  reset(): void;
}

export function createQrTrackingController(
  config: QrTrackingControllerConfig
): QrTrackingController {
  const {
    frontEnd,
    solvePose,
    fetchLevel,
    dispatchVotes,
    getCameraPose,
    getIntrinsics,
    syntheticAccuracyM,
    isPlausible,
    onStatus,
    onLocked,
    onError,
    minIntervalMs = 150,
    requiredLockCount = 3,
    now,
  } = config;

  let status: QrTrackingStatus = 'idle';
  const levelCache = new Map<string, QrLevel>();
  // The level + solution from the in-flight detection, read by onLocked.
  let activeLevel: QrLevel | null = null;

  function setStatus(next: QrTrackingStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  async function ensureLevel(url: string): Promise<QrLevel> {
    const cached = levelCache.get(url);
    if (cached) return cached;
    setStatus('loading-level');
    const level = await fetchLevel(url);
    levelCache.set(url, level);
    return level;
  }

  async function detect(image: RgbaImage): Promise<QrPoseSolution | null> {
    if (status === 'idle' || status === 'error') setStatus('scanning');

    const detection = await frontEnd.detect(image);
    if (!detection) {
      activeLevel = null;
      return null;
    }

    const level = await ensureLevel(detection.text);
    const cameraPose = getCameraPose();
    const intrinsics = getIntrinsics(image);
    if (!cameraPose || !intrinsics) {
      activeLevel = null;
      return null;
    }

    const solution = solvePose({
      imagePoints: detection.corners,
      sizeM: level.qr.physicalSizeM,
      intrinsics,
      cameraPose,
    });
    if (!solution) {
      activeLevel = null;
      return null;
    }
    if (isPlausible && !isPlausible(solution, cameraPose)) {
      activeLevel = null;
      return null;
    }

    activeLevel = level;
    return solution;
  }

  const scheduler: QrDetectionScheduler = createQrDetectionScheduler({
    detect,
    minIntervalMs,
    requiredLockCount,
    now,
    onLocked: (solution) => {
      const level = activeLevel;
      if (!level) return;
      const votes = buildQrGpsVotes({
        qrPoseWorld: solution.qrPoseWorld,
        sizeM: level.qr.physicalSizeM,
        qrGeo: level.qr.geo,
        syntheticAccuracyM,
      });
      dispatchVotes(votes);
      setStatus('tracking');
      onLocked?.(solution, level);
    },
    onMiss: () => {
      // Back to scanning unless an error is showing.
      if (status === 'tracking') setStatus('scanning');
    },
    onError: (err) => {
      activeLevel = null;
      setStatus('error');
      onError?.(err);
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
      levelCache.clear();
      activeLevel = null;
      setStatus('idle');
    },
  };
}
