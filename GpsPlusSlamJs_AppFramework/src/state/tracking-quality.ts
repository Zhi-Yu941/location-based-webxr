/**
 * Tracking-quality reporter — public surface for "how much should the host
 * trust the current GPS↔AR alignment?".
 *
 * Implements Phase A of
 * `GpsPlusSlamJs_Docs/docs/2026-05-16-tracking-quality-metrics-plan.md`:
 *
 *  - §4.1 matrix-history convergence  → {@link computeConvergence}
 *  - §4.2 per-observation residual    → {@link computeResidualConsensus}
 *  - §4.3 compass cross-check         → {@link computeCompassAgreement}
 *  - §4.4 GPS-accuracy budget         → {@link computeGpsAccuracy}
 *  - §4.5 baseline coverage           → {@link computeCoverage}
 *  - §4.6 GPS-vs-fused divergence     → {@link computeGpsVsFusedDivergence}
 *                                       (diagnostic only)
 *  - §4.7 AR tracking phase gate      → handled inside the aggregator
 *  - aggregator + state machine       → {@link computeTrackingQualityReport}
 *
 * State placement
 * ---------------
 * The §4.1 ring buffer and the materialised report live in the
 * `trackingQuality` Redux slice (see §5b of the plan). The slice is a
 * normal RTK slice; it is fed by the listener middleware
 * {@link createTrackingQualityListenerMiddleware} which dispatches
 * {@link snapshotPushed} / {@link reportUpdated} / {@link resetTrackingQuality}
 * on the relevant input actions.
 *
 * Pure-function discipline
 * ------------------------
 * Every `compute*` helper below is a pure function over its arguments —
 * no module-level state, no closure side effects. The Investigation
 * harness imports them directly (same pattern as
 * `computeStabilityForConfig`) so the parameter sweep in §6.1 can run
 * without going through the Redux store.
 */

import type { Action, PayloadAction, Middleware } from '@reduxjs/toolkit';
import { createSlice, createListenerMiddleware } from '@reduxjs/toolkit';
import { mat4, quat, vec3 } from 'gl-matrix';
import type { GpsPoint, LatLong, Matrix4, Vector3 } from 'gps-plus-slam-js';
import { calcGpsCoords, distanceInMeters } from 'gps-plus-slam-js';
import type { CombinedRootState } from './combined-root-state';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectZeroReference,
} from './app-selectors';
import {
  selectLastSensorOrientation,
  selectLastValidPose,
  selectTrackingPhase,
  type DeviceOrientation,
} from './tracking-slice';
import type { ARPose } from '../types/ar-types';

// ===========================================================================
// Public types
// ===========================================================================

export type TrackingQualityState = 'warming-up' | 'ar-lost' | 'degraded' | 'ok';

export interface TrackingQualityReport {
  state: TrackingQualityState;
  /** 0..1, monotonically combined from {@link subScores}. */
  confidence: number;
  subScores: {
    convergence: number;
    residualConsensus: number;
    /** `null` when the device cannot supply an absolute compass heading. */
    compassAgreement: number | null;
    gpsAccuracy: number;
    coverage: number;
  };
  diagnostics: {
    recentMaxRotationDeltaDeg: number;
    recentMaxTranslationDeltaM: number;
    medianResidualM: number;
    medianRecentGpsAccuracyM: number;
    walkedDistanceM: number;
    directionSpreadDeg: number;
    /** `null` when §4.3 is unavailable (no absolute compass). */
    headingDeltaDeg: number | null;
    compassDriftDetected: boolean;
    observationsSeen: number;
    /** §4.6 — diagnostic only, never feeds the aggregate. */
    gpsVsFusedMaxDivergenceM: number;
  };
}

export interface TrackingQualityOptions {
  /** §4.1 ring-buffer length. Seed default; corpus-tuned in §6.1. */
  matrixHistorySize?: number;
  /** §4.2 GPS-window length. Seed default; corpus-tuned in §6.1. */
  residualWindowSize?: number;
  /** Confidence threshold below which `state` reports `'degraded'`. */
  degradedThreshold?: number;
  /** §4.4 window length for GPS-accuracy budget. */
  gpsAccuracyWindowSize?: number;
  /** §4.5 walked-distance threshold for coverage = 1.0. */
  coverageWalkedDistanceM?: number;
  /** §4.5 direction-spread threshold for coverage = 1.0. */
  coverageDirectionSpreadDeg?: number;
  /** §4.3 EMA threshold (deg) below which compass scores 1.0. */
  compassWarnDeg?: number;
  /** §4.3 EMA threshold (deg) above which compass scores 0.0. */
  compassFailDeg?: number;
  /** Minimum GPS observations before leaving `warming-up`. */
  warmupMinObservations?: number;
  /** Minimum coverage score before leaving `warming-up`. */
  warmupMinCoverage?: number;
  /** §4.2 residual saturation target (m). */
  residualConfidenceTargetM?: number;
  /** §4.4 GPS-accuracy floor used to normalise residuals (m). */
  gpsAccuracyFloorM?: number;
}

