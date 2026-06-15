# qr-tracking-presenter.ts

## Purpose

Maps the framework `QrTrackingController`'s async status callbacks onto the
HUD's `updateStatus` / `showError` channels, so the off-by-default QR-tracking
demonstrator obeys the "UI feedback for async actions" rule. Phase 6c of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).

## Public API

- `createQrTrackingPresenter(deps): QrTrackingPresenter` — returns `{ onStatus,
  onLocked, onError }` to pass straight into `createQrTrackingController`.
- `qrStatusText(status): string | null` — the in-progress status line per state
  (`null` for `idle`/`error`, which are handled by clearing / `showError`).
- `deps: { updateStatus, showError }` (the HUD functions, injected).
- `QrTrackingStatus`, `PresentableLevel`.

## Invariants & assumptions

- **Feedback contract:** `scanning` → "🔍 Scanning for QR…", `loading-level` →
  "⬇️ Loading QR level…", `tracking` → "✅ QR locked", then `onLocked` overrides
  with the **durable** confirmation "✅ Tracking QR (level v{version})". `onError`
  routes through the existing `showError` red channel.
- **Dependency-free:** the HUD functions and the status union are injected /
  duplicated, so the transitional + final states are unit-testable with no DOM,
  device, or framework rebuild. The union mirrors the framework's
  `QrTrackingStatus` structurally and is intentionally duplicated to keep the
  presenter decoupled from the built framework type.

## Tests

- `qr-tracking-presenter.test.ts` — success path (transitional lines shown, final
  durable state names the level, no error) and failure path (transitional state
  reached, then the failure surfaced through `showError`, incl. non-Error
  defensive stringification) — exactly the async-UI rule's required assertions.

## Remaining on-device wiring (NOT in this module)

The live integration is device-coupled and overlaps the plan's **mandatory
manual** §5 / Phase 3 gate, so it is deliberately out of scope here:

- an off-by-default `qrTracking` recording option + settings-modal checkbox;
- constructing the framework controller at Enter-AR with `OpenCvPnpSquare` (in a
  classic worker that `importScripts` opencv.js), the BarcodeDetector front-end,
  `solveQrPose`, `fetchQrLevel`, `recordGpsEvent` dispatch, and
  `checkQrPlausibility`;
- feeding `CameraBlitCapture.captureToPixels` frames + the per-view projection
  matrix (`intrinsicsFromProjection`) into `controller.offerFrame`;
- a Playwright e2e with a faked detector + faked fetch.

See the plan's §10 (Phase 3, Phase 6) and the implementation-progress log.
