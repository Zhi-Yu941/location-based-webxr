/**
 * QR size measurer — the composable depth→size piece shared by the QR demo and
 * (next) the Recorder (framework-wiring-options Part B, Option 2).
 *
 * Bundles the per-detection depth sampling + the per-marker running-median
 * accumulator that previously lived inside the demo's controller, so BOTH apps
 * wire one measurer instead of re-implementing the loop:
 *
 *   detection corners (px) + frame size + a depth context
 *     → sample depth at the 4 corners + the centroid (interior)
 *     → {@link estimateQrSizeFromDepth} (one observation)
 *     → per-`text` {@link QrSizeAccumulator}.add → the size lifecycle estimate
 *
 * It is intentionally **pose-agnostic**: it returns the sampled corner depth
 * points so a *future* consumer that wants a depth-fit pose could unproject them
 * without re-sampling. Current consumers (the demo and the Recorder) solve pose
 * via PnP and ignore them. Promoting a rigid depth-corner *pose* fit into the
 * framework is a separate follow-up (the demo's earlier `pose-from-corners`
 * experiment was deleted once on-device confirmed PnP translation is robust).
 *
 * @see qr-size-from-depth.ts — the per-observation estimate + the accumulator.
 * @see depth-unprojection.ts — `DepthUnprojector`.
 */

import type { Point2 } from './qr-pose.js';
import type { DepthPoint } from '../../types/ar-types.js';
import type { DepthUnprojector } from '../depth-unprojection.js';
import {
  estimateQrSizeFromDepth,
  estimateQrSizeFromDepthDense,
  createQrSizeAccumulator,
  type QrSizeAccumulator,
  type QrSizeAccumulatorOptions,
  type QrSizeEstimate,
  type ScreenPoint,
} from './qr-size-from-depth.js';

const EPS = 1e-9;

/**
 * Robustness knobs for the depth-at-corners stage (on top of the accumulator
 * options). QR corners sit on a high-contrast print boundary where the coarse
 * WebXR depth grid often has no near reading; these let a measurement still
 * succeed instead of returning `null` every frame.
 */
export interface QrSizeMeasurerOptions extends QrSizeAccumulatorOptions {
  /**
   * Points-per-side of the interior depth lattice sampled across the QR quad for
   * the PRIMARY dense plane-fit estimate (WS-A). `latticeSize × latticeSize`
   * points are sampled strictly inside the quad; reads with no depth are
   * skipped. Default `7` (≤49 reads). Set to a small value (or rely on the
   * corner fallback) to disable dense sampling. See {@link estimateQrSizeFromDepthDense}.
   */
  latticeSize?: number;
  /**
   * When a corner pixel has no depth, retry at points inset toward the centroid
   * by these fractions (in order) and borrow the first valid depth — keeping the
   * TRUE corner screen position so the measured size is not shrunk. Default
   * `[0.12, 0.25]`. Set to `[]` to disable inset fallback. Used by the corner-
   * based FALLBACK estimate (when the interior lattice is too sparse for a fit).
   */
  cornerInsetFractions?: number[];
  /**
   * Max corners whose depth may be reconstructed by a planar fit through the
   * other three when still missing after the inset fallback. Default `1`
   * (tolerate one un-sampleable corner); `0` disables reconstruction. Used by
   * the corner-based FALLBACK estimate.
   */
  maxReconstructedCorners?: number;
}

/** The per-frame depth access the measurer needs (a subset of the demo's `DepthContext`). */
export interface QrSizeDepthContext {
  /** Depth (m) at a normalized screen point, or `null` if unavailable there. */
  depthAt: (screenX: number, screenY: number) => number | null;
  /** Unprojector for the current depth sample (`createDepthUnprojector`). */
  unprojector: DepthUnprojector;
}

/** Minimal frame dimensions needed to normalize pixel corners to screen coords. */
export interface ImageSize {
  width: number;
  height: number;
}

/** One measurement: the accumulated estimate plus the raw depth samples used. */
export interface QrSizeMeasurement {
  /** The per-marker running estimate AFTER folding in this observation. */
  estimate: QrSizeEstimate;
  /**
   * The 4 corner depth samples (detector order, normalized screen coords),
   * best-effort. `null` when corner depth could not be sampled (e.g. a small QR
   * whose corners fall between depth nodes) but the dense interior fit still
   * produced an estimate — the dense path does not need corner depths.
   */
  cornerSamples: [DepthPoint, DepthPoint, DepthPoint, DepthPoint] | null;
  /**
   * The interior depth reads used for the estimate: the dense lattice on the
   * primary path, or the single centroid sample on the corner-based fallback
   * (may be empty).
   */
  interiorSamples: DepthPoint[];
}