export const DEFAULT_TRACKING_QUALITY_OPTIONS: Required<TrackingQualityOptions> =
  {
    matrixHistorySize: 10, // §4.1 seed (corpus sweep: 5–20)
    residualWindowSize: 8, // §4.2 seed (corpus sweep: 4–16)
    degradedThreshold: 0.5,
    gpsAccuracyWindowSize: 8,
    coverageWalkedDistanceM: 15,
    coverageDirectionSpreadDeg: 90,
    compassWarnDeg: 15,
    compassFailDeg: 35,
    warmupMinObservations: 10,
    warmupMinCoverage: 0.5,
    residualConfidenceTargetM: 3,
    gpsAccuracyFloorM: 1,
  };

// ---------------------------------------------------------------------------
// Slice state
// ---------------------------------------------------------------------------

/**
 * Single buffered alignment matrix snapshot. `matrix` is stored as a
 * plain `number[]` (length 16, row-major) so it stays serializable for
 * RTK's `SerializableStateInvariantMiddleware` and for action logs.
 */
export interface AlignmentSnapshot {
  observationIndex: number;
  matrix: number[];
}

export interface TrackingQualitySliceState {
  recentAlignments: AlignmentSnapshot[];
  firstAgreementObservationIndex: number | null;
  report: TrackingQualityReport | null;
}

const initialState: TrackingQualitySliceState = {
  recentAlignments: [],
  firstAgreementObservationIndex: null,
  report: null,
};

