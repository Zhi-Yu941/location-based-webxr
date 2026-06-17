# demo-controller.ts

**Purpose:** The orchestration brain of the demo (Note 4). Per throttled/coalesced
frame: detect a QR → measure size from depth (`createQrSizeMeasurer` → per-marker
running median) → once a size EXISTS, solve the full pose with the framework's
pure-JS PnP (`solveQrPose` + `PlanarPnpSquare`, position AND rotation from the
corner pixels) → on the N-consecutive-lock, record into `qrDetected` + glue the
axis + cube. Geo-less: never casts a GPS vote.

## Public API

- `createQrDemoController(deps): QrDemoController` — `{ offerFrame(image), status, reset() }`.
- `QrDemoControllerDeps` — injected `detect`, `getDepthContext`,
  `recordDetection`, `recordSize`, `updateScene`, optional `resolveStablePose`
  (windowed filtered pose for the overlay — e.g. `selectStableQrPose`), optional
  `solvePose` (defaults to `solveQrPose` + a pure-JS `PlanarPnpSquare`; inject a
  canned pose in tests), `onStatus`/`now`/ scheduler tuning.
- `DemoSolvePose = (input: Omit<SolveQrPoseInput,'solver'>) => QrPoseSolution | null`.
- `DepthContext = { unprojector, depthAt(sx,sy), cameraPose, projectionMatrix }`.
  `projectionMatrix` is the detector frame's view projection — PnP intrinsics come
  from `intrinsicsFromProjection(projectionMatrix, image.width, image.height)`.

## Invariants

- Built on the framework's generic `createDetectionScheduler` (throttle +
  coalesce + N-lock). `minIntervalMs` defaults to 0 (debug demo), `requiredLockCount` 2.
- **Pose is full PnP, not the depth-corner fit.** Depth still supplies the metric
  SIZE (`measurer.measure`); the pose comes from `solvePose({ imagePoints, sizeM,
intrinsics, cameraPose })`. Rotation no longer inherits per-corner depth noise.
  `pose-from-corners.ts` stays a tested off-path utility (hybrid-fallback building
  block), no longer on the live path.
- **Size-exists gate (relaxed):** the controller places as soon as ANY size is
  measured (`estimate.estimateM !== null`) — the lever that actually glued
  on-device. The strict `estimated` lifecycle is only the production GPS-vote gate,
  not the demo overlay. **Consequence:** if the depth size never converges (noisy /
  non-planar depth), nothing is glued — PnP cannot run without a size (unlike the
  old depth-fit, which could place a pose-only axis).
- A detection whose quad fails `validateQuad` (mirrored / degenerate), a missing
  depth context, a corner with no depth read (after the measurer's inset
  fallback), a `null` size, a `null` solve, or no detection → treated as a miss
  (no record, no scene update). `validateQuad` mirrors `solveQrPose`'s guard; it
  does NOT reorder corners (the detector's order carries the reading orientation).
- **Persistence (Note 3):** a miss does NOT clear the scene (objects keep their
  last pose). `qrPoseInCamera` and `reprojectionErrorPx` come straight from the
  PnP solution.
- **Stable-pose overlay (sliding-window stabilization):** on a lock the scene is
  rendered with `resolveStablePose(text)` when it has converged (the windowed,
  outlier-rejected pose), else the raw frame pose. `recordDetection` runs first,
  so the window already includes the current frame. The ring keeps the RAW poses —
  the filtered pose is never written back. See
  [2026-06-16-followup-qr-pose-stabilization-sliding-window.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md).
- Fully injected → unit-testable without WebXR / camera / depth.

## Tests

`demo-controller.test.ts` — injects a canned `solvePose` and a planar fake depth
context: lock records detection + size + the PnP scene update with a converged
0.2 m size; size converges to `estimated`; the size-exists gate withholds the lock
while the size is unknown (non-planar depth); a `null` solve, no depth,
no-corner-depth, no detection, and a degenerate quad all stay scanning without
recording; `resolveStablePose` overrides the rendered pose; `reset` → idle.

## Related

- The PnP backend: [planar-pnp.ts.md](../../GpsPlusSlamJs_AppFramework/src/ar/planar-pnp.ts.md)
  and the seam [qr-pose.ts.md](../../GpsPlusSlamJs_AppFramework/src/ar/qr-pose.ts.md)
  (`solveQrPose`).
- The size stage: [qr-size-measurer.ts.md](../../GpsPlusSlamJs_AppFramework/src/ar/qr-size-measurer.ts.md).
