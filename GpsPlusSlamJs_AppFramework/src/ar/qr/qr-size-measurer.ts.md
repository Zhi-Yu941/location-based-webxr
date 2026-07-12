# qr-size-measurer.ts

## Purpose

The composable depth→size piece shared by the QR demo and (next) the Recorder
(framework-wiring-options Part B, Option 2). Wraps the per-detection depth
sampling + the per-marker running-median accumulator that used to live inside
the demo controller, so each app wires **one measurer** instead of
re-implementing the loop.

## Public API

- `createQrSizeMeasurer(options?: QrSizeMeasurerOptions): QrSizeMeasurer`
  - `measure(text, corners: Point2[], image: {width,height}, ctx): QrSizeMeasurement | null`
    — **PRIMARY** path: samples an interior `latticeSize × latticeSize` lattice
    across the quad, runs `estimateQrSizeFromDepthDense` (robust plane fit + corner
    ray-plane recovery), folds the observation into the per-`text` accumulator.
    **FALLBACK** path: when the lattice is too sparse for a fit, samples the 4
    corners (+ centroid) and runs the corner-only `estimateQrSizeFromDepth`.
    Returns the updated estimate **plus** the raw samples used. `null` only when
    neither path can run — `corners.length !== 4`, or the lattice is too sparse
    **and** corner depth can't be sampled (≥2 corners lack depth). A degenerate
    quad is NOT a failure here — the null observation just isn't accumulated.
- `QrSizeMeasurerOptions extends QrSizeAccumulatorOptions`:
  - `latticeSize?: number` (default `7`) — points-per-side of the interior dense-
    fit lattice (≤49 reads). Reads with no depth are skipped.
  - `cornerInsetFractions?: number[]` (default `[0.12, 0.25]`) — **fallback path:**
    when a corner pixel has no depth, retry at points inset toward the centroid by
    these fractions and **borrow** the first valid depth, keeping the true corner
    position (so size is not shrunk). `[]` disables inset fallback.
  - `maxReconstructedCorners?: number` (default `1`) — **fallback path:** how many
    still-missing corners may have their depth reconstructed by a planar fit
    through the other three. `0` disables reconstruction.
  - `current(text): QrSizeEstimate` — estimate without adding a sample.
  - `reset(text?)` — clear one marker (or all).
- `QrSizeDepthContext` — `{ depthAt, unprojector }` (a subset of the demo's
  `DepthContext`).
- `QrSizeMeasurement` — `{ estimate, cornerSamples, interiorSamples }`.
  `cornerSamples` is `null` when the dense path produced the estimate but corner
  depth could not be sampled (a small QR whose corners fall between depth nodes);
  `interiorSamples` is the dense lattice on the primary path or the centroid on
  the fallback.
- `ImageSize` — `{ width, height }`.

## Invariants & assumptions

- **Dense fit is primary (WS-A).** The size comes from the robust plane fit over
  interior reads, not the noisy corner depths — so a small/tilted QR is sized from
  its face. The corner path is only a fallback for a too-sparse interior lattice.
- **Pose-agnostic by design.** It returns the raw samples so a _future_ depth-fit
  consumer could unproject them without re-sampling; current consumers (the demo,
  the Recorder) solve pose via PnP and read only `estimate`. Promoting a rigid
  depth-corner _pose_ fit into the framework is a separate follow-up (the demo's
  earlier `pose-from-corners` experiment was deleted after on-device validated PnP
  translation).
- Accumulation is keyed by `text`; markers are independent.
- Accumulator `options` flow to every per-marker `createQrSizeAccumulator`
  (quality threshold, min samples, spread cap, ring size).
- **Depth-at-corners robustness (C1):** QR corners sit on a high-contrast print
  boundary where the coarse WebXR depth grid often has no near reading. The
  inset fallback borrows a depth from a few-percent-inset point (valid because
  the marker face is locally planar); if a corner is still missing, its depth is
  reconstructed from the planar fit of the other three (up to
  `maxReconstructedCorners`). Both keep the true corner screen position so the
  measured size is unbiased.
- **Quality gate (C2):** `qualityThreshold` (default 0.8) decides which
  observations the accumulator ACCEPTS; lower it for noisy depth. Sampling a
  frame (returning a `QrSizeMeasurement`) is independent of acceptance — a
  rejected observation still returns the object but does not advance the
  estimate's `sampleCount`.

## Examples

```ts
const measurer = createQrSizeMeasurer();
const m = measurer.measure(detection.text, detection.corners, image, depthCtx);
if (m && m.estimate.status === 'estimated') useSize(m.estimate.estimateM);
```

## Tests

- `qr-size-measurer.test.ts` — wrong corner count → null, no-depth-anywhere →
  null, planar-square convergence to `estimated` via the dense path, per-marker
  independence, `reset`/`current`. A fake unprojector maps normalized corners
  onto a planar square so the full pipeline runs without a device. A "holey"
  context (depth null on corners) proves the dense path is independent of corner
  depth — it measures despite one or two missing corner regions even with the
  corner fallbacks disabled (and still reports best-effort `cornerSamples`). A
  "corners-only" context (interior empty) exercises the fallback: corner-based
  measurement, the empty-interior-AND-un-sampleable-corner → null gate, and the
  configurable quality gate.
