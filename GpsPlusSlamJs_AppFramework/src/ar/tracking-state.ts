/**
 * Tracking State Manager
 *
 * Detects AR tracking loss and restart events, maintaining state
 * about the last valid odometry pose for alignment correction.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 *
 * When WebXR tracking is lost and restarted, the odometry frame resets
 * to a new origin. To maintain GPS+AR alignment, we need to:
 * 1. Store the last valid pose before tracking was lost
 * 2. Detect when tracking resumes with a new pose
 * 3. Dispatch odometryTrackingRestarted with both poses for offset calculation
 */

import { createLogger } from '../utils/logger';
import type { ARPose } from '../types/ar-types';
import type {
  OdometryTrackingRestartedPayload,
  Vector3,
  Quaternion,
} from 'gps-plus-slam-js';
import { extractOdomPosition } from '../state/gps-event-coordinator';

const log = createLogger('TrackingState');

/**
 * Possible tracking states
 */
export enum TrackingState {
  /** AR session started but no pose received yet */
  INITIALIZING = 'initializing',
  /** Actively receiving valid poses */
  TRACKING = 'tracking',
  /** Pose became unavailable (tracking lost) */
  LOST = 'lost',
}

/**
 * Device orientation from sensors (for sensor rotation in restart payload)
 */
export interface DeviceOrientation {
  alpha: number; // Compass heading (0-360)
  beta: number; // Pitch (-180 to 180)
  gamma: number; // Roll (-90 to 90)
  absolute: boolean; // Whether alpha is relative to magnetic north
}

/**
 * Serialized representation of the XRReferenceSpaceEvent.transform.
 * The position and orientation of the new native origin expressed in
 * the pre-reset coordinate system.  `null` when the runtime cannot
 * determine the delta.
 */
export interface ResetTransformData {
  position: Vector3;
  orientation: Quaternion;
}

/**
 * Callbacks for tracking state changes
 */
export interface TrackingStateCallbacks {
  /** Called when tracking is lost (pose became null) */
  onTrackingLost: () => void;
  /** Called when tracking resumes after a coordinate-frame reset (Case 2: relocalization) */
  onTrackingRestarted: (payload: OdometryTrackingRestartedPayload) => void;
  /** Called when tracking resumes seamlessly without origin reset (Case 1) */
  onTrackingRecovered?: () => void;
  /** Get current device orientation for sensor rotation */
  getDeviceOrientation: () => DeviceOrientation;
}

/**
 * Manages AR tracking state and detects loss/restart events.
 */
export class TrackingStateManager {
  private state: TrackingState = TrackingState.INITIALIZING;
  private lastValidPose: ARPose | null = null;
  private lastSensorOrientation: DeviceOrientation | null = null;
  private lostFrameCount = 0;
  private originResetDuringLoss = false;
  private resetTransform: ResetTransformData | null | undefined = undefined;
  private callbacks: TrackingStateCallbacks;

  constructor(callbacks: TrackingStateCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Get current tracking state.
   */
  getState(): TrackingState {
    return this.state;
  }

  /**
   * Get the last valid AR pose (before tracking was lost).
   */
  getLastValidPose(): ARPose | null {
    return this.lastValidPose;
  }

  /**
   * Get count of consecutive frames without pose (during LOST state).
   */
  getLostFrameCount(): number {
    return this.lostFrameCount;
  }

  /**
   * Flag that an XRReferenceSpace reset event occurred during tracking loss.
   * Only meaningful while in LOST state — ignored otherwise.
   *
   * @param transform — Serialized XRReferenceSpaceEvent.transform (post-reset
   *   origin in pre-reset coordinates).  Pass `null` when the event's
   *   transform property is null (runtime can't determine delta).
   *   Omit entirely for backwards-compat with callers that don't have it.
   */
  markOriginReset(transform?: ResetTransformData | null): void {
    if (this.state === TrackingState.LOST) {
      this.originResetDuringLoss = true;
      this.resetTransform = transform;
    }
  }

  /**
   * Called when a valid pose is received from WebXR.
   */
  onPoseReceived(pose: ARPose): void {
    const previousState = this.state;

    if (previousState === TrackingState.LOST) {
      // Tracking has restarted after being lost
      this.handleTrackingRestarted(pose);
    }

    // Update state and store pose
    this.state = TrackingState.TRACKING;
    this.lastValidPose = pose;
    this.lastSensorOrientation = this.callbacks.getDeviceOrientation();
    this.lostFrameCount = 0;
  }

  /**
   * Called when pose is null/unavailable from WebXR.
   */
  onPoseLost(): void {
    this.lostFrameCount++;

    if (this.state === TrackingState.TRACKING) {
      // Just lost tracking
      this.state = TrackingState.LOST;
      this.callbacks.onTrackingLost();
      log.warn('AR tracking lost');
    }
    // If already LOST or INITIALIZING, just increment counter
  }

  /**
   * Reset the manager to initial state.
   * Call this when starting a new session.
   */
  reset(): void {
    this.state = TrackingState.INITIALIZING;
    this.lastValidPose = null;
    this.lastSensorOrientation = null;
    this.lostFrameCount = 0;
    this.originResetDuringLoss = false;
    this.resetTransform = undefined;
  }

  /**
   * Handle the transition from LOST to TRACKING (restart detected).
   */
  private handleTrackingRestarted(newPose: ARPose): void {
    const hadReset = this.originResetDuringLoss;
    const savedResetTransform = this.resetTransform;
    this.originResetDuringLoss = false;
    this.resetTransform = undefined;

    if (!hadReset) {
      // Case 1: seamless recovery — coordinate frame unchanged
      log.info('AR tracking recovered (same coordinate frame)');
      this.callbacks.onTrackingRecovered?.();
      return;
    }

    // Case 2: relocalization — coordinate frame reset
    if (!this.lastValidPose) {
      log.warn('Tracking restarted but no previous pose available');
      return;
    }

    const currentSensorOrientation = this.callbacks.getDeviceOrientation();

    const lastOrientation =
      this.lastSensorOrientation ?? currentSensorOrientation;

    const payload: OdometryTrackingRestartedPayload = {
      lastValidOdomPos: extractOdomPosition(this.lastValidPose),
      lastValidOdomRot: [
        this.lastValidPose.orientation.x,
        this.lastValidPose.orientation.y,
        this.lastValidPose.orientation.z,
        this.lastValidPose.orientation.w,
      ],
      lastSensorOrientation: {
        alpha: lastOrientation.alpha,
        beta: lastOrientation.beta,
        gamma: lastOrientation.gamma,
        absolute: lastOrientation.absolute,
      },
      newOdomRot: [
        newPose.orientation.x,
        newPose.orientation.y,
        newPose.orientation.z,
        newPose.orientation.w,
      ],
      newSensorOrientation: {
        alpha: currentSensorOrientation.alpha,
        beta: currentSensorOrientation.beta,
        gamma: currentSensorOrientation.gamma,
        absolute: currentSensorOrientation.absolute,
      },
      newOdomPos: extractOdomPosition(newPose),
      resetTransform: savedResetTransform,
    };

    log.info(
      'AR tracking restarted (origin reset), dispatching alignment correction'
    );
    this.callbacks.onTrackingRestarted(payload);
  }
}
