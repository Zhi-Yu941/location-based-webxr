# qr-frontend.ts

**Purpose:** The detect+decode front-ends behind a single `QrFrontEnd` —
Phase 2 / §3 of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
Native `BarcodeDetector` is preferred; OpenCV's `QRCodeDetector` is the fallback.

## Public API

- `QrFrontEnd` — `{ kind, detect(image: RgbaImage): Promise<QrDetection | null>, dispose?() }`.
  `QrDetection = { corners: [Point2×4], text }`; `RgbaImage = { data, width, height }`.
- `BarcodeDetectorFrontEnd` — `new (detector: BarcodeDetectorLike, toSource?)`.
  Wraps native `BarcodeDetector`; `toSource` converts `RgbaImage` →
  `ImageBitmapSource` (default `new ImageData(...)`, injectable for tests).
- `createBarcodeDetectorFrontEnd(ctor?)` — feature-detect factory; `null` when
  no `BarcodeDetector` constructor exists (→ use the OpenCV fallback).
- `OpenCvQrFrontEnd` — `new (detector: CvQrDetectorLike)`. Wraps OpenCV's
  detector with `cv.Mat` discipline (`matFromRgba` + points Mat freed in a
  `finally`).
- Supporting types: `DetectedBarcodeLike`, `BarcodeDetectorLike`,
  `ToImageBitmapSource`, `CvQrDetectorLike`, `CvImageMat`, `CvPointsMat`.

## Invariants & assumptions

- **Front-end-agnostic corners:** both emit pixel corners (top-left origin) in an
  arbitrary order; neither order is contractually TL,TR,BR,BL. Winding/order
  validation is downstream in `qr-pose.ts` `validateQuad` — the pose path does
  not assume a front-end.
- **Dependencies injected:** the native detector, the OpenCV detector, and the
  `RgbaImage`→source conversion are all injected, so this module + tests need no
  DOM and no WASM.
- **Malformed output rejected:** non-4 corner counts, non-finite coordinates, and
  empty decoded text yield `null`.
- **Worker hosting:** in production this runs in a worker; `OpenCvQrFrontEnd`'s
  `CvQrDetectorLike` is built from the lazily-loaded `cv` (classic worker,
  `importScripts`; see [opencv-pnp.ts.md](opencv-pnp.ts.md) and plan §9). The
  pipeline (front-end + `OpenCvPnpSquare` + `solveQrPose`) is transport-agnostic,
  so the same code runs on the main thread in tests.

## Tests

- `qr-frontend.test.ts` — BarcodeDetector: first valid QR returned, malformed
  results skipped, factory null/constructed cases. OpenCV: text+corners returned,
  empty decode → null, both Mats freed on hit and miss, `dispose()` frees the
  detector.

## Related

- Emits corners consumed by [qr-pose.ts.md](qr-pose.ts.md) (`solveQrPose`).
- The OpenCV PnP backend is [opencv-pnp.ts.md](opencv-pnp.ts.md).
- Driven at a throttled cadence by [qr-detection-scheduler.ts.md](qr-detection-scheduler.ts.md).
