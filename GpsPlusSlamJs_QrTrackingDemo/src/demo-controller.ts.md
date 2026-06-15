# demo-controller.ts

**Purpose:** The orchestration brain of the demo (Note 4). Per throttled/coalesced
frame: detect a QR → sample depth at corners + centroid → unproject → fit pose
(`poseFromWorldCorners`) → measure size (`estimateQrSizeFromDepth` → per-marker
running median) → on the N-consecutive-lock, record into `qrDetected` + glue the
axis + cube. Geo-less: never casts a GPS vote.

## Public API

- `createQrDemoController(deps): QrDemoController` — `{ offerFrame(image), status, reset() }`.
- `QrDemoControllerDeps` — injected `detect`, `getDepthContext`,
  `recordDetection`, `recordSize`, `updateScene`, optional `onStatus`/`now`/
  scheduler tuning.
- `DepthContext = { unprojector, depthAt(sx,sy), cameraPose }`.

## Invariants

- Built on the framework's generic `createDetectionScheduler` (throttle +
  coalesce + N-lock). `minIntervalMs` defaults to 0 (debug demo), `requiredLockCount` 2.
- A missing depth context, a corner with no depth read, a degenerate pose, or no
  detection → treated as a miss (no record, no scene update).
- **Persistence (Note 3):** a miss does NOT clear the scene (objects keep their
  last pose). `qrPoseInCamera` is derived from the depth-fit world pose +
  `cameraPose`; `reprojectionErrorPx` is 0 (depth-fit has no PnP metric).
- Fully injected → unit-testable without WebXR / camera / depth.

## Tests

`demo-controller.test.ts` — lock records detection + size + scene update with a
converged 0.2 m size; converges to `estimated`; no-depth / no-corner-depth /
no-detection stay scanning without recording; `reset` → idle.
