# qr-frontend.ts

**Purpose:** The detect+decode front-end behind a single `QrFrontEnd` —
Phase 2 / §3 of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
Native `BarcodeDetector` only; the OpenCV `QRCodeDetector` fallback was removed
(the framework is now OpenCV-free).

## Public API

- `QrFrontEnd` — `{ kind: 'barcode-detector', detect(image: RgbaImage): Promise<QrDetection | null>, dispose?() }`.
  `QrDetection = { corners: [Point2×4], text }`; `RgbaImage = { data, width, height }`.
- `BarcodeDetectorFrontEnd` — `new (detector: BarcodeDetectorLike, toSource?)`.
  Wraps native `BarcodeDetector`; `toSource` converts `RgbaImage` →
  `ImageBitmapSource` (default `new ImageData(...)`, injectable for tests).
- `createBarcodeDetectorFrontEnd(ctor?)` — feature-detect factory; `null` when no
  `BarcodeDetector` constructor exists. There is **no OpenCV fallback** — the
  caller must handle the unsupported-browser case (see the follow-up below).
- Supporting types: `DetectedBarcodeLike`, `BarcodeDetectorLike`,
  `ToImageBitmapSource`.

## Invariants & assumptions

- **Front-end-agnostic corners:** corners are emitted in pixel coordinates
  (top-left origin) in an arbitrary order; the order is not contractually
  TL,TR,BR,BL. Winding/order validation is downstream in `qr-pose.ts`
  `validateQuad` — the pose path does not assume a front-end.
- **Dependencies injected:** the native detector and the `RgbaImage`→source
  conversion are injected, so this module + tests need no DOM.
- **Malformed output rejected:** non-4 corner counts, non-finite coordinates, and
  empty decoded text yield `null`.
- **Interim posture is BarcodeDetector-only** (covers the Android-Chrome test
  devices). A pure-JS decoder fallback (zxing-wasm / jsQR / none) is its own
  dependency decision — see
  [2026-06-17-followup-qr-decoder-fallback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-17-followup-qr-decoder-fallback.md).

## Tests

- `qr-frontend.test.ts` — BarcodeDetector: first valid QR returned, nothing
  detected → null, malformed results (wrong corner count / empty text) skipped;
  factory null (no ctor) and constructed-with-`qr_code`-format cases.

## Related

- Emits corners consumed by [qr-pose.ts.md](qr-pose.ts.md) (`solveQrPose`).
- The PnP backend is the pure-JS [planar-pnp.ts.md](planar-pnp.ts.md).
- Driven at a throttled cadence by [detection-scheduler.ts.md](detection-scheduler.ts.md).
