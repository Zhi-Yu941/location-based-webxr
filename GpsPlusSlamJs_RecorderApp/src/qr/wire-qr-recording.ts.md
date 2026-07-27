# wire-qr-recording.ts

## Purpose

Composes the live QR feature into a running AR session, gated by
`recordingOptions.qr.enabled`: the WS-2 **producer** (records RAW detections) and
the WS-5 **consumer** (debug axis+cube). `main.ts` calls it once in `handleEnterAR`
(after `arWorldGroup` exists) and disposes it on reset / re-entry.

## Public API

- `wireQrRecording(options) → dispose()`
  - `options.storeRef` — the active-store ref (producer + viz follow swaps).
  - `options.getArWorldGroup()` — parent for the debug objects.
  - `options.qr` — `{ enabled, intervalMs, captureSize }` (caller gates on `enabled`).
  - `options.setProducer(producer | null)` — receives the producer so the
    initAR `callbacks.cameraFrame.onFrame` (wired at Enter-AR) can forward frames to it.
  - returns a `dispose()` that stops capture, resets/clears the producer, detaches
    the debug subscriber + swap listener, and disposes the viz.

## Invariants & assumptions

- **Clock domain (load-bearing, open topic A):** the producer's `now` is
  `Date.now()` (EPOCH ms) — the SAME clock the recorded depth stream uses
  (`DepthSample.timestamp = performance.timeOrigin + frameTs`) — so the
  derive-on-read size as-of join (`depth.ts ≤ detection.ts`) pairs each detection
  with the right depth sample. Stamping `performance.now()` (relative) was the
  original "no debug cube" bug: it never satisfies the join.
- **Single cadence owner:** `startCameraFrameCapture({ intervalMs })` throttles;
  the producer runs `minIntervalMs: 0`.
- **rAF-coalesced viz updates (F3, perf-degradation fix):** per-store-action
  `debug.update()` calls are coalesced to at most one per animation frame (the
  store bursts depth + GPS + ~8 Hz QR); the initial wire + store swaps update
  synchronously for immediacy. The pending frame is cancelled on dispose.
- **Camera pose** comes from the current XR frame (`getCurrentArPose()`, Option A) —
  fresh every frame, not stale to the 1 Hz depth. **Projection** still comes from
  the latest depth sample (near-constant FOV; per-frame projection is open topic F).
  The observation's `imageWidth/Height` come from the detector-frame buffer.
- **Store-swap safe:** dispatches + reads go through `storeRef.get()`, and the
  debug subscriber re-attaches on every swap (Start Recording / replay).

## Tests

- `wire-qr-recording.test.ts` — producer clock is `performance.now()` not epoch;
  capture started with the configured cadence/size; producer handed to
  `setProducer`; camera pose/projection read from the latest depth sample;
  detections dispatch RAW into the current store; debug controller driven on change
  - re-attached across a swap; `dispose()` tears everything down. Framework
    producer/controller are mocked.

## Related

- [qr-debug-controller.ts.md](qr-debug-controller.ts.md), [qr-depth-resolver.ts.md](qr-depth-resolver.ts.md).
- `gps-plus-slam-app-framework/ar/qr/qr-detection-controller` — the thin producer.