// ===========================================================================
// Pure compute helpers
// ===========================================================================

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function wrapToHalfCircle(deg: number): number {
  let d = ((deg + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

function bearingDeg(north: number, east: number): number {
  // ENU bearing: 0° = North, 90° = East, range [0, 360).
  const rad = Math.atan2(east, north);
  let deg = (rad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Linear ramp: `value ≤ low` → 1, `value ≥ high` → 0, linear between.
 * Used by sub-scores whose underlying physical quantity grows as
 * quality drops (e.g. residuals, heading delta).
 */
function rampDown(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return 0;
  if (high <= low) return value <= low ? 1 : 0;
  if (value <= low) return 1;
  if (value >= high) return 0;
  return 1 - (value - low) / (high - low);
}

/**
 * Linear ramp: `value ≤ low` → 0, `value ≥ high` → 1, linear between.
 * Used by sub-scores whose underlying quantity grows as quality
 * improves (e.g. walked distance, direction spread).
 */
function rampUp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return 0;
  if (high <= low) return value >= high ? 1 : 0;
  if (value <= low) return 0;
  if (value >= high) return 1;
  return (value - low) / (high - low);
}

// ---------------------------------------------------------------------------
// §4.1 convergence
// ---------------------------------------------------------------------------

export interface ConvergenceResult {
  score: number;
  recentMaxRotationDeltaDeg: number;
  recentMaxTranslationDeltaM: number;
  /** Pair count used (≥ 2 snapshots ⇒ ≥ 1 pair, else 0). */
  pairCount: number;
}

/**
 * §4.1 matrix-history convergence over the buffered snapshots.
 *
 * Reuses the same kernel idea as `computeStabilityDelta` from the
 * Investigation helpers (rotation + translation delta between two 4×4
 * matrices). With 0 or 1 snapshot we return score 0 — convergence is
 * undefined until at least one consecutive pair exists.
 */
export function computeConvergence(
  snapshots: readonly AlignmentSnapshot[],
  options: { rotationWarnDeg?: number; translationWarnM?: number } = {}
): ConvergenceResult {
  const rotWarn = options.rotationWarnDeg ?? 3;
  const transWarn = options.translationWarnM ?? 0.5;
  const rotFail = rotWarn * 4;
  const transFail = transWarn * 4;

  if (snapshots.length < 2) {
    return {
      score: 0,
      recentMaxRotationDeltaDeg: 0,
      recentMaxTranslationDeltaM: 0,
      pairCount: 0,
    };
  }

  let maxRotDeg = 0;
  let maxTransM = 0;
  let pairCount = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      snapshots[i - 1].matrix,
      snapshots[i].matrix
    );
    if (rotationDeltaDeg > maxRotDeg) maxRotDeg = rotationDeltaDeg;
    if (translationDeltaM > maxTransM) maxTransM = translationDeltaM;
    pairCount += 1;
  }

  const rotScore = rampDown(maxRotDeg, rotWarn, rotFail);
  const transScore = rampDown(maxTransM, transWarn, transFail);
  return {
    score: Math.min(rotScore, transScore),
    recentMaxRotationDeltaDeg: maxRotDeg,
    recentMaxTranslationDeltaM: maxTransM,
    pairCount,
  };
}

/**
 * Rotation and translation delta between two 4×4 alignment matrices in
 * the column-major layout that gl-matrix and the framework use.
 *
 * Rotation: extract the orientation quaternion with `mat4.getRotation`
 * and compute the relative angle via `quat.getAngle` (degrees).
 * Translation: extract the origin column with `mat4.getTranslation` and
 * compute the Euclidean distance.
 *
 * This is the **single shared kernel** for the AppFramework reporter and
 * the Investigation harness (see §11 (a) of the tracking-quality plan).
 * `GpsPlusSlamJs_Investigation/src/investigation-helpers.ts` re-exports
 * `computeStabilityDelta` as a thin wrapper around this function so the
 * §6.1 corpus sweep and the runtime convergence score share one numeric
 * definition.
 */
export function matrixDelta(
  prev: readonly number[],
  curr: readonly number[]
): { rotationDeltaDeg: number; translationDeltaM: number } {
  if (prev.length !== 16 || curr.length !== 16) {
    return { rotationDeltaDeg: 0, translationDeltaM: 0 };
  }
  const prevMat = mat4.fromValues(
    prev[0],
    prev[1],
    prev[2],
    prev[3],
    prev[4],
    prev[5],
    prev[6],
    prev[7],
    prev[8],
    prev[9],
    prev[10],
    prev[11],
    prev[12],
    prev[13],
    prev[14],
    prev[15]
  );
  const currMat = mat4.fromValues(
    curr[0],
    curr[1],
    curr[2],
    curr[3],
    curr[4],
    curr[5],
    curr[6],
    curr[7],
    curr[8],
    curr[9],
    curr[10],
    curr[11],
    curr[12],
    curr[13],
    curr[14],
    curr[15]
  );
  const prevQuat = quat.create();
  const currQuat = quat.create();
  mat4.getRotation(prevQuat, prevMat);
  mat4.getRotation(currQuat, currMat);
  quat.normalize(prevQuat, prevQuat);
  quat.normalize(currQuat, currQuat);
  // quat.getAngle can return NaN when the quaternions are nearly identical
  // (dot product slightly > 1.0 due to float precision → acos(>1) = NaN).
  const angleRad = quat.getAngle(prevQuat, currQuat);
  const rotationDeltaDeg = Number.isNaN(angleRad)
    ? 0
    : (angleRad * 180) / Math.PI;
  const prevT = vec3.create();
  const currT = vec3.create();
  mat4.getTranslation(prevT, prevMat);
  mat4.getTranslation(currT, currMat);
  const translationDeltaM = vec3.distance(prevT, currT);
  return { rotationDeltaDeg, translationDeltaM };
}

// ---------------------------------------------------------------------------
// §4.2 residual consensus
// ---------------------------------------------------------------------------

export interface ResidualConsensusResult {
  score: number;
  medianResidualM: number;
  count: number;
}

/**
 * §4.2 — Median residual between the last `K` GPS observations and the
 * positions you would have predicted by transforming the matching
 * odometry positions through the current alignment matrix.
 *
 * Returns `score = 0`, `medianResidualM = 0` when we have fewer than
 * 2 paired observations or when the alignment matrix / zero ref is
 * not yet set.
 */
export function computeResidualConsensus(
  alignmentMatrix: Matrix4 | null,
  gpsPositions: readonly GpsPoint[],
  odometryPositions: readonly Vector3[],
  zeroRef: LatLong | null,
  options: Pick<
    Required<TrackingQualityOptions>,
    'residualWindowSize' | 'residualConfidenceTargetM' | 'gpsAccuracyFloorM'
  > = {
    residualWindowSize: DEFAULT_TRACKING_QUALITY_OPTIONS.residualWindowSize,
    residualConfidenceTargetM:
      DEFAULT_TRACKING_QUALITY_OPTIONS.residualConfidenceTargetM,
    gpsAccuracyFloorM: DEFAULT_TRACKING_QUALITY_OPTIONS.gpsAccuracyFloorM,
  }
): ResidualConsensusResult {
  if (!alignmentMatrix || !zeroRef) {
    return { score: 0, medianResidualM: 0, count: 0 };
  }
  const n = Math.min(gpsPositions.length, odometryPositions.length);
  if (n < 2) return { score: 0, medianResidualM: 0, count: 0 };

  const start = Math.max(0, n - options.residualWindowSize);
  const glMat = mat4.fromValues(
    ...(alignmentMatrix as unknown as number[] as Parameters<
      typeof mat4.fromValues
    >)
  );
  const tmp = vec3.create();

  const normalised: number[] = [];
  let rawResidualSum = 0;
  let rawResidualCount = 0;
  for (let i = start; i < n; i++) {
    const odom = odometryPositions[i];
    const gps = gpsPositions[i];
    vec3.set(tmp, odom[0], odom[1], odom[2]);
    vec3.transformMat4(tmp, tmp, glMat);
    const predicted = calcGpsCoords(zeroRef, tmp as unknown as Vector3);
    const meters = distanceInMeters(predicted, {
      lat: gps.latitude,
      lon: gps.longitude,
    });
    if (!Number.isFinite(meters)) continue;
    rawResidualSum += meters;
    rawResidualCount += 1;
    const acc = Math.max(
      options.gpsAccuracyFloorM,
      gps.latLongAccuracy ?? options.gpsAccuracyFloorM
    );
    normalised.push(meters / acc);
  }

  if (normalised.length < 2) {
    return {
      score: 0,
      medianResidualM:
        rawResidualCount > 0 ? rawResidualSum / rawResidualCount : 0,
      count: normalised.length,
    };
  }
  const medianNorm = median(normalised);
  const medianResidualM = rawResidualSum / rawResidualCount;
  const score = clamp01(
    1 / (1 + medianNorm / options.residualConfidenceTargetM)
  );
  return { score, medianResidualM, count: normalised.length };
}

// ---------------------------------------------------------------------------
// §4.4 GPS-accuracy budget
// ---------------------------------------------------------------------------

export interface GpsAccuracyResult {
  score: number;
  medianM: number;
  countAccurate: number;
  countTotal: number;
}

/**
 * §4.4 — Median `latLongAccuracy` of the last `K` GPS points, with
 * an "accurate-fix count" diagnostic. Cheap, always available.
 *
 * `score` ramps from 1.0 at median ≤ 3 m to 0.0 at median ≥ 25 m
 * (linear), matching the plan's "≤ 5 m is good" heuristic with a
 * generous fail tail.
 */
export function computeGpsAccuracy(
  gpsPositions: readonly GpsPoint[],
  options: {
    windowSize?: number;
    goodMedianM?: number;
    badMedianM?: number;
  } = {}
): GpsAccuracyResult {
  const windowSize =
    options.windowSize ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.gpsAccuracyWindowSize;
  const goodMedianM = options.goodMedianM ?? 3;
  const badMedianM = options.badMedianM ?? 25;
  if (gpsPositions.length === 0) {
    return { score: 0, medianM: 0, countAccurate: 0, countTotal: 0 };
  }
  const start = Math.max(0, gpsPositions.length - windowSize);
  const accs: number[] = [];
  let countAccurate = 0;
  for (let i = start; i < gpsPositions.length; i++) {
    const acc = gpsPositions[i].latLongAccuracy;
    if (typeof acc === 'number' && Number.isFinite(acc)) {
      accs.push(acc);
      if (acc <= 5) countAccurate += 1;
    }
  }
  if (accs.length === 0) {
    return {
      score: 0,
      medianM: 0,
      countAccurate: 0,
      countTotal: gpsPositions.length - start,
    };
  }
  const medianM = median(accs);
  return {
    score: rampDown(medianM, goodMedianM, badMedianM),
    medianM,
    countAccurate,
    countTotal: accs.length,
  };
}

// ---------------------------------------------------------------------------
// §4.5 baseline coverage
// ---------------------------------------------------------------------------

export interface CoverageResult {
  score: number;
  walkedDistanceM: number;
  directionSpreadDeg: number;
}

/**
 * §4.5 — Coverage = how far the user has walked AND how diverse the
 * walking direction has been. Both required: a long but unidirectional
 * walk leaves the rotation about the walking axis under-determined.
 */
export function computeCoverage(
  odometryPositions: readonly Vector3[],
  options: {
    walkedDistanceM?: number;
    directionSpreadDeg?: number;
  } = {}
): CoverageResult {
  const wThr =
    options.walkedDistanceM ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.coverageWalkedDistanceM;
  const dThr =
    options.directionSpreadDeg ??
    DEFAULT_TRACKING_QUALITY_OPTIONS.coverageDirectionSpreadDeg;

  if (odometryPositions.length < 2) {
    return { score: 0, walkedDistanceM: 0, directionSpreadDeg: 0 };
  }

  let walked = 0;
  const bearings: number[] = [];
  for (let i = 1; i < odometryPositions.length; i++) {
    const a = odometryPositions[i - 1];
    const b = odometryPositions[i];
    const dN = b[0] - a[0];
    const dE = b[2] - a[2];
    const segLen = Math.hypot(dN, dE);
    if (!Number.isFinite(segLen) || segLen < 1e-4) continue;
    walked += segLen;
    bearings.push(bearingDeg(dN, dE));
  }

  let spread = 0;
  if (bearings.length >= 2) {
    const sorted = [...bearings].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap > maxGap) maxGap = gap;
    }
    const wrapGap = 360 - sorted[sorted.length - 1] + sorted[0];
    if (wrapGap > maxGap) maxGap = wrapGap;
    spread = Math.max(0, 360 - maxGap);
  }

  const walkScore = rampUp(walked, wThr * 0.25, wThr);
  const spreadScore = rampUp(spread, dThr * 0.25, dThr);
  return {
    score: Math.min(walkScore, spreadScore),
    walkedDistanceM: walked,
    directionSpreadDeg: spread,
  };
}

