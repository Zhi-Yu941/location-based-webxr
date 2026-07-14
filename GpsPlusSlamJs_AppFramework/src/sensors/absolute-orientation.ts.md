# `absolute-orientation.ts`

## Purpose

Phase 1 capture of the browser **`AbsoluteOrientationSensor`** (Generic Sensor
API): a magnetometer-fused device→ENU quaternion recorded per GPS event as a
GPS-independent north reference. Passive instrumentation — no production
behaviour change. See
[2026-06-25-0543-absolute-orientation-sensor-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-25-0543-absolute-orientation-sensor-plan.md)
§5.1.

## Public API

- `isAbsoluteOrientationAvailable(): boolean` — secure context **and** the
  `AbsoluteOrientationSensor` constructor present (Chrome Android only).
- `startAbsoluteOrientationWatch(onStatus?): Promise<void>` — idempotent; queries
  `accelerometer`/`gyroscope`/`magnetometer` permissions, constructs the sensor
  in the raw `'device'` frame at 20 Hz, and caches each `reading`. Surfaces
  lifecycle via `onStatus({state:'active'|'unavailable'|'error', reason?})`.
  **Never throws** — denied permission / missing API / constructor failure all
  resolve to a reported no-op, and a **throwing `onStatus` callback is isolated
  too** (logged, watch continues — PR #124 review, pinned by the never-throws
  test).
- `getLatestAbsoluteOrientation(): AbsoluteOrientationReading | null` — latest
  cached reading, snapshotted into the GPS event payload (mirrors
  `getLastDeviceOrientation`). `null` until the first reading / when unavailable.
- `stopAbsoluteOrientationWatch(): void` — idempotent; stops the sensor, clears
  the cache.

## Invariants & assumptions

- `AbsoluteOrientationReading` = `{ quaternion:[x,y,z,w] (device→ENU),
referenceFrame:'device', screenAngleDeg, timestamp }`. The raw device frame +
  screen angle let either the device- or screen-compensated form be reconstructed
  offline (plan §8 Q1).
- ENU: +X East, +Y (magnetic) North, +Z Up. The heading is **magnetic** — correct
  with the library's WMM declination module before comparing to a geographic-ENU
  alignment.
- Defensive: feature-detected; readings with a missing/short quaternion are
  ignored; permission denial / construction error degrade to a clean no-op so
  iOS/Safari/desktop keep working unchanged.
- **Best-effort permission gate**: each `permissions.query` is wrapped so a
  failed query — whether an async rejection OR a **synchronous** `TypeError`
  (some browsers throw for an unsupported permission name like `'magnetometer'`)
  — falls back to `'granted'` rather than aborting the whole watch. The sensor
  constructor still surfaces any real denial.
- The non-standard sensor is locally typed (minimal ambient interface) — no
  dependency on `@types/w3c-generic-sensor`.
- **Stale-start safety**: the start does its real work only after awaiting the
  permission gate, and the recorder fires it fire-and-forget. A monotonic
  `watchGeneration` token (incremented by every start and every stop) is captured
  after the initial stop and re-checked before the sensor is installed; if a
  `stop()`/restart landed during the await, the stale start aborts instead of
  installing a sensor that teardown no longer owns.
- **Stale-listener safety**: each `reading`/`activate`/`error` listener begins
  with a `created === sensor` guard. A real sensor can still deliver a queued
  event after `stop()` returns (the spec does not guarantee listener removal),
  and after a `stop()`/restart the superseded instance's events would otherwise
  write stale data into `latest` or emit a stale status from the previous
  session. The guard drops any event not from the currently-live instance.

## Examples

```ts
await startAbsoluteOrientationWatch((s) => hud.setAbsCompass(s));
// …at GPS-event time:
const reading = getLatestAbsoluteOrientation(); // → embed in RecordGpsEventPayload
```

## Tests

`absolute-orientation.test.ts` (jsdom) drives a **fake** `AbsoluteOrientationSensor`:
reading caches quaternion + screen angle; construction options; activate/error
status; missing-quaternion guard; permission-denied & no-Permissions-API paths;
synchronous-throw-from-`permissions.query` tolerance; constructor-throws path;
`stop` idempotency; restart-without-leak; stale-start abort when `stop()` lands
during the async permission check. The real
sensor (Chrome-Android device seam) is not e2e-tested — mirrors the image-quality
worker decision.
