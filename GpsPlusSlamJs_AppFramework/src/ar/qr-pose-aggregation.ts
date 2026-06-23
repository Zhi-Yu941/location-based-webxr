/**
 * QR pose aggregation — sliding-window pose stabilization
 * (docs `2026-06-16-followup-qr-pose-stabilization-sliding-window.md`).
 *
 * Pure, device-free, store-free robust aggregation of a STATIC fiducial's pose
 * across a short sliding window of detections. A QR is static in the world, so
 * the last N world poses should be (nearly) identical — disagreement is noise,
 * which robust aggregation removes. The aggregated pose is what drives the
 * high-weight GPS vote and the debug overlay, instead of a raw single-frame pose
 * whose ROTATION can swing (the on-device symptom this targets).
 *
 * Three layers, smallest first:
 * - {@link averageRotation} — Option R1: angle-thresholded inlier set + hemisphere-
 *   aligned quaternion average. The real new work; translation already had
 *   {@link medianQrPosition} but rotation had no counterpart. Quaternion double
 *   cover (`q` ≡ `−q`) is handled explicitly — the single most common bug here.
 * - {@link aggregateQrPose} — per-axis median position + R1 rotation, reporting
 *   the spreads + inlier count the stability gate needs.
 * - {@link evaluateQrPoseStability} — the `unknown → measuring → stable` lifecycle
 *   over the last `window` poses, mirroring the size lifecycle. The pose is only
 *   exposed (for the vote / overlay) once `stable`.
 *
 * Operates on plain `Pose` lists (no slice import) so BOTH the framework
 * controller and the demo controller can reuse it, and it is unit-testable
 * without a store. The slice selectors `selectStableQrPose` /
 * `selectQrPoseStability` wrap these over a marker's ring buffer.
 *
 * INVARIANT: the caller must feed RAW per-detection world poses here. Never feed
 * a previously-aggregated pose back in — the window would average its own output
 * and collapse toward whatever it first locked onto (a feedback loop that defeats
 * outlier rejection). The `qrDetected` ring buffer stores raw poses for exactly
 * this reason.
 *
 * @see ./qr-pose.ts — the `Pose` type and the (raw) pose solve this aggregates.
 * @see ../state/qr-detected-slice.ts — `selectStableQrPose` / `selectQrPoseStability`.
 */

import { quat } from 'gl-matrix';
import type { Pose } from './qr-pose.js';
import type { Quaternion, Vector3 } from 'gps-plus-slam-js';
import { geodesicAngleRad } from '../utils/geodesic-angle.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Default inlier half-angle (deg) — start ~12°, confirm on device. */
export const DEFAULT_ROTATION_INLIER_ANGLE_DEG = 12;

// --- averageRotation (Option R1) ---------------------------------------

export interface AverageRotationOptions {
  /**
   * Reject samples whose geodesic angle to the reference exceeds this many
   * degrees. Default {@link DEFAULT_ROTATION_INLIER_ANGLE_DEG}.
   */
  inlierAngleDeg?: number;
  /**
   * Provisional reference rotation for the first inlier pass. When omitted, a
   * robust reference is chosen by MODE-FINDING (the sample with the most other
   * samples within the inlier threshold — the densest cluster). This matters:
   * the naive "use the latest sample" breaks exactly when the latest frame is
   * the bad one, which is the whole reason for this filter.
   */
  reference?: Quaternion;
}

export interface AverageRotationResult {
  /** Robust mean rotation, a unit quaternion `[x,y,z,w]` (canonicalized w ≥ 0). */
  quat: Quaternion;
  /** How many samples lie within the inlier threshold of the final mean. */
  inlierCount: number;
  /** Max geodesic angle (deg) among the inliers to the final mean — the spread. */
  maxAngleDeg: number;
}

type GlQuat = ReturnType<typeof quat.create>;

function toGl(q: Quaternion): GlQuat {
  const g = quat.fromValues(q[0], q[1], q[2], q[3]);
  return quat.normalize(g, g);
}

interface InlierMean {
  mean: GlQuat;
  inlierCount: number;
  maxAngleRad: number;
}