// ---------------------------------------------------------------------------
// §4.3 compass / alignment heading cross-check
// ---------------------------------------------------------------------------

export interface CompassAgreementResult {
  /** `null` when `absolute !== true` on the sensor orientation. */
  score: number | null;
  headingDeltaDeg: number | null;
}

/**
 * §4.3 — Compare the alignment matrix's mapping of AR-forward to ENU
 * against the device compass heading. Returns `score = null` whenever
 * the sensor's `absolute !== true` so the aggregate excludes the
 * sub-score (per Q2 in the plan).
 *
 * AR-forward in our `ARPose` convention is `(0, 0, -1)` (right-handed,
 * Y-up). We rotate that by the alignment's 3×3 rotation, take its
 * North/East components, and compare against the compass alpha.
 */
export function computeCompassAgreement(
  alignmentMatrix: Matrix4 | null,
  sensorOrientation: DeviceOrientation | null,
  arPose: ARPose | null,
  options: { warnDeg?: number; failDeg?: number } = {}
): CompassAgreementResult {
  const warn =
    options.warnDeg ?? DEFAULT_TRACKING_QUALITY_OPTIONS.compassWarnDeg;
  const fail =
    options.failDeg ?? DEFAULT_TRACKING_QUALITY_OPTIONS.compassFailDeg;
  if (!alignmentMatrix || !sensorOrientation || !arPose) {
    return { score: null, headingDeltaDeg: null };
  }
  if (sensorOrientation.absolute !== true) {
    return { score: null, headingDeltaDeg: null };
  }

  // AR-camera forward direction in AR-local space: rotate (0, 0, -1) by
  // the camera quaternion.
  const q = arPose.orientation;
  const fx = 0;
  const fy = 0;
  const fz = -1;
  // v' = q * v * q^-1, with q = (x, y, z, w).
  const x = q.x,
    y = q.y,
    z = q.z,
    w = q.w;
  const tx = 2 * (y * fz - z * fy);
  const ty = 2 * (z * fx - x * fz);
  const tz = 2 * (x * fy - y * fx);
  const arForwardLocal: Vector3 = [
    fx + w * tx + (y * tz - z * ty),
    fy + w * ty + (z * tx - x * tz),
    fz + w * tz + (x * ty - y * tx),
  ];

  // Transform by alignment rotation only (drop translation).
  const m = alignmentMatrix;
  const enuN =
    m[0] * arForwardLocal[0] +
    m[4] * arForwardLocal[1] +
    m[8] * arForwardLocal[2];
  const enuU =
    m[1] * arForwardLocal[0] +
    m[5] * arForwardLocal[1] +
    m[9] * arForwardLocal[2];
  const enuE =
    m[2] * arForwardLocal[0] +
    m[6] * arForwardLocal[1] +
    m[10] * arForwardLocal[2];
  void enuU;
  const horiz = Math.hypot(enuN, enuE);
  if (horiz < 1e-6) {
    // AR forward is near-vertical — heading is undefined this frame.
    return { score: null, headingDeltaDeg: null };
  }
  const alignmentHeadingDeg = bearingDeg(enuN, enuE);
  const compassHeadingDeg = sensorOrientation.alpha;
  const delta = Math.abs(
    wrapToHalfCircle(alignmentHeadingDeg - compassHeadingDeg)
  );
  return {
    score: rampDown(delta, warn, fail),
    headingDeltaDeg: delta,
  };
}

