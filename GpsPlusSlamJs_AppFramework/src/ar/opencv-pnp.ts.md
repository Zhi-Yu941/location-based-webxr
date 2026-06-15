# opencv-pnp.ts

**Purpose:** OpenCV-backed implementation of `qr-pose.ts`'s injected
`SolvePnpSquare`, wrapping `cv.solvePnP(..., SOLVEPNP_IPPE_SQUARE)` with strict
`cv.Mat` lifetime discipline — Phase 2 / §3 §9 of the
[QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).

## Public API

- `class OpenCvPnpSquare implements SolvePnpSquare` — `new OpenCvPnpSquare(cv)`,
  `solve(objectPoints, imagePoints, intrinsics)` → `OpenCvPnpResult | null`,
  `dispose()`.
- `CvLike` — the slim OpenCV subset depended on (`CV_64F`,
  `SOLVEPNP_IPPE_SQUARE`, `Mat`, `matFromArray`, `solvePnP`). `CvMat` — the Mat
  slice (`delete`, `data64F`).

## Invariants & assumptions

- **OpenCV is injected**, not imported — so this module + tests need no WASM. The
  real `cv` is loaded lazily in a worker (`importScripts('<pinned CDN opencv.js>')`,
  a **classic** worker; opencv.js is not an ES module — plan §9) and passed to
  the constructor.
- **Memory discipline:** constant Mats (zero `distCoeffs`, reusable `rvec`/`tvec`
  outputs) are allocated once in the constructor and reused; per-solve Mats
  (object/image/camera) are deleted in a `finally`, even when `solvePnP` throws.
  `dispose()` frees the constants. The soak test asserts the live-Mat count is
  invariant across 200 solves and zero after dispose.
- `solve` returns `null` for <4 / mismatched points, `solvePnP` failure, or a
  non-finite pose — feeding straight into `solveQrPose`'s rejection path.
- Object/image/camera matrices follow OpenCV conventions (Nx3, Nx2, 3x3 CV_64F).
  The OpenCV→WebXR axis flip is done downstream by `qrInCameraFromOpenCv`.

## Tests

- `opencv-pnp.test.ts` — solve contract (success → rvec/tvec, failure/non-finite
  → null, post-dispose throws) and the memory soak (live-Mat count invariant
  across many solves, freed on throw via `finally`, zero after dispose), all via
  a mock `cv` that tracks live Mats.

## Related

- Implements the `SolvePnpSquare` interface from [qr-pose.ts.md](qr-pose.ts.md).
- Hosted alongside the detection front-ends in [qr-frontend.ts.md](qr-frontend.ts.md);
  driven by [qr-detection-scheduler.ts.md](qr-detection-scheduler.ts.md).
