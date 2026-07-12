# `image-quality.ts`

- **Purpose:** pure image-content metrics (blur + blackness) and the
  self-calibrating drop/retry **verdict policy** for the image-quality capture
  gate — the increment layered on top of the motion gate
  (`capture-motion-gate.ts`). No DOM, no Web Worker: the recorder's
  `image-quality.worker.ts` is a thin shell that decodes a frame and calls in.

- **Public API:**
  - `sharpnessScore(gray, width, height): number` — variance of the Laplacian
    (4-neighbour kernel) over a single-channel grayscale buffer; the standard
    Pech-Pacheco focus measure. Higher ⇒ sharper. Returns `0` for degenerate
    input (non-integer or `< 3` dimensions, buffer shorter than `width·height`).
  - `highFrequencyEnergyRatio(gray, width, height, cutoff = 0.3): number` —
    fraction of non-DC 2D-FFT energy at normalized radial frequency ≥ `cutoff`,
    over the centered largest power-of-two crop (< 8×8 crop ⇒ `0`). In [0, 1];
    higher ⇒ sharper; invariant to brightness shift AND contrast scale (a
    ratio). Same defensive-0 contract as `sharpnessScore`. Ported 2026-07-12
    from the investigation benchmark where it won "sharp vs degraded"
    (AUC 0.838) — see the blur-metric-toggle plan below.
  - `BlurMetricId` (`'variance-of-laplacian' | 'high-frequency-energy-ratio'`),
    `BLUR_METRIC_IDS` (all ids, default first — for consumer validation), and
    `blurMetricScorer(metric | undefined)` — resolves an id to its scoring
    function; `undefined`/unknown ⇒ `sharpnessScore` (pre-toggle behavior).
    The recorder worker MUST resolve through this (never read
    `config.blurMetric` directly) so the mapping stays unit-tested.
  - `rgbaToGrayscale(rgba): Uint8ClampedArray` — Rec. 601 luma per pixel; feeds
    `sharpnessScore`. Ignores alpha and any partial trailing pixel.
  - `meanLuminance(rgba): number` — mean Rec. 601 luma on a 0–255 scale.
    Near-zero ⇒ black/empty. `0` for an empty buffer.
  - `ImageQualityGate` — stateful (but pure) verdict policy with the rolling
    sharpness history. `evaluate(sharpness, meanLuminance, config): QualityVerdict`,
    `historyLength()`, `reset()`.
  - `QualityFilterConfig` / `DEFAULT_QUALITY_FILTER` — the **shared** config type
    carried by both `ImageCaptureConfig` and `ImageCaptureOptions` (mirrors how
    `MotionFilterConfig` is shared, so the two cannot drift).
  - `QualityVerdict` (`{ accept, reason, sharpness, meanLuminance }`),
    `QualityRejectReason` (`'black' | 'blurry'`).
  - `DEFAULT_SHARPNESS_HISTORY_SIZE` (15), `DEFAULT_SHARPNESS_MIN_SAMPLES` (3).

- **Invariants & assumptions:**
  - **Blackness is absolute, blur is relative.** Black is black regardless of
    scene, so `meanLuminance < minMeanLuminance` ⇒ reject `'black'`. Blur is
    scene-dependent (a focused blank wall scores low), so a frame is `'blurry'`
    only when `sharpness < blurRelativeThreshold · median(recentNonBlack)`.
  - **Cold start accepts.** Before `minSamples` non-black frames exist there is no
    baseline, so every non-black frame is accepted — same "no data ⇒ don't block"
    rule as the motion gate's empty window. `minSamples` is **clamped to
    `historySize`** in the constructor (PR #124/#127 review): the rolling window
    never grows past `historySize`, so an unclamped larger `minSamples` could
    never be reached and the blur check would silently never arm.
  - **A black frame never pollutes the baseline.** Its ~0 sharpness is NOT
    recorded; otherwise it would drag the median down and disarm the blur check.
  - A non-black frame's sharpness (accepted OR blurry-rejected) IS recorded, so a
    genuinely softening scene gradually lowers the bar — the §10 "retry storm"
    regime where the manager's `maxWaitMs` fallback then guarantees progress.
  - `sharpnessScore` is **non-negative**, **invariant to a uniform brightness
    offset** (the Laplacian cancels the DC term), and **scales as s²** under
    intensity scaling (proven in the property tests).
  - `enabled` is NOT consulted here — the verdict is metric-only. Whether the
    gate runs at all is decided upstream (the recorder injects `analyzeFrame`
    only when `qualityFilter.enabled`; the manager runs it only when present).
  - `QualityFilterConfig.blurMetric` is **optional** (backward compatibility
    with persisted pre-toggle configs); the gate's relative rule
    (`score < k · median(recent)`) is metric-agnostic, and the rolling history
    resets per recording, so switching metrics never mixes score scales.
  - Default `enabled: false` (plan §10) — a mis-tuned blur threshold silently
    dropping good frames is worse than the motion gate's low-risk default-on.
    Numeric defaults are PLACEHOLDERS pending on-device tuning.

- **Examples:**

  ```ts
  import {
    rgbaToGrayscale,
    sharpnessScore,
    meanLuminance,
    ImageQualityGate,
    DEFAULT_QUALITY_FILTER,
  } from './image-quality.js';

  const gray = rgbaToGrayscale(rgba); // rgba from getImageData
  const sharp = sharpnessScore(gray, width, height);
  const lum = meanLuminance(rgba);

  const gate = new ImageQualityGate();
  const verdict = gate.evaluate(sharp, lum, {
    ...DEFAULT_QUALITY_FILTER,
    enabled: true,
  });
  if (!verdict.accept) {
    /* drop + retry; verdict.reason is 'black' | 'blurry' */
  }
  ```

- **Tests:** `image-quality.test.ts` (sharp vs blurred ranking, flat ⇒ 0,
  brightness invariance, defensive degenerate input; mean-luminance black/white/
  grey/empty; grayscale luma; gate cold start / relative-blur reject / black
  reject / black-doesn't-pollute / history cap / reset; FFT-ratio spectral
  cases, blur monotonicity, defensive contract, centered crop;
  `blurMetricScorer` mapping + fallback) and
  `image-quality.property.test.ts` (sharpness non-negativity, offset invariance,
  s² scaling; FFT-ratio [0,1] bounds + offset/contrast invariance;
  mean-luminance bounds + brighten-monotonicity).

- **Related docs:**
  `GpsPlusSlamJs_Docs/docs/2026-07-12-blur-metric-toggle-plan.md` (the metric
  toggle: origin, semantics, recorder wiring),
  `GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md`,
  `ar/capture-motion-gate.ts.md` (the motion gate this builds on),
  `ar/image-capture.ts.md` (the manager that consumes the verdict via the
  injected `analyzeFrame` callback).
