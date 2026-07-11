# qr-detection-controller.ts

## Purpose

The **thin, geo-less RAW producer** for live QR detection (decision **D-X** of the recorder
live-QR plan, realized as "thin producer + shared derive-on-read consumer"). Per accepted
decode it emits ONE `RawQrObservation` — raw corners + camera pose + projection + frame size

- timestamp — and nothing derived. No size measure, no PnP: those moved to
  [`qr-derived-pose.ts`](./qr-derived-pose.ts.md) so the recording stays algorithm-agnostic /
  re-testable (D-A).

## Public API

- `createQrDetectionController(deps) → QrDetectionController` with `offerFrame(image)`,
  `status`, `reset()`.
- `QrDetectionControllerDeps` — injected: `detect(image)`, `getCameraPose()`,
  `getProjectionMatrix()`, `recordDetection(observation)` (the sink), `now?`,
  `minIntervalMs?` (default 0), `requiredLockCount?` (default 2), `onStatus?`.
- `QrScanStatus = 'idle' | 'scanning' | 'tracking'`; `RawObservationSink`.

## Invariants & assumptions

- **Cadence** is owned by `createDetectionScheduler` (throttle + N-consecutive-lock); this
  controller adds no second throttle (D-B refinement — the per-marker record throttle is
  deferred to this cadence).
- **Rejects** mirrored / degenerate quads (`validateQuad`) — the same reads `solveQrPose`
  rejects — and **skips** when `getCameraPose()`/`getProjectionMatrix()` is `null`, so a
  recording never captures an underivable detection.
- Pose + projection are snapshotted at **detection-resolve** time (mirrors the demo's
  post-detect depth read). The corners + that projection must describe the same buffer.
- **No `ar → state` import**: the record sink is injected; the controller never touches the
  `qrDetected` slice. Geo-less: casts no GPS vote. Separate from the level-based
  `qr-tracking-controller.ts` (the geo/vote brain), which is untouched.

## Examples

```ts
const controller = createQrDetectionController({
  detect: frontEnd.detect,
  getCameraPose: () => latestCameraPose,
  getProjectionMatrix: () => latestProjection,
  recordDetection: (o) => store.dispatch(recordQrDetection(o)),
});
controller.offerFrame(rgbaFrame); // throttled/coalesced internally
```

## Tests

`qr-detection-controller.test.ts` — one raw observation per accepted decode after the lock
count (asserting the exact raw shape + no derived fields), degenerate-quad rejection,
null-pose/projection skip, and no-decode → stays scanning.
