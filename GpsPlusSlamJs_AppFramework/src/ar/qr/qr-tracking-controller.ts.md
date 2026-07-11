# qr-tracking-controller.ts

**Purpose:** The reusable orchestration "brain" of the QR demonstrator —
Phase 6 of the [QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
Wires front-end → level fetch → pose solve → GPS-vote bridge at a throttled,
coalesced cadence and exposes an async-status state machine for the UI.

## Public API

- `createQrTrackingController(config): QrTrackingController` — `offerFrame(image)`
  (call per render frame), read-only `status`, `reset()`.
- `QrTrackingStatus` = `idle | scanning | loading-level | tracking | error`.
- `QrTrackingControllerConfig` — injected `frontEnd`, `solvePose` (wraps
  `solveQrPose`), `fetchLevel`, `dispatchVotes`, `getCameraPose`,
  `getIntrinsics`, `syntheticAccuracyM`, optional `isPlausible` gate,
  optional `onDetection` (qrDetected emission), `resolveSizeM` (size when
  the level omits it — e.g. a depth-measured median), `resolveStablePose`
  (sliding-window filtered pose for the vote — e.g. `selectStableQrPose`),
  `onStatus`/`onLocked`/`onError`, and scheduler tuning
  (`minIntervalMs`, `requiredLockCount`, `now`).
- `QrDetectionEvent` — `{ text, qrPoseWorld, qrPoseInCamera, reprojectionErrorPx,
timestamp }`, emitted via `onDetection` on every lock. Structural (no import
  of the `qrDetected` state slice) so `ar` never depends on `state`; the app
  maps it onto `recordQrDetection`.

## Invariants & assumptions

- **Status machine:** `idle → scanning` on first frame; `loading-level` while a
  new URL's level is fetched (once per URL — cached); `tracking` once the
  scheduler locks (≥ `requiredLockCount` consecutive solves) and votes are
  dispatched; `error` on a level fetch / detect rejection; a miss while
  `tracking` drops back to `scanning`. `onStatus` fires only on change.
- **One detection in flight** (the scheduler coalesces), so the closure
  `active` (`{ level, text, sizeM }`) set during `detect` is the correct context
  read by `onLocked`.
- **Size lifecycle gate (Note 3):** the solve needs a size. Order: the level's
  authored `physicalSizeM`, else `resolveSizeM(text, level)` (e.g. a measured
  median). A `null`/absent size — OR a degenerate measured one (≤ 0, `NaN`,
  `Infinity`, which `resolveSizeM` can yield before it converges) — BLOCKS the
  solve (stays `scanning`) — no pose, no detection, no vote — until a valid size
  is authored or measured-and-locked. Degenerate sizes are gated here rather than
  left to crash `buildObjectPoints` (RangeError) and wedge the controller in
  `error`.
- **qrDetected emission is unconditional; the vote is conditional on `geo`**
  (Note 3). Every lock fires `onDetection`; `buildQrGpsVotes` (4-corner
  multi-correspondence) runs **only** when `level.qr.geo` is present, so geo-less
  levels (debug/observe, trigger, AR-root-anchored spawn) emit the detection but
  cast no vote.
- **Pose-stability gate (sliding-window stabilization):** when `resolveStablePose`
  is wired, the vote is built from the FILTERED pose and is SKIPPED until it
  converges (`null`) — the detection is still emitted, only the vote waits. The
  `onDetection` emission runs **before** the vote and feeds this frame's raw pose
  into the slice synchronously, so `resolveStablePose` reads a window that already
  includes the current frame. Without a resolver, the raw solve pose drives the
  vote (back-compat). See
  [2026-06-16-followup-qr-pose-stabilization-sliding-window.md](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md).
- **Fully injected** (front-end, solve, fetch, dispatch, camera/intrinsics
  accessors, clock) → no WASM, device, or store needed to test. Production wires
  `solvePose` to `solveQrPose({...input, solver: new PlanarPnpSquare()})`,
  `fetchLevel` to `fetchQrLevel`, `dispatchVotes` to `recordGpsEvent`, and
  optionally `isPlausible` to `checkQrPlausibility`.

## Tests

- `qr-tracking-controller.test.ts` — happy-path status progression + 4 votes
  dispatched, level cached once per URL, error path on fetch failure, stays
  scanning on no-detection, plausibility gate blocks the lock, `reset()` clears
  cache + returns to idle; qrDetected emitted on every lock, geo-less level
  emits detection but no vote, size gate blocks the solve when unknown, a
  `resolveSizeM`-supplied size unblocks it, the vote uses the `resolveStablePose`
  filtered pose, and the vote is skipped (detection still emitted) until stable.

## Related

- Composes [qr-frontend.ts.md](qr-frontend.ts.md), [qr-pose.ts.md](qr-pose.ts.md),
  [qr-level.ts.md](qr-level.ts.md), [qr-gps-vote.ts.md](qr-gps-vote.ts.md),
  [detection-scheduler.ts.md](detection-scheduler.ts.md), and optionally
  [qr-occupancy-check.ts.md](qr-occupancy-check.ts.md). Consumed by the Recorder
  demonstrator (Phase 6c).