/**
 * Average the samples within `thresholdRad` of `ref`. Each inlier is flipped
 * into `ref`'s hemisphere (sign of the dot) BEFORE the linear average so the
 * double cover cannot cancel the sum; the normalized linear average equals the
 * Markley eigenvector mean for a tight cluster and needs no eigensolver.
 * Returns `null` when no sample is within threshold.
 */
function meanOfInliers(
  samples: readonly GlQuat[],
  ref: GlQuat,
  thresholdRad: number
): InlierMean | null {
  const inliers: GlQuat[] = [];
  for (const s of samples) {
    if (geodesicAngleRad(s, ref) <= thresholdRad) inliers.push(s);
  }
  if (inliers.length === 0) return null;

  const acc = quat.fromValues(0, 0, 0, 0);
  for (const s of inliers) {
    const sign = quat.dot(s, ref) < 0 ? -1 : 1;
    acc[0] += sign * s[0];
    acc[1] += sign * s[1];
    acc[2] += sign * s[2];
    acc[3] += sign * s[3];
  }
  const mean = quat.normalize(quat.create(), acc);

  let maxAngleRad = 0;
  for (const s of inliers) {
    maxAngleRad = Math.max(maxAngleRad, geodesicAngleRad(s, mean));
  }
  return { mean, inlierCount: inliers.length, maxAngleRad };
}

/**
 * Pick the densest sample as the reference: the one with the most OTHER samples
 * within the inlier threshold. For a single rigid pose, consensus-based outlier
 * rejection degenerates to this mode-finding, and it is robust to the latest
 * sample being an outlier.
 */
function bestReference(
  samples: readonly GlQuat[],
  thresholdRad: number
): GlQuat {
  let best = samples[0] as GlQuat;
  let bestCount = -1;
  for (const cand of samples) {
    let count = 0;
    for (const s of samples) {
      if (geodesicAngleRad(s, cand) <= thresholdRad) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = cand;
    }
  }
  return best;
}

/**
 * Robust mean of a set of rotations (Option R1). Picks a reference (mode-finding,
 * or `options.reference`), rejects samples beyond the angular threshold, averages
 * the inliers, then does ONE refit pass against the provisional mean. Returns
 * `null` for an empty input.
 */
export function averageRotation(
  quats: readonly Quaternion[],
  options: AverageRotationOptions = {}
): AverageRotationResult | null {
  if (quats.length === 0) return null;
  const thresholdRad =
    (options.inlierAngleDeg ?? DEFAULT_ROTATION_INLIER_ANGLE_DEG) * DEG2RAD;

  const samples = quats.map(toGl);
  const reference = options.reference
    ? toGl(options.reference)
    : bestReference(samples, thresholdRad);

  // Pass 1: inliers vs the provisional reference → provisional mean.
  const provisional = meanOfInliers(samples, reference, thresholdRad);
  if (!provisional) return null;
  // Pass 2 (one refit): re-select inliers vs the provisional mean.
  const refined =
    meanOfInliers(samples, provisional.mean, thresholdRad) ?? provisional;

  // Canonicalize w ≥ 0 for a deterministic representative (q ≡ −q anyway).
  const m = refined.mean;
  const s = m[3] < 0 ? -1 : 1;
  return {
    quat: [s * m[0], s * m[1], s * m[2], s * m[3]],
    inlierCount: refined.inlierCount,
    maxAngleDeg: refined.maxAngleRad * RAD2DEG,
  };
}

// --- per-axis median position ------------------------------------------

/** Per-axis median of a numeric list (lower-middle for even n, matching
 * `medianQrPosition` in the slice so the two agree on the same data). */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted[mid] as number;
}

function medianPosition(positions: readonly Vector3[]): Vector3 {
  return [
    medianOf(positions.map((p) => p[0])),
    medianOf(positions.map((p) => p[1])),
    medianOf(positions.map((p) => p[2])),
  ];
}

/** Max absolute per-axis deviation from `center` across all positions. */
function translationSpread(
  positions: readonly Vector3[],
  center: Vector3
): number {
  let max = 0;
  for (const p of positions) {
    max = Math.max(
      max,
      Math.abs(p[0] - center[0]),
      Math.abs(p[1] - center[1]),
      Math.abs(p[2] - center[2])
    );
  }
  return max;
}

// --- aggregateQrPose ---------------------------------------------------

