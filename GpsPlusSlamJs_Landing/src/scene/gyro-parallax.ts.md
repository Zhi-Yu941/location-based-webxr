# `scene/gyro-parallax.ts` — phone-frame gyro parallax (№8)

## Purpose

Adds a light additive rotation to the phone frame from
`deviceorientation` while it's flown in front of the camera (dive
chapter) — a subtle parallax (catalog №8, E9). Android/desktop only.

## Public API

- `gyroFrameOffset(orientation): { x, y }` — pure map from a device
  reading to a small clamped frame rotation (radians); zero for
  missing/non-finite readings.
- `isPermissionlessDeviceOrientation(win): boolean` — true only where
  `deviceorientation` is free (constructor present, no
  `requestPermission`). Gates the listener in main.ts.
- `GYRO_MAX_RAD` (0.12), `DeviceOrientationReading`, `GyroOffset`.

## Invariants & assumptions

- **iOS silently skipped:** iOS 13+ exposes
  `DeviceOrientationEvent.requestPermission` (a gesture-gated prompt);
  an opt-in tap would break the fully-hidden rule (E3), so the predicate
  returns false there and no listener attaches (test-pinned).
- **Small + safe:** the offset is clamped to ±`GYRO_MAX_RAD`, centered on
  the upright pose (beta ≈ 90), and zero on bad input — never a wild
  swing.
- **Additive, idempotent:** the controller SETs the phone rotation from
  the offset each frame ONLY while the phone is flown in (`scale > 0.05`)
  — the timeline never rotates the phone, so this returns to neutral when
  no reading arrives. Off under reduced motion (main.ts attaches the
  listener in scroll mode only).

## Tests

`gyro-parallax.test.ts` — neutral/missing → zero, tilt within the clamp,
permissionless predicate across Android/iOS/absent. The phone-only
application is pinned in `scene-controller.test.ts`.
