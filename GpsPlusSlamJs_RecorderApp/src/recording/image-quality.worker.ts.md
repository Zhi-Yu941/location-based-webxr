# `image-quality.worker.ts`

- **Purpose:** the off-main-thread half of the blur/blackness capture gate.
  Receives an encoded JPEG, decodes it (downscaled) to RGBA on an
  `OffscreenCanvas`, and returns a verdict computed by the framework's PURE
  `image-quality` metrics + `ImageQualityGate`. All pixel work happens here,
  never on the render thread (the off-main-thread guarantee, plan §8).

- **Protocol:** consumes `WorkerInbound` (`init` → reset gate + thresholds, reply
  `ready`; `analyze` → decode + judge, reply `verdict`), posts `WorkerOutbound`.
  See `image-quality-protocol.ts.md`.

- **Invariants & assumptions:**
  - **Device seam — NOT unit-tested.** It needs a real worker, `createImageBitmap`,
    and `OffscreenCanvas`. The logic it calls is covered by the framework's
    `image-quality.test.ts`; the main-thread transport by
    `image-quality-client.test.ts` (fake worker).
  - **Downscale to `MAX_ANALYZE_EDGE` (320 px long edge).** Variance-of-Laplacian
    and mean-luminance are robust to downscaling, and a small buffer keeps the
    per-frame cost trivial. Placeholder pending field tuning. Confirmed
    non-sensitive by the 2026-07-12 offline benchmark (256/320/384 flip ≤ 2 of
    156 gate verdicts).
  - **Metric selection stays in the framework.** The sharpness scorer is
    resolved via `blurMetricScorer(config.blurMetric)` (2026-07-12 blur-metric
    toggle plan): `'variance-of-laplacian'` (default; also the fallback for
    `undefined`/unknown ids from pre-toggle persisted configs) or
    `'high-frequency-energy-ratio'`. The worker never inspects the id itself,
    so the mapping remains unit-tested framework logic.
  - **One gate instance per recording.** An `init` resets it, so the rolling
    sharpness baseline never carries across recordings.
  - **Fail-open.** A decode failure or any thrown error replies `accept:true`
    (`reason:'decode-failed'`/`'analyze-error'`) so a frame is never dropped just
    because analysis hiccuped.
  - `self` is cast to a minimal worker surface because the app's TS `lib` is
    `["ES2022","DOM"]` (no `webworker` lib), under which `self` types as `Window`.

- **Tests:** none directly (device seam) — see the two test files above.

- **Related docs:** `image-quality-client.ts.md`, `image-quality-protocol.ts.md`,
  `../../../GpsPlusSlamJs_AppFramework/src/ar/image-quality.ts.md` (the pure
  metrics + gate it delegates to),
  `GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md`.
