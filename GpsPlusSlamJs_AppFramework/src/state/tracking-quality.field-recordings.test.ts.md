# tracking-quality.field-recordings.test.ts — Sidecar

## Purpose

Integration test that replays real field-test recordings (zip files
under `gps-plus-slam/TestDataJs*/`) through a production-shaped
`createSlamAppStore` and asserts that the observations documented in the
[2026-05-23 user-feedback doc](../../../../GpsPlusSlamJs_Docs/docs/2026-05-23-tracking-quality-hud-user-feedback.md)
are reproducible from the recorded data. It is the executable spec for
"fixed" — after each Finding-N fix lands, the relevant assertion is
flipped to its post-fix expectation.

## Public API

None — it is a vitest test file. The only exports are the test
suite registrations.

## Invariants & assumptions

- The two fixture zip files live outside the npm-published package and
  outside the AppFramework workspace folder, at:
  - `<gpsRoot>/gps-plus-slam/TestDataJs/2026-05-19_15-43-55utc.zip`
  - `<gpsRoot>/gps-plus-slam/TestDataJs-Other/2026-05-23_03-01-11utc-indoor-without-moving.zip`
- When either file is missing the suite is skipped (`describe.runIf`)
  — the test must never hard-fail in a clean CI checkout.
- Recordings persist `gpsData/recordGpsEvent` but **not**
  `tracking/poseReceived`. AR pose data is carried inline on each GPS
  event's payload (`odomPosition`, `odomRotation`,
  `rawDeviceOrientation`). The replay loop synthesises a
  `tracking/poseReceived` action from these fields before dispatching
  the GPS event, so the §4.7 phase gate flips to `'tracking'` exactly
  as it would during a live session.
- The synthesis is test-only; production has its own AR-frame loop
  (`subscribeToTrackingPhase` / `webxr-session.ts`) that dispatches the
  real `poseReceived` stream.
- Sampling indices (`SAMPLE_GPS_INDICES`) are aligned with the §3.3
  plan: 1, 10, 30, 60, 120, 240 GPS observations.

## Examples

To run only this suite:

```powershell
cd c:\gps\location-based-webxr\GpsPlusSlamJs_AppFramework
pnpm run test:unit -- src/state/tracking-quality.field-recordings.test.ts
```

## Tests / what each `it` block proves

| Finding     | Block                                                             | What it proves                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sanity      | "outdoor recording produces multiple GPS observations"            | The zip loader, replay loop, and synthetic-pose dispatch produce a non-empty stream.                                                                                                                |
| sanity      | "indoor recording produces multiple GPS observations"             | Same for the indoor fixture.                                                                                                                                                                        |
| sanity      | "final report exists for both recordings"                         | `selectTrackingQuality` returns a non-null report after replay.                                                                                                                                     |
| F1          | "with synthesised poseReceived, mid-session state is NOT ar-lost" | Proves the aggregator + phase gate are correct given proper pose input. F1's live "stuck on AR LOST" bug must therefore be in the production dispatch path (not in `computeTrackingQualityReport`). |
| F1          | "confidence at gpsObs=120 is meaningfully > 0"                    | Same logic applied to the aggregate confidence.                                                                                                                                                     |
| F4          | "final snapshot: high residualConsensus despite low coverage"     | Pins the indoor pathology: stationary user → odometry deltas ≈ 0 → residual ≈ near-zero → sub-score saturates.                                                                                      |
| F4          | "convergence sub-score is unstable across the indoor session"     | Pins the un-smoothed `Conv:` jitter. Pre-fix bound is `range > 0.1`; after Finding 4 EMA smoothing lands the assertion will be flipped to `range < 0.2`.                                            |
| (skip path) | "skipped — recordings not present at expected paths"              | Documents that the suite gracefully no-ops in checkouts without the gitignored TestData folders.                                                                                                    |

The two follow-up helpers used to gather the structural facts for this
test live next to it:

- [`scripts/inspect-recording-actions.mjs`](../../scripts/inspect-recording-actions.mjs)
  — prints the action-type histogram of one or more zip recordings.
- [`scripts/inspect-recording-samples.mjs`](../../scripts/inspect-recording-samples.mjs)
  — prints one full action of each type for shape inspection.
