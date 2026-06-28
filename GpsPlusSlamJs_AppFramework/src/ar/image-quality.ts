/**
 * Image-quality metrics + the drop/retry verdict policy for the image-content
 * capture gate (blur + blackness), the increment layered ON TOP of the motion
 * gate (`capture-motion-gate.ts`).
 *
 * Everything here is **pure and deterministic** — plain typed-array math plus a
 * tiny rolling-history class. There is **no DOM and no Web Worker** in this
 * module: it is fully unit-testable with synthetic buffers, and the recorder's
 * `image-quality.worker.ts` is a thin shell that decodes a frame to pixels and
 * calls into these functions. Keeping the verdict/history policy here (rather
 * than inside the worker, as the original plan §8 sketched) honours the project
 * rule that no untested logic ships: the worker is the device layer and is not
 * unit-built, so the median/threshold decision must live where tests can pin it.
 *
 * Metrics:
 *  - {@link sharpnessScore} — variance of the Laplacian over a grayscale buffer
 *    (the standard Pech-Pacheco focus measure). Scene-dependent in absolute
 *    terms, so the gate compares it RELATIVE to a rolling median (§5).
 *  - {@link meanLuminance} — mean Rec. 601 luma of an RGBA buffer. Near-zero ⇒
 *    black/empty frame; an absolute cutoff is safe because "black is black"
 *    regardless of scene texture (§5).
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md
 * @see ./capture-motion-gate.ts — the motion gate this builds on (same shape:
 *   a shared config type + a small stateful window + a pure decision).
 */

/**
 * User-/consumer-facing configuration for the image-quality gate. Shared by both
 * config shapes that carry it — `ImageCaptureConfig` (what `ImageCaptureManager`
 * consumes) and `ImageCaptureOptions` (the persisted recorder options) — so the
 * one definition cannot drift between them, exactly as `MotionFilterConfig` is
 * shared (see `capture-motion-gate.ts` and the motion-gate follow-up §3).
 */
export interface QualityFilterConfig {
  /** Master switch for the image-quality gate. Default `false` (see below). */
  enabled: boolean;
  /**
   * Blur cutoff as a fraction `k` of the recent sharpness median: a frame is
   * judged blurry when its sharpness `< k · median(recent)`. ~0.5 is a sensible
   * start. Relative (not absolute) because variance-of-Laplacian is
   * scene-dependent — a correctly-focused blank wall scores low (§5).
   */
  blurRelativeThreshold: number;
  /**
   * Absolute black cutoff on a 0–255 luma scale: a frame whose mean luminance is
   * below this is judged black/empty and dropped. Absolute is safe because black
   * is black regardless of scene (§5). Supersedes the byte-size
   * `MIN_VALID_IMAGE_BYTES` heuristic for correctness (kept as a cheap
   * pre-filter).
   */
  minMeanLuminance: number;
  /**
   * Never-good safety fallback: once a due capture has been retried for this many
   * ms without an acceptable frame, the next frame is saved regardless of the
   * image verdict, so a recording interval is never silently lost (mirrors the
   * motion gate's `maxWaitMs`). A sensible value is ~2× the capture interval.
   */
  maxWaitMs: number;
}

/**
 * Default image-quality configuration. **Disabled by default** (plan §10): the
 * relative blur threshold is unvalidated, and a mis-tuned gate silently dropping
 * good frames for every consumer app is worse than the motion gate's low-risk
 * default-on. Flip to `true` once the thresholds are field-tuned. The numeric
 * values are PLACEHOLDERS pending on-device tuning (record measured values in
 * implementation-progress.md). `maxWaitMs` of 4000 ms is 2× the default 2000 ms
 * image interval.
 */
export const DEFAULT_QUALITY_FILTER: QualityFilterConfig = {
  enabled: false,
  blurRelativeThreshold: 0.5,
  minMeanLuminance: 10,
  maxWaitMs: 4000,
};

/** Default number of recent (non-black) sharpness scores the gate keeps. */
export const DEFAULT_SHARPNESS_HISTORY_SIZE = 15;

/**
 * Default minimum samples before the relative blur check engages. Below this the
 * gate is in "cold start" and accepts every non-black frame — the same
 * "no baseline yet ⇒ don't block" principle the motion gate uses for an empty
 * window.
 */
export const DEFAULT_SHARPNESS_MIN_SAMPLES = 3;

/**
 * Compute the **variance of the Laplacian** of a single-channel grayscale image
 * — the standard focus measure (higher ⇒ sharper / more in-focus).
 *
 * The discrete Laplacian per interior pixel is
 * `up + down + left + right − 4·centre` (the 4-neighbour kernel); the score is
 * the variance of that response over all interior pixels. A flat/constant image
 * yields 0; a focused, textured image yields a large value.
 *
 * Defensive: returns `0` (rather than throwing or `NaN`) for any input that has
 * no interior pixels — non-integer or `< 3` dimensions, or a buffer shorter than
 * `width · height`. A tiny negative variance from floating-point cancellation is
 * clamped to 0.
 *
 * @param gray  Row-major single-channel intensities, length ≥ `width · height`.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 */
