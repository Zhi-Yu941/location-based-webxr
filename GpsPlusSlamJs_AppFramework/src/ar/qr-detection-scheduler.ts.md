# qr-detection-scheduler.ts

**Purpose:** Turn the per-render-frame firehose into a throttled, coalesced
detection cadence with an N-consecutive-lock gate — Phase 2 / §9 + research2
runtime stability of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).

## Public API

- `createQrDetectionScheduler(config): QrDetectionScheduler` —
  `offerFrame(image)` (call per render frame), plus read-only `inFlight`,
  `consecutiveLocks`, `locked`.
- `QrDetectionSchedulerConfig` — `detect(image) => Promise<QrPoseSolution|null>`
  (the injected detect→solve step), `minIntervalMs`, `requiredLockCount` (3),
  `now` (injectable clock), `onLocked`, `onMiss`, `onError`.

## Invariants & assumptions

- **Throttle:** at most one detection START per `minIntervalMs` (100 ms ≈ 10 Hz);
  the first frame always passes (`lastStart = −∞`).
- **Coalesce:** `offerFrame` is a no-op while `inFlight` — stale frames are
  dropped, not queued, so the heavy WASM solve never backs up.
- **Lock gate:** `consecutiveLocks` increments on success (capped at
  `requiredLockCount`), resets to 0 on a miss or a rejected `detect`. `onLocked`
  fires on every success once `locked` (so a locked QR keeps voting — fresh,
  time-decayed votes per §12), `onMiss`/`onError` on the respective settle.
- **Transport-agnostic & device-free:** `detect` and the clock are injected; the
  same scheduler drives a worker-hosted or main-thread pipeline and is fully
  deterministic in tests.

## Tests

- `qr-detection-scheduler.test.ts` — throttle (one start per interval), coalesce
  (no overlap while in flight), lock-after-N + cap + miss-reset, error-resets +
  clears in-flight; clock and async `detect` injected for determinism.

## Related

- Drives [qr-frontend.ts.md](qr-frontend.ts.md) + [qr-pose.ts.md](qr-pose.ts.md)
  (`solveQrPose`) + [opencv-pnp.ts.md](opencv-pnp.ts.md); locked solutions feed
  the occupancy self-check ([qr-occupancy-check.ts.md](qr-occupancy-check.ts.md))
  and the GPS-vote bridge ([qr-gps-vote.ts.md](qr-gps-vote.ts.md)).