// ---------------------------------------------------------------------------
// §4.6 GPS-vs-fused divergence (diagnostic only)
// ---------------------------------------------------------------------------

/**
 * §4.6 — Maximum lateral distance between raw GPS positions and the
 * positions you would predict by transforming the matching odometry
 * positions through the current alignment. Diagnostic only — never
 * feeds the aggregate confidence per the plan.
 */
export function computeGpsVsFusedDivergence(
  alignmentMatrix: Matrix4 | null,
  gpsPositions: readonly GpsPoint[],
  odometryPositions: readonly Vector3[],
  zeroRef: LatLong | null,
  windowSize = 16
): number {
  if (!alignmentMatrix || !zeroRef) return 0;
  const n = Math.min(gpsPositions.length, odometryPositions.length);
  if (n < 2) return 0;
  const start = Math.max(0, n - windowSize);
  const glMat = mat4.fromValues(
    ...(alignmentMatrix as unknown as number[] as Parameters<
      typeof mat4.fromValues
    >)
  );
  const tmp = vec3.create();
  let maxDiv = 0;
  for (let i = start; i < n; i++) {
    const odom = odometryPositions[i];
    vec3.set(tmp, odom[0], odom[1], odom[2]);
    vec3.transformMat4(tmp, tmp, glMat);
    const predicted = calcGpsCoords(zeroRef, tmp as unknown as Vector3);
    const d = distanceInMeters(predicted, {
      lat: gpsPositions[i].latitude,
      lon: gpsPositions[i].longitude,
    });
    if (Number.isFinite(d) && d > maxDiv) maxDiv = d;
  }
  return maxDiv;
}

