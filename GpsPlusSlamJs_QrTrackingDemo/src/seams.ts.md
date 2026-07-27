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
  camera pose + the view `projectionMatrix` from the latest `DepthSample`
  (the `depth` group passed to the framework `initAR`). The `projectionMatrix`
  feeds PnP intrinsics (`intrinsicsFromProjection`) in the controller.
- PROD frames come from the framework's generic **camera-frame RGBA capture**
  (B2): the seam's `initAR` passes the framework `initAR` a
  `callbacks.cameraFrame` group (alongside the depth group — the framework's
  pre-init setters were folded into `initAR`) that forwards each throttled
  **top-left RGBA**
  frame to the active consumer; `startFrameSource(onImage, { intervalMs })` sets
  that consumer and calls `startCameraFrameCapture({ intervalMs })` — the source
  is the single cadence owner (Option A; the controller runs `minIntervalMs: 0`).
  The old `OffscreenCanvas` JPEG decode (`decodeToRgba`) is gone.
  `startFrameSource` itself stays as the **e2e frame-injection seam** — only its
  PROD body changed.
- detect uses `createBarcodeDetectorFrontEnd`.

## Tests

`seams.test.ts` — `getSeams()` returns `realSeams` under VITEST; `realSeams`
exposes every function `main.ts` wires. The faked path is exercised by the e2e.