export interface AggregateQrPoseResult {
  /** Filtered pose: per-axis median position + robust mean rotation. */
  pose: Pose;
  /** Max absolute per-axis deviation from the median position (meters). */
  translationSpreadM: number;
  /** Max geodesic angle among rotation inliers to the mean (degrees). */
  rotationSpreadDeg: number;
  /** Rotation inlier count (≤ pose count). */
  inlierCount: number;
}

/**
 * Aggregate a window of raw poses into one filtered pose + the spreads the
 * stability gate consumes. Returns `null` for an empty window.
 */
export function aggregateQrPose(
  poses: readonly Pose[],
  options: AverageRotationOptions = {}
): AggregateQrPoseResult | null {
  if (poses.length === 0) return null;
  const positions = poses.map((p) => p.position);
  const position = medianPosition(positions);
  const rotation = averageRotation(
    poses.map((p) => p.rotation),
    options
  );
  // averageRotation only returns null for an empty input, already guarded.
  if (!rotation) return null;
  return {
    pose: { position, rotation: rotation.quat },
    translationSpreadM: translationSpread(positions, position),
    rotationSpreadDeg: rotation.maxAngleDeg,
    inlierCount: rotation.inlierCount,
  };
}

// --- pose-stability lifecycle ------------------------------------------

/**
 * Where the pose-stability gate sits for one marker, mirroring the size
 * lifecycle (`QrSizeStatus`):
 * - `unknown` — no observations yet.
 * - `measuring` — observations accumulating but not enough / not converged.
 * - `stable` — ≥ `minObservations` AND both spreads below threshold; the pose
 *   may now drive the high-weight vote / the smooth overlay.
 */
export type QrPoseStabilityStatus = 'unknown' | 'measuring' | 'stable';

export interface QrPoseStabilityOptions extends AverageRotationOptions {
  /** Sliding-window size: aggregate only the last `window` poses. Default 8. */
  window?: number;
  /** Minimum observations before the gate can be `stable`. Default 5. */
  minObservations?: number;
  /** Max translation spread (m) allowed for `stable`. Default 0.03. */
  maxTranslationSpreadM?: number;
  /** Max rotation spread (deg) allowed for `stable`. Default 5. */
  maxRotationSpreadDeg?: number;
}

export interface QrPoseStability {
  status: QrPoseStabilityStatus;
  /** The filtered pose (present once there is ≥1 observation), else `null`. */
  pose: Pose | null;
  translationSpreadM: number;
  rotationSpreadDeg: number;
  inlierCount: number;
  /** Observations actually aggregated (≤ `window`). */
  sampleCount: number;
}

const UNKNOWN_STABILITY: QrPoseStability = {
  status: 'unknown',
  pose: null,
  translationSpreadM: 0,
  rotationSpreadDeg: 0,
  inlierCount: 0,
  sampleCount: 0,
};

/**
 * Evaluate the pose-stability lifecycle over the last `window` of `poses`
 * (oldest→newest). The returned `pose` is the filtered aggregate whenever there
 * is data, but it is only the gate's responsibility (`status === 'stable'`) to
 * decide when a consumer may TRUST it for the vote — `selectStableQrPose` reads
 * the pose only in the `stable` state.
 */
export function evaluateQrPoseStability(
  poses: readonly Pose[],
  options: QrPoseStabilityOptions = {}
): QrPoseStability {
  const {
    window = 8,
    minObservations = 5,
    maxTranslationSpreadM = 0.03,
    maxRotationSpreadDeg = 5,
  } = options;
  if (poses.length === 0) return { ...UNKNOWN_STABILITY };

  const windowPoses =
    poses.length > window ? poses.slice(poses.length - window) : poses;
  const agg = aggregateQrPose(windowPoses, options);
  if (!agg) return { ...UNKNOWN_STABILITY };

  const converged =
    windowPoses.length >= minObservations &&
    agg.translationSpreadM <= maxTranslationSpreadM &&
    agg.rotationSpreadDeg <= maxRotationSpreadDeg;

  return {
    status: converged ? 'stable' : 'measuring',
    pose: agg.pose,
    translationSpreadM: agg.translationSpreadM,
    rotationSpreadDeg: agg.rotationSpreadDeg,
    inlierCount: agg.inlierCount,
    sampleCount: windowPoses.length,
  };
}