export interface QrSizeMeasurer {
  /**
   * Measure one detection's size from depth and fold it into the per-`text`
   * accumulator. The PRIMARY path is the dense plane fit (WS-A): sample an
   * interior lattice, fit the QR plane, recover the corners by ray-plane
   * intersection. When the lattice is too sparse for a fit it FALLS BACK to the
   * corner-based estimate (corner depths + inset/reconstruct robustness).
   *
   * Returns `null` only when neither path can run — `corners.length !== 4`, or
   * the interior lattice yields too few reads AND the corner depths cannot be
   * sampled (≥2 corners missing). A degenerate quad does not throw: the (null)
   * observation is simply not accumulated and the prior estimate stands.
   */
  measure(
    text: string,
    corners: readonly Point2[],
    image: ImageSize,
    ctx: QrSizeDepthContext
  ): QrSizeMeasurement | null;
  /** Current estimate for a marker without adding a sample. */
  current(text: string): QrSizeEstimate;
  /** Drop one marker's samples (`text` given) or all of them. */
  reset(text?: string): void;
}

/** Pixel corner → normalized screen point for the given frame. */
function toScreen(corner: Point2, image: ImageSize): { x: number; y: number } {
  return { x: corner.x / image.width, y: corner.y / image.height };
}

/**
 * Depth at a corner with inset fallback: try the corner pixel first, then points
 * progressively inset toward the centroid. The returned {@link DepthPoint} always
 * carries the TRUE corner's screen position — only the depth VALUE may be borrowed
 * from an inset sample (valid because the marker face is locally planar over the
 * few-percent inset) — so the unprojected square keeps its real size. `null` when
 * no inset offers a depth read either.
 */
function sampleCornerDepth(
  corner: Point2,
  centroid: Point2,
  image: ImageSize,
  depthAt: QrSizeDepthContext['depthAt'],
  insetFractions: readonly number[]
): DepthPoint | null {
  const s = toScreen(corner, image);
  const exact = depthAt(s.x, s.y);
  if (exact !== null) return { screenX: s.x, screenY: s.y, depthM: exact };
  for (const f of insetFractions) {
    const inset = {
      x: corner.x + f * (centroid.x - corner.x),
      y: corner.y + f * (centroid.y - corner.y),
    };
    const si = toScreen(inset, image);
    const depthM = depthAt(si.x, si.y);
    // Report at the true corner position with the borrowed depth.
    if (depthM !== null) return { screenX: s.x, screenY: s.y, depthM };
  }
  return null;
}

/**
 * Estimate a missing corner's depth by fitting a plane `depth = f(screenX,
 * screenY)` through three known corner samples and evaluating it at the missing
 * corner's screen position. `null` when the three are collinear in screen space
 * (degenerate plane).
 */
function reconstructDepth(
  known: readonly DepthPoint[],
  at: { x: number; y: number }
): number | null {
  if (known.length < 3) return null;
  const [a, b, c] = known as [DepthPoint, DepthPoint, DepthPoint];
  const abx = b.screenX - a.screenX;
  const aby = b.screenY - a.screenY;
  const abz = b.depthM - a.depthM;
  const acx = c.screenX - a.screenX;
  const acy = c.screenY - a.screenY;
  const acz = c.depthM - a.depthM;
  // Plane normal = AB × AC; nz is the screen-space Jacobian determinant.
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  if (Math.abs(nz) < EPS) return null;
  const depthM =
    a.depthM - (nx * (at.x - a.screenX) + ny * (at.y - a.screenY)) / nz;
  return Number.isFinite(depthM) ? depthM : null;
}

/**
 * Build the 4 corner depth samples with inset fallback and at-most-`maxRecon`
 * planar reconstruction. `null` when more corners than allowed lack a depth read.
 */
function cornerDepthPoints(
  corners: readonly Point2[],
  image: ImageSize,
  depthAt: QrSizeDepthContext['depthAt'],
  insetFractions: readonly number[],
  maxRecon: number
): [DepthPoint, DepthPoint, DepthPoint, DepthPoint] | null {
  if (corners.length !== 4) return null;
  const centroid = {
    x: corners.reduce((s, c) => s + c.x, 0) / corners.length,
    y: corners.reduce((s, c) => s + c.y, 0) / corners.length,
  };
  const sampled = corners.map((corner) =>
    sampleCornerDepth(corner, centroid, image, depthAt, insetFractions)
  );
  const missing = sampled.filter((p) => p === null).length;
  if (missing === 0) {
    return sampled as [DepthPoint, DepthPoint, DepthPoint, DepthPoint];
  }
  if (missing > maxRecon) return null;

  // Reconstruct each missing corner's depth from the planar fit of the known
  // ones, at the true corner screen position.
  const known = sampled.filter((p): p is DepthPoint => p !== null);
  const out: DepthPoint[] = [];
  for (let i = 0; i < 4; i++) {
    const s = sampled[i];
    if (s) {
      out.push(s);
      continue;
    }
    const at = toScreen(corners[i] as Point2, image);
    const depthM = reconstructDepth(known, at);
    if (depthM === null) return null;
    out.push({ screenX: at.x, screenY: at.y, depthM });
  }
  return out as [DepthPoint, DepthPoint, DepthPoint, DepthPoint];
}