export function sharpnessScore(
  gray: Uint8Array | Uint8ClampedArray | readonly number[],
  width: number,
  height: number
): number {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 0;
  if (width < 3 || height < 3) return 0;
  if (gray.length < width * height) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const laplacian =
        gray[i - 1]! +
        gray[i + 1]! +
        gray[i - width]! +
        gray[i + width]! -
        4 * gray[i]!;
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance > 0 ? variance : 0;
}

/**
 * Convert an RGBA buffer to a single-channel grayscale (Rec. 601 luma) buffer,
 * the input {@link sharpnessScore} expects. Pure; ignores the alpha channel. A
 * partial trailing pixel (length not a multiple of 4) is ignored.
 */
export function rgbaToGrayscale(
  rgba: Uint8Array | Uint8ClampedArray
): Uint8ClampedArray {
  const pixels = Math.floor(rgba.length / 4);
  const out = new Uint8ClampedArray(pixels);
  for (let p = 0; p < pixels; p++) {
    const o = p * 4;
    out[p] = 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
  }
  return out;
}

/**
 * Mean Rec. 601 luma (`0.299R + 0.587G + 0.114B`) over an RGBA buffer, on a
 * 0–255 scale. Near-zero ⇒ black/empty frame. Alpha is ignored. Returns `0` for
 * an empty buffer.
 */
export function meanLuminance(rgba: Uint8Array | Uint8ClampedArray): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    const o = p * 4;
    sum += 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
  }
  return sum / pixels;
}

/** Reason a frame was rejected by the quality gate, or `null` when accepted. */
export type QualityRejectReason = 'black' | 'blurry';

/** Outcome of evaluating one frame against the quality gate. */
export interface QualityVerdict {
  /** `true` to save the frame, `false` to drop + retry. */
  readonly accept: boolean;
  /** Why it was dropped, or `null` when accepted. */
  readonly reason: QualityRejectReason | null;
  /** The frame's variance-of-Laplacian sharpness (for logging/tuning). */
  readonly sharpness: number;
  /** The frame's mean luminance (for logging/tuning). */
  readonly meanLuminance: number;
}

/**
 * Lower-middle median (matches the project's other `medianOf` helpers, e.g.
 * `qr-pose-aggregation.ts`). Caller guarantees a non-empty array.
 */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted[mid] as number;
}

/**
 * The self-calibrating blur+blackness verdict, with the rolling sharpness
 * history that makes the blur check scene-relative (§5). Stateful but pure (no
 * DOM/worker): one instance per recording session, fed each analysed frame's
 * metrics.
 *
 * Policy per frame ({@link evaluate}):
 *  1. **Blackness — absolute.** `meanLuminance < config.minMeanLuminance` ⇒
 *     reject `'black'`. The score is NOT recorded (a black frame's ~0 sharpness
 *     must not drag the median down and disarm the blur check).
 *  2. **Blur — relative.** Once at least `minSamples` non-black frames have been
 *     seen, reject `'blurry'` when `sharpness < blurRelativeThreshold · median`.
 *     Before that (cold start) every non-black frame is accepted.
 *  3. The non-black frame's sharpness is recorded into the rolling window
 *     (capped at `historySize`) so the median tracks the scene's texture level —
 *     including a genuinely softening scene, which gradually lowers the bar (the
 *     §10 "retry storm" regime where the fallback then guarantees progress).
 */
export class ImageQualityGate {
  private readonly history: number[] = [];
  private readonly historySize: number;
  private readonly minSamples: number;

  constructor(
    historySize: number = DEFAULT_SHARPNESS_HISTORY_SIZE,
    minSamples: number = DEFAULT_SHARPNESS_MIN_SAMPLES
  ) {
    this.historySize =
      Number.isFinite(historySize) && historySize >= 1
        ? Math.floor(historySize)
        : DEFAULT_SHARPNESS_HISTORY_SIZE;
    this.minSamples =
      Number.isFinite(minSamples) && minSamples >= 1
        ? Math.floor(minSamples)
        : DEFAULT_SHARPNESS_MIN_SAMPLES;
  }

  /**
   * Judge one frame from its precomputed metrics + the current config, updating
   * the rolling history. See the class doc for the policy.
   */
  evaluate(
    sharpness: number,
    meanLum: number,
    config: QualityFilterConfig
  ): QualityVerdict {
    // 1. Blackness — absolute, scene-independent. Do not record the score.
    if (meanLum < config.minMeanLuminance) {
      return {
        accept: false,
        reason: 'black',
        sharpness,
        meanLuminance: meanLum,
      };
    }

    // 2. Blur — relative to the established baseline (cold start accepts).
    let blurry = false;
    if (this.history.length >= this.minSamples) {
      const threshold = config.blurRelativeThreshold * medianOf(this.history);
      if (sharpness < threshold) blurry = true;
    }

    // 3. Record this non-black frame's sharpness as part of the scene baseline.
    this.history.push(sharpness);
    if (this.history.length > this.historySize) this.history.shift();

    return blurry
      ? { accept: false, reason: 'blurry', sharpness, meanLuminance: meanLum }
      : { accept: true, reason: null, sharpness, meanLuminance: meanLum };
  }

  /** Number of (non-black) sharpness samples currently retained. */
  historyLength(): number {
    return this.history.length;
  }

  /** Clear the rolling history (e.g. on a new recording session). */
  reset(): void {
    this.history.length = 0;
  }
}