// ===========================================================================
// Slice
// ===========================================================================

const trackingQualitySlice = createSlice({
  name: 'trackingQuality',
  initialState,
  reducers: {
    /**
     * Push a new alignment snapshot. Idempotent: callers must only
     * dispatch when the matrix has actually changed (the listener
     * middleware enforces this).
     */
    snapshotPushed(state, action: PayloadAction<AlignmentSnapshot>) {
      state.recentAlignments.push(action.payload);
    },
    /**
     * Drop oldest snapshots until `length ≤ size`. Separate action so
     * the buffer cap can be applied after `snapshotPushed` without
     * the reducer needing to know the option value.
     */
    snapshotsTrimmed(state, action: PayloadAction<{ size: number }>) {
      const size = Math.max(1, action.payload.size | 0);
      while (state.recentAlignments.length > size) {
        state.recentAlignments.shift();
      }
    },
    reportUpdated(state, action: PayloadAction<TrackingQualityReport | null>) {
      state.report = action.payload;
    },
    firstAgreementReached(state, action: PayloadAction<number>) {
      state.firstAgreementObservationIndex = action.payload;
    },
    /** Full reset — used on new session start / tracking reset. */
    resetTrackingQuality() {
      return initialState;
    },
  },
});

export const {
  snapshotPushed,
  snapshotsTrimmed,
  reportUpdated,
  firstAgreementReached,
  resetTrackingQuality,
} = trackingQualitySlice.actions;

export const trackingQualityReducer = trackingQualitySlice.reducer;

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

interface RootWithTrackingQuality {
  trackingQuality?: TrackingQualitySliceState;
}

export function selectTrackingQuality(
  state: RootWithTrackingQuality
): TrackingQualityReport | null {
  return state.trackingQuality?.report ?? null;
}

export function selectRecentAlignments(
  state: RootWithTrackingQuality
): readonly AlignmentSnapshot[] {
  return state.trackingQuality?.recentAlignments ?? EMPTY_SNAPSHOTS;
}

export function selectFirstAgreementObservationIndex(
  state: RootWithTrackingQuality
): number | null {
  return state.trackingQuality?.firstAgreementObservationIndex ?? null;
}

const EMPTY_SNAPSHOTS: readonly AlignmentSnapshot[] = Object.freeze([]);

// ===========================================================================
// Aggregator
// ===========================================================================

/**
 * Pure function — produces a {@link TrackingQualityReport} from a root
 * state and options. The Investigation harness imports this directly to
 * sweep `(N, K)` without going through the Redux listener middleware.
 *
 * The report's `state` enum follows §5 of the plan:
 *   - `ar-lost` whenever `tracking.phase !== 'tracking'`
 *   - `warming-up` until `coverage ≥ warmupMinCoverage` AND
 *     `observationsSeen ≥ warmupMinObservations`
 *   - then `ok` / `degraded` from `min(subScores)` vs.
 *     `degradedThreshold`.
 */
