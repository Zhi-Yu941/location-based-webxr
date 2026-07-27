# device-orientation-cache.ts

## Purpose

Module-level cache of the latest `RawDeviceOrientation` reading (compass alpha/beta/gamma from the DeviceOrientationEvent watch). Moved from `state/gps-event-coordinator.ts` (2026-07-10, quality-review G-8) so sensor state lives in `sensors/` — `ar/webxr-session` previously imported it from a state module (an ar→state inversion).

## Public API

- `updateDeviceOrientation(orientation: RawDeviceOrientation): void` — store the newest reading (called by the host's orientation watch).
- `getLastDeviceOrientation(): RawDeviceOrientation | null` — latest reading; `null` before the first one.
- `resetDeviceOrientationCache(): void` — clear (testing / session reset; `resetCoordinatorState()` delegates here).

## Invariants & assumptions

- Single-threaded module singleton — one cache per page, matching the one physical sensor.
- Distinct from `sensors/absolute-orientation.ts`' own cache: that one holds AbsoluteOrientationSensor quaternions; this one holds DeviceOrientationEvent Euler angles. They feed different recorded fields by design.
- `state/gps-event-coordinator.ts` re-exports `updateDeviceOrientation`/`getLastDeviceOrientation` so the published API is unchanged.

## Tests

Covered via the coordinator's existing tests (`gps-event-coordinator.test.ts` exercises update→GPS-event capture and reset) — the re-exports keep those tests pointing at this implementation.