/**
 * Sample an `n×n` interior lattice across the detected quad (bilinear in pixel
 * space, strictly inside via `(i+0.5)/n` fractions so the high-contrast print
 * boundary is avoided) and return the reads that have depth. These feed the
 * dense plane fit; reads with no depth are simply skipped.
 */
function latticeDepthPoints(
  corners: readonly Point2[],
  image: ImageSize,
  depthAt: QrSizeDepthContext['depthAt'],
  n: number
): DepthPoint[] {
  if (corners.length !== 4 || n < 1) return [];
  const [tl, tr, br, bl] = corners as [Point2, Point2, Point2, Point2];
  const out: DepthPoint[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const topX = tl.x + (tr.x - tl.x) * u;
    const topY = tl.y + (tr.y - tl.y) * u;
    const botX = bl.x + (br.x - bl.x) * u;
    const botY = bl.y + (br.y - bl.y) * u;
    for (let j = 0; j < n; j++) {
      const v = (j + 0.5) / n;
      const px = topX + (botX - topX) * v;
      const py = topY + (botY - topY) * v;
      const s = toScreen({ x: px, y: py }, image);
      const depthM = depthAt(s.x, s.y);
      if (depthM !== null) out.push({ screenX: s.x, screenY: s.y, depthM });
    }
  }
  return out;
}

/** The 4 corner screen positions (detector order) for the dense ray-plane fit. */
function cornerScreens(
  corners: readonly Point2[],
  image: ImageSize
): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] | null {
  if (corners.length !== 4) return null;
  return corners.map((c) => {
    const s = toScreen(c, image);
    return { screenX: s.x, screenY: s.y };
  }) as [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
}

/** The QR centroid as a single interior depth sample (may be empty). */
function interiorDepthPoints(
  corners: readonly Point2[],
  image: ImageSize,
  depthAt: QrSizeDepthContext['depthAt']
): DepthPoint[] {
  const cx = corners.reduce((s, c) => s + c.x, 0) / corners.length;
  const cy = corners.reduce((s, c) => s + c.y, 0) / corners.length;
  const s = toScreen({ x: cx, y: cy }, image);
  const depthM = depthAt(s.x, s.y);
  return depthM === null ? [] : [{ screenX: s.x, screenY: s.y, depthM }];
}

/**
 * Create a size measurer. Accumulator `options` (quality threshold, min samples,
 * spread, cap) are forwarded to every per-marker {@link createQrSizeAccumulator};
 * the depth-at-corners knobs ({@link QrSizeMeasurerOptions.cornerInsetFractions},
 * {@link QrSizeMeasurerOptions.maxReconstructedCorners}) tune corner sampling.
 */
export function createQrSizeMeasurer(
  options: QrSizeMeasurerOptions = {}
): QrSizeMeasurer {
  const insetFractions = options.cornerInsetFractions ?? [0.12, 0.25];
  const maxRecon = options.maxReconstructedCorners ?? 1;
  const latticeSize = options.latticeSize ?? 7;
  const accumulators = new Map<string, QrSizeAccumulator>();

  function accumulatorFor(text: string): QrSizeAccumulator {
    let acc = accumulators.get(text);
    if (!acc) {
      acc = createQrSizeAccumulator(options);
      accumulators.set(text, acc);
    }
    return acc;
  }

  return {
    measure(text, corners, image, ctx): QrSizeMeasurement | null {
      const screens = cornerScreens(corners, image);
      if (!screens) return null; // corners.length !== 4

      // Best-effort corner depths (returned + used by the fallback). May be null
      // for a small QR whose corners fall between depth nodes.
      const cornerSamples = cornerDepthPoints(
        corners,
        image,
        ctx.depthAt,
        insetFractions,
        maxRecon
      );

      // PRIMARY: dense plane fit from an interior lattice — independent of
      // corner depth availability, robust to tilt and depth outliers.
      const lattice = latticeDepthPoints(
        corners,
        image,
        ctx.depthAt,
        latticeSize
      );
      let observation = estimateQrSizeFromDepthDense(
        screens,
        lattice,
        ctx.unprojector
      );
      let interiorSamples: DepthPoint[] = lattice;

      if (observation === null) {
        // FALLBACK: corner-based estimate when the lattice is too sparse to fit.
        if (!cornerSamples) return null; // can't sample enough depth at all
        interiorSamples = interiorDepthPoints(corners, image, ctx.depthAt);
        observation = estimateQrSizeFromDepth(
          cornerSamples,
          interiorSamples,
          ctx.unprojector
        );
      }

      const estimate = accumulatorFor(text).add(observation);
      return { estimate, cornerSamples, interiorSamples };
    },
    current(text): QrSizeEstimate {
      return accumulatorFor(text).current();
    },
    reset(text?: string): void {
      if (text === undefined) {
        accumulators.clear();
      } else {
        accumulators.delete(text);
      }
    },
  };
}
