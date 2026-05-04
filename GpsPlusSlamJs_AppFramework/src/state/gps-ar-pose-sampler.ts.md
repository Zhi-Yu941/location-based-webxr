# `gps-ar-pose-sampler.ts`

## Purpose

Generic helpers for capturing a `{ gpsPoint, fusedGpsPoint?, arPose, odomPosition, odomRotation, timestamp }` snapshot — the fundamental shape any "drop an anchor here" UX needs. Extracted in Iter 4 of the AppFramework / RecorderApp boundary cleanup so the type/helper does not live under recorder-specific naming. The recorder's `RefPointObservation` is a `GpsAnchorSample` with `sessionId` glued on; future non-recorder consumers (POI capture, anchor types) reuse the type directly.

## Public API

- `GpsAnchorSampleGpsPoint` — `{ latitude, longitude, altitude? }`.
- `GpsAnchorSample` — `{ gpsPoint, fusedGpsPoint?, arPose, odomPosition, odomRotation, timestamp }`.
- `CaptureGpsAnchorSampleOptions` — `{ fusedGpsPoint?, timestamp? }`.
- `captureGpsAnchorSample(arPose, gpsPoint, options?)` — pre-extracts odom tuples and stamps a timestamp; pass-throughs `gpsPoint` and `fusedGpsPoint`.
- Re-exports `extractOdomPosition` / `extractOdomRotation` from `gps-event-coordinator.ts` for one-stop import.

## Invariants & assumptions

- `odomPosition`/`odomRotation` are derived from `arPose.position` / `arPose.orientation` exactly the way `gps-event-coordinator.ts` has always derived them — no coordinate conversion happens here.
- `fusedGpsPoint` is captured by the caller (e.g. via `fusedGpsFromOdom` plus alignment matrix). This module does no fusion of its own.
- `timestamp` defaults to `Date.now()` at call time; pass an explicit value for deterministic tests.

## Examples

```ts
import { captureGpsAnchorSample } from 'gps-plus-slam-app-framework/state/gps-ar-pose-sampler';

const sample = captureGpsAnchorSample(arPose, {
  latitude: lastGpsPoint.latitude,
  longitude: lastGpsPoint.longitude,
  altitude: lastGpsPoint.altitude,
});
```

## Tests

- See [gps-ar-pose-sampler.test.ts](gps-ar-pose-sampler.test.ts).

## Related docs

- [boundary plan](../../../../GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) — Iter 4.