export function computeTrackingQualityReport(
  rootState: CombinedRootState,
  options: TrackingQualityOptions = {}
): TrackingQualityReport {
  const opts: Required<TrackingQualityOptions> = {
    ...DEFAULT_TRACKING_QUALITY_OPTIONS,
    ...options,
  };

  const alignmentMatrix = selectAlignmentMatrix(rootState);
  const gpsPositions = selectGpsPositions(rootState);
  const odometryPositions = selectOdometryPositions(rootState);
  const zeroRef = selectZeroReference(rootState);
  const trackingPhase = selectTrackingPhase(
    rootState as Parameters<typeof selectTrackingPhase>[0]
  );
  const sensorOrientation = selectLastSensorOrientation(
    rootState as Parameters<typeof selectLastSensorOrientation>[0]
  );
  const lastPose = selectLastValidPose(
    rootState as Parameters<typeof selectLastValidPose>[0]
  );
  const snapshots = selectRecentAlignments(rootState);

  const coverage = computeCoverage(odometryPositions, {
    walkedDistanceM: opts.coverageWalkedDistanceM,
    directionSpreadDeg: opts.coverageDirectionSpreadDeg,
  });
  const gpsAccuracy = computeGpsAccuracy(gpsPositions, {
    windowSize: opts.gpsAccuracyWindowSize,
  });
  const residual = computeResidualConsensus(
    alignmentMatrix,
    gpsPositions,
    odometryPositions,
    zeroRef,
    {
      residualWindowSize: opts.residualWindowSize,
      residualConfidenceTargetM: opts.residualConfidenceTargetM,
      gpsAccuracyFloorM: opts.gpsAccuracyFloorM,
    }
  );
  const convergence = computeConvergence(snapshots);
  const compass = computeCompassAgreement(
    alignmentMatrix,
    sensorOrientation,
    lastPose
  );
  const gpsVsFusedMaxDivergenceM = computeGpsVsFusedDivergence(
    alignmentMatrix,
    gpsPositions,
    odometryPositions,
    zeroRef
  );

  const subScores = {
    convergence: clamp01(convergence.score),
    residualConsensus: clamp01(residual.score),
    compassAgreement: compass.score === null ? null : clamp01(compass.score),
    gpsAccuracy: clamp01(gpsAccuracy.score),
    coverage: clamp01(coverage.score),
  };

  const aggregateInputs: number[] = [
    subScores.convergence,
    subScores.residualConsensus,
    subScores.gpsAccuracy,
    subScores.coverage,
  ];
  if (subScores.compassAgreement !== null) {
    aggregateInputs.push(subScores.compassAgreement);
  }
  const confidence = clamp01(Math.min(...aggregateInputs));

  const observationsSeen = gpsPositions.length;

  let state: TrackingQualityState;
  if (trackingPhase !== 'tracking') {
    state = 'ar-lost';
  } else if (
    subScores.coverage < opts.warmupMinCoverage ||
    observationsSeen < opts.warmupMinObservations
  ) {
    state = 'warming-up';
  } else if (confidence < opts.degradedThreshold) {
    state = 'degraded';
  } else {
    state = 'ok';
  }

  return {
    state,
    confidence: state === 'ar-lost' ? 0 : confidence,
    subScores,
    diagnostics: {
      recentMaxRotationDeltaDeg: convergence.recentMaxRotationDeltaDeg,
      recentMaxTranslationDeltaM: convergence.recentMaxTranslationDeltaM,
      medianResidualM: residual.medianResidualM,
      medianRecentGpsAccuracyM: gpsAccuracy.medianM,
      walkedDistanceM: coverage.walkedDistanceM,
      directionSpreadDeg: coverage.directionSpreadDeg,
      headingDeltaDeg: compass.headingDeltaDeg,
      compassDriftDetected: false, // first-agreement detector lives in the listener
      observationsSeen,
      gpsVsFusedMaxDivergenceM,
    },
  };
}

// ===========================================================================
// Listener middleware — wires the slice to the rest of the store
// ===========================================================================

/**
 * Deep-equal that only inspects the public shape of a
 * {@link TrackingQualityReport}. Cheaper than a generic deep-equal
 * because it knows the schema; gates `reportUpdated` dispatches so
 * subscribers wake up exactly when the user-visible quality changes.
 */
function reportsEqual(
  a: TrackingQualityReport | null,
  b: TrackingQualityReport | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.state !== b.state) return false;
  if (a.confidence !== b.confidence) return false;
  const sa = a.subScores;
  const sb = b.subScores;
  if (
    sa.convergence !== sb.convergence ||
    sa.residualConsensus !== sb.residualConsensus ||
    sa.compassAgreement !== sb.compassAgreement ||
    sa.gpsAccuracy !== sb.gpsAccuracy ||
    sa.coverage !== sb.coverage
  ) {
    return false;
  }
  const da = a.diagnostics;
  const db = b.diagnostics;
  return (
    da.recentMaxRotationDeltaDeg === db.recentMaxRotationDeltaDeg &&
    da.recentMaxTranslationDeltaM === db.recentMaxTranslationDeltaM &&
    da.medianResidualM === db.medianResidualM &&
    da.medianRecentGpsAccuracyM === db.medianRecentGpsAccuracyM &&
    da.walkedDistanceM === db.walkedDistanceM &&
    da.directionSpreadDeg === db.directionSpreadDeg &&
    da.headingDeltaDeg === db.headingDeltaDeg &&
    da.compassDriftDetected === db.compassDriftDetected &&
    da.observationsSeen === db.observationsSeen &&
    da.gpsVsFusedMaxDivergenceM === db.gpsVsFusedMaxDivergenceM
  );
}

