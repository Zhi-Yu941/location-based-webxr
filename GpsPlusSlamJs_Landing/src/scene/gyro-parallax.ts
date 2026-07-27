/**
 * Gyro parallax on the phone frame (easter-egg catalog №8, E9:
 * Android-only, silent). While the phone frame flies in front of the
 * camera (dive chapter), `deviceorientation` adds a LIGHT extra rotation
 * to the frame — a subtle parallax, additive on top of the timeline pose
 * (same spirit as the ambient drift), never a wild swing.
 *
 * Permissionless only: on Android/desktop `deviceorientation` fires
 * without a prompt. iOS 13+ requires a gesture-gated
 * `DeviceOrientationEvent.requestPermission()`, and an opt-in tap would
 * break the "fully hidden" rule (E3), so iOS is silently skipped —
 * `isPermissionlessDeviceOrientation` gates the listener in main.ts.
 */

export interface DeviceOrientationReading {
  /** Front-back tilt in degrees (~90 when upright). */
  readonly beta: number | null;
  /** Left-right tilt in degrees (0 when flat/level). */
  readonly gamma: number | null;
}

export interface GyroOffset {
  readonly x: number;
  readonly y: number;
}

/** Radians of frame rotation per degree of device tilt (gentle). */
const RAD_PER_DEG = 0.0035;
/** Clamp so even a fully tilted device only nudges the frame. */
export const GYRO_MAX_RAD = 0.12;
/** Neutral front-back tilt (upright phone) — the parallax centers here. */
const NEUTRAL_BETA = 90;

function clampRad(value: number): number {
  return Math.max(-GYRO_MAX_RAD, Math.min(GYRO_MAX_RAD, value));
}

/**
 * Map a device-orientation reading to a small additive frame rotation.
 * Returns the zero offset for a missing or non-finite reading.
 */
export function gyroFrameOffset(
  orientation: DeviceOrientationReading | null,
): GyroOffset {
  if (
    !orientation ||
    orientation.beta === null ||
    orientation.gamma === null ||
    !Number.isFinite(orientation.beta) ||
    !Number.isFinite(orientation.gamma)
  ) {
    return { x: 0, y: 0 };
  }
  return {
    x: clampRad((orientation.beta - NEUTRAL_BETA) * RAD_PER_DEG),
    y: clampRad(orientation.gamma * RAD_PER_DEG),
  };
}

/**
 * True only where `deviceorientation` is FREE (no permission prompt):
 * the event constructor exists and does NOT expose `requestPermission`
 * (that method is the iOS 13+ gesture gate). Elsewhere → false.
 */
export function isPermissionlessDeviceOrientation(win: Window): boolean {
  const ctor = (win as { DeviceOrientationEvent?: unknown })
    .DeviceOrientationEvent;
  if (typeof ctor !== "function") {
    return false;
  }
  const requestPermission = (ctor as { requestPermission?: unknown })
    .requestPermission;
  return typeof requestPermission !== "function";
}
