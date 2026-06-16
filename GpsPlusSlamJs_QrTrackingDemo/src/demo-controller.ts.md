# demo-controller.ts

**Purpose:** The orchestration brain of the demo (Note 4). Per throttled/coalesced
frame: detect a QR → sample depth at corners + centroid → unproject → fit pose
(`poseFromWorldCorners`) → measure size (`estimateQrSizeFromDepth` → per-marker
running median) → on the N-consecutive-lock, record into `qrDetected` + glue the
axis + cube. Geo-less: never casts a GPS vote.

## Public API

- `createQrDemoController(deps): QrDemoController` — `{ offerFrame(image), status, reset() }`.
- `QrDemoControllerDeps` — injected `detect`, `getDepthContext`,
  `recordDetection`, `recordSize`, `updateScene`, optional `resolveStablePose`
  (windowed filtered pose for the overlay — e.g. `selectStableQrPose`),
  `onStatus`/`now`/ scheduler tuning.
- `DepthContext = { unprojector, depthAt(sx,sy), cameraPose }`.

## Invariants

- Built on the framework's generic `createDetectionScheduler` (throttle +
  coalesce + N-lock). `minIntervalMs` defaults to 0 (debug demo), `requiredLockCount` 2.
- A detection whose quad fails `validateQuad` (mirrored winding / degenerate),
  a missing depth context, a corner with no depth read, a degenerate pose, or no
  detection → treated as a miss (no record, no scene update). The `validateQuad`
  guard mirrors the framework's `solveQrPose` so the rigid-fit path rejects the
  same bad reads; it does NOT reorder corners (the detector's order carries the
  reading orientation — see the on-device follow-up §2.3).
- **Persistence (Note 3):** a miss does NOT clear the scene (objects keep their
  last pose). `qrPoseInCamera` is derived from the depth-fit world pose +
  `cameraPose`; `reprojectionErrorPx` is 0 (depth-fit has no PnP metric).
- **Stable-pose overlay (sliding-window stabilization):** on a lock the scene is
  rendered with `resolveStablePose(text)` when it has converged (the windowed,
  outlier-rejected pose), else the raw frame pose. `recordDetection` runs first,
  so the window already includes the current frame. The ring buffer keeps the RAW
  poses — the filtered pose is never written back. See
  [2026-06-16-followup-qr-pose-stabilization-sliding-window.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md).
- Fully injected → unit-testable without WebXR / camera / depth.

## Tests

`demo-controller.test.ts` — lock records detection + size + scene update with a
converged 0.2 m size; converges to `estimated`; no-depth / no-corner-depth /
no-detection stay scanning without recording; `reset` → idle.