function matricesNearlyEqual(
  a: readonly number[],
  b: readonly number[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  }
  return true;
}

/**
 * Action types the listener reacts to. Exported so tests and the
 * store factory can wire them up; the strings are the canonical
 * RTK auto-generated action types.
 */
export const TRACKING_QUALITY_INPUT_ACTIONS = {
  gpsRecorded: 'gpsData/recordGpsEvent',
  setZeroPos: 'gpsData/setZeroPos',
  poseReceived: 'tracking/poseReceived',
  poseLost: 'tracking/poseLost',
  resetTracking: 'tracking/resetTracking',
  startSession: 'recording/startSession',
} as const;

interface InputActionMatcher {
  type: string;
}
function inputActionPredicate(action: Action): action is InputActionMatcher {
  switch (action.type) {
    case TRACKING_QUALITY_INPUT_ACTIONS.gpsRecorded:
    case TRACKING_QUALITY_INPUT_ACTIONS.setZeroPos:
    case TRACKING_QUALITY_INPUT_ACTIONS.poseReceived:
    case TRACKING_QUALITY_INPUT_ACTIONS.poseLost:
    case TRACKING_QUALITY_INPUT_ACTIONS.resetTracking:
    case TRACKING_QUALITY_INPUT_ACTIONS.startSession:
      return true;
    default:
      return false;
  }
}

/**
 * Build the listener middleware that drives the `trackingQuality`
 * slice. Register the returned middleware in `createSlamAppStore`.
 *
 * Behaviour:
 *  - On `gpsData/recordGpsEvent` and `gpsData/setZeroPos`: if the
 *    alignment matrix changed, dispatch `snapshotPushed` +
 *    `snapshotsTrimmed`. Then recompute the report and dispatch
 *    `reportUpdated` if it changed.
 *  - On `recording/startSession` and `tracking/resetTracking`:
 *    dispatch `resetTrackingQuality` and recompute the report.
 *  - On `tracking/poseReceived` and `tracking/poseLost`: only
 *    recompute the report (no buffer change).
 *  - All dispatches are idempotency-gated so quiet motion does not
 *    churn the store.
 */
export function createTrackingQualityListenerMiddleware(
  options: TrackingQualityOptions = {}
): Middleware {
  const opts: Required<TrackingQualityOptions> = {
    ...DEFAULT_TRACKING_QUALITY_OPTIONS,
    ...options,
  };

  // Use `isAnyOf` matcher equivalent via predicate.
  const listenerMiddleware = createListenerMiddleware();
  listenerMiddleware.startListening({
    predicate: (action: Action) => inputActionPredicate(action),
    effect: (action, api) => {
      const state = api.getState() as CombinedRootState;

      if (
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.startSession ||
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.resetTracking
      ) {
        const tq = (state as unknown as RootWithTrackingQuality)
          .trackingQuality;
        if (
          tq &&
          (tq.recentAlignments.length > 0 ||
            tq.firstAgreementObservationIndex !== null ||
            tq.report !== null)
        ) {
          api.dispatch(resetTrackingQuality());
        }
        return;
      }

      // Buffer maintenance on alignment-affecting actions.
      if (
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.gpsRecorded ||
        action.type === TRACKING_QUALITY_INPUT_ACTIONS.setZeroPos
      ) {
        const alignment = selectAlignmentMatrix(state);
        if (alignment) {
          const tq = (state as unknown as RootWithTrackingQuality)
            .trackingQuality;
          const buf = tq?.recentAlignments ?? [];
          const newMatrix = alignment as unknown as number[];
          const obsIndex = selectGpsPositions(state).length;
          const last = buf.length > 0 ? buf[buf.length - 1] : null;
          if (!last || !matricesNearlyEqual(last.matrix, newMatrix)) {
            api.dispatch(
              snapshotPushed({
                observationIndex: obsIndex,
                matrix: [...newMatrix],
              })
            );
            api.dispatch(snapshotsTrimmed({ size: opts.matrixHistorySize }));
          }
        }
      }

      // Recompute the report using the post-dispatch state.
      const next = api.getState() as CombinedRootState;
      const report = computeTrackingQualityReport(next, opts);
      const prev =
        (next as unknown as RootWithTrackingQuality).trackingQuality?.report ??
        null;
      if (!reportsEqual(prev, report)) {
        api.dispatch(reportUpdated(report));
      }
    },
  });

  return listenerMiddleware.middleware;
}
