# qr-tracking-controller.ts

**Purpose:** The reusable orchestration "brain" of the QR demonstrator —
Phase 6 of the [QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
Wires front-end → level fetch → pose solve → GPS-vote bridge at a throttled,
coalesced cadence and exposes an async-status state machine for the UI.

## Public API

- `createQrTrackingController(config): QrTrackingController` — `offerFrame(image)`
  (call per render frame), read-only `status`, `reset()`.
- `QrTrackingStatus` = `idle | scanning | loading-level | tracking | error`.
- `QrTrackingControllerConfig` — injected `frontEnd`, `solvePose` (wraps
  `solveQrPose`), `fetchLevel`, `dispatchVotes`, `getCameraPose`,
  `getIntrinsics`, `syntheticAccuracyM`, optional `isPlausible` gate,
  `onStatus`/`onLocked`/`onError`, and scheduler tuning
  (`minIntervalMs`, `requiredLockCount`, `now`).

## Invariants & assumptions

- **Status machine:** `idle → scanning` on first frame; `loading-level` while a
  new URL's level is fetched (once per URL — cached); `tracking` once the
  scheduler locks (≥ `requiredLockCount` consecutive solves) and votes are
  dispatched; `error` on a level fetch / detect rejection; a miss while
  `tracking` drops back to `scanning`. `onStatus` fires only on change.
- **One detection in flight** (the scheduler coalesces), so the closure
  `activeLevel` set during `detect` is the correct level read by `onLocked`.
- **Vote dispatch** uses `buildQrGpsVotes` (4-corner multi-correspondence) with
  the level's `physicalSizeM` + `geo` and the configured synthetic accuracy.
- **Fully injected** (front-end, solve, fetch, dispatch, camera/intrinsics
  accessors, clock) → no WASM, device, or store needed to test. Production wires
  `solvePose` to `solveQrPose({...input, solver: OpenCvPnpSquare})`,
  `fetchLevel` to `fetchQrLevel`, `dispatchVotes` to `recordGpsEvent`, and
  optionally `isPlausible` to `checkQrPlausibility`.

## Tests

- `qr-tracking-controller.test.ts` — happy-path status progression + 4 votes
  dispatched, level cached once per URL, error path on fetch failure, stays
  scanning on no-detection, plausibility gate blocks the lock, `reset()` clears
  cache + returns to idle.

## Related

- Composes [qr-frontend.ts.md](qr-frontend.ts.md), [qr-pose.ts.md](qr-pose.ts.md),
  [qr-level.ts.md](qr-level.ts.md), [qr-gps-vote.ts.md](qr-gps-vote.ts.md),
  [qr-detection-scheduler.ts.md](qr-detection-scheduler.ts.md), and optionally
  [qr-occupancy-check.ts.md](qr-occupancy-check.ts.md). Consumed by the Recorder
  demonstrator (Phase 6c).
