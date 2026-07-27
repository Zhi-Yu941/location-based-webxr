/**
 * Why these tests matter: the gyro parallax egg (catalog №8, E9) adds a
 * light extra rotation to the phone frame from `deviceorientation` — but
 * ONLY where it's free (Android/desktop). iOS 13+ gates orientation
 * behind a permission prompt, and an opt-in tap would break the "fully
 * hidden" rule (E3), so iOS must be silently skipped. The offset must
 * also stay small (a subtle parallax, never a wild swing) and degrade to
 * zero on missing/garbage readings.
 */
import { describe, expect, it } from "vitest";
import {
  GYRO_MAX_RAD,
  gyroFrameOffset,
  isPermissionlessDeviceOrientation,
} from "./gyro-parallax";

describe("gyroFrameOffset", () => {
  it("is zero at the neutral pose and for missing/garbage readings", () => {
    expect(gyroFrameOffset(null)).toEqual({ x: 0, y: 0 });
    expect(gyroFrameOffset({ beta: 90, gamma: 0 })).toEqual({ x: 0, y: 0 });
    expect(gyroFrameOffset({ beta: null, gamma: 10 })).toEqual({ x: 0, y: 0 });
    expect(gyroFrameOffset({ beta: Number.NaN, gamma: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("tilts the frame with the device and stays within the small clamp", () => {
    const right = gyroFrameOffset({ beta: 90, gamma: 30 });
    expect(right.y).toBeGreaterThan(0);
    expect(Math.abs(right.y)).toBeLessThanOrEqual(GYRO_MAX_RAD);

    const forward = gyroFrameOffset({ beta: 120, gamma: 0 });
    expect(forward.x).not.toBe(0);
    expect(Math.abs(forward.x)).toBeLessThanOrEqual(GYRO_MAX_RAD);

    // Extreme tilt is clamped, never a wild swing.
    const extreme = gyroFrameOffset({ beta: 180, gamma: 90 });
    expect(Math.abs(extreme.x)).toBeLessThanOrEqual(GYRO_MAX_RAD);
    expect(Math.abs(extreme.y)).toBeLessThanOrEqual(GYRO_MAX_RAD);
  });
});

describe("isPermissionlessDeviceOrientation", () => {
  it("is true on Android/desktop (DeviceOrientationEvent, no requestPermission)", () => {
    const win = { DeviceOrientationEvent: function () {} } as unknown as Window;
    expect(isPermissionlessDeviceOrientation(win)).toBe(true);
  });

  it("is false on iOS 13+ (requestPermission gate — a prompt would break E3)", () => {
    const ctor = function () {} as unknown as { requestPermission: () => void };
    ctor.requestPermission = () => {};
    const win = { DeviceOrientationEvent: ctor } as unknown as Window;
    expect(isPermissionlessDeviceOrientation(win)).toBe(false);
  });

  it("is false when the API is absent entirely", () => {
    expect(isPermissionlessDeviceOrientation({} as unknown as Window)).toBe(
      false,
    );
  });
});
