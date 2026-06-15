# seams.ts

**Purpose:** The device boundary. `main.ts` composes the tested modules with the
device functions here; the Playwright e2e swaps a fake in via the DEV-only
`window.__qrDemoSeams` override. The PROD frame/depth source is the
**on-device-verified layer** (the §5 gate is manual — exactly as the parent QR
plan defers the Recorder's live camera wiring).

## Public API

- `getSeams(): QrDemoSeams` — real framework wiring unless a DEV override is
  present (inert in production + unit tests, see prod-inert note).
- `realSeams` — the production implementation.
- `QrDemoSeams` — `checkSupport`, `initAR`, `endARSession`, `getArWorldGroup`,
  `createDetect`, `getDepthContext`, `startFrameSource`.

## Invariants

- **Prod-inert:** the override is read only under
  `import.meta.env.DEV && !import.meta.env.VITEST` — Vite statically strips it
  from production; unit tests ignore it.
- PROD `getDepthContext` builds an unprojector + nearest-neighbour depth lookup +
  camera pose from the latest `DepthSample` (`setDepthCaptureCallback`); PROD
  `startFrameSource` decodes captured JPEG blobs (`setImageCaptureCallback`) to
  RGBA via `OffscreenCanvas` and feeds the controller; detect uses
  `createBarcodeDetectorFrontEnd`.

## Tests

`seams.test.ts` — `getSeams()` returns `realSeams` under VITEST; `realSeams`
exposes every function `main.ts` wires. The faked path is exercised by the e2e.
