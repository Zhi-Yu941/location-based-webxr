/**
 * Shared median helpers (2026-07-10 quality-review A-2).
 *
 * Six private copies with two silently different semantics used to live in
 * `ar/qr-size-from-depth.ts`, `state/tracking-quality.ts`,
 * `visualization/gps-anchor.ts` (interpolating) and `ar/image-quality.ts`,
 * `ar/qr-pose-aggregation.ts`, `state/qr-detected-slice.ts` (lower-middle).
 * The two variants are deliberately separate named exports — picking the
 * wrong one is exactly the drift this consolidation prevents.
 */

/**
 * Interpolating median: mean of the two middle values for even-length input.
 * Use when a fabricated in-between value is meaningful (continuous
 * measurements: depths, accuracies, coordinates).
 *
 * Empty input → `0` (the "no samples yet" neutral the tracking-quality
 * consumer relies on; the other former copies never receive empty input).
 */
export function interpolatingMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid]!;
  const lo = sorted[mid - 1]!;
  const hi = sorted[mid]!;
  const mean = (lo + hi) / 2;
  // lo + hi can overflow to ±Infinity for huge finite middle values; the
  // half-then-add form is immune (only reached at magnitudes where halving
  // loses no precision), keeping the result within [min, max].
  return Number.isFinite(mean) ? mean : lo / 2 + hi / 2;
}

/**
 * Lower-middle median: for even-length input returns the LOWER of the two
 * middle values — always an actually-observed sample, never a fabricated
 * average. Use when selecting a representative real observation (per-axis
 * QR poses, sharpness histories).
 *
 * Empty input → `NaN` (defensive; all callers guarantee non-empty).
 */
export function lowerMedian(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}
