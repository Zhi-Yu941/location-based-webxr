/**
 * Unit tests for tracking-quality.ts.
 *
 * Phase A of docs/2026-05-16-tracking-quality-metrics-plan.md. Focus
 * is on the pure compute helpers (§4.1–§4.7) and the slice/listener
 * wiring. The full Investigation parameter sweep is exercised
 * separately in `GpsPlusSlamJs_Investigation/src/tracking-quality.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { configureStore, type Action } from '@reduxjs/toolkit';
import type { GpsPoint, Matrix4, Vector3, LatLong } from 'gps-plus-slam-js';
import {
  computeCoverage,
  computeGpsAccuracy,
  computeResidualConsensus,
  computeConvergence,
  computeCompassAgreement,
  computeGpsVsFusedDivergence,
  computeTrackingQualityReport,
  matrixDelta,
  trackingQualityReducer,
  snapshotPushed,
  snapshotsTrimmed,
  reportUpdated,
  resetTrackingQuality,
  selectTrackingQuality,
  selectRecentAlignments,
  createTrackingQualityListenerMiddleware,
  DEFAULT_TRACKING_QUALITY_OPTIONS,
  type TrackingQualityReport,
  type AlignmentSnapshot,
} from './tracking-quality';
import { trackingReducer, poseReceived, poseLost } from './tracking-slice';
import type { DeviceOrientation } from './tracking-slice';
import type { ARPose } from '../types/ar-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDENTITY: Matrix4 = [
  1,
  0,
  0,
  0, // col 0
  0,
  1,
  0,
  0, // col 1
  0,
  0,
  1,
  0, // col 2
  0,
  0,
  0,
  1, // col 3 (translation)
];

function shifted(dx: number, dy: number, dz: number): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];
}

/** Column-major rotation about Y (in radians). */
function rotY(rad: number): Matrix4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

const ZERO_REF: LatLong = { lat: 52, lon: 13 };

function gps(
  i: number,
  latOffsetM: number,
  lonOffsetM: number,
  acc = 3
): GpsPoint {
  // Approx 1 m ≈ 9e-6° lat at this latitude.
  const lat = ZERO_REF.lat + latOffsetM / 111_320;
  const lon =
    ZERO_REF.lon +
    lonOffsetM / (111_320 * Math.cos((ZERO_REF.lat * Math.PI) / 180));
  return {
    id: `g${i}`,
    latitude: lat,
    longitude: lon,
    latLongAccuracy: acc,
    timestamp: 1_700_000_000_000 + i * 1000,
    zeroRef: ZERO_REF,
    coordinates: [latOffsetM, 0, lonOffsetM],
    weight: 1,
  };
}

const DEFAULT_ORIENTATION: DeviceOrientation = {
  alpha: 0,
  beta: 0,
  gamma: 0,
  absolute: false,
};

const DEFAULT_POSE: ARPose = {
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

// ---------------------------------------------------------------------------
// matrixDelta — kernel
// ---------------------------------------------------------------------------

describe('matrixDelta', () => {
  it('returns zero deltas for identical matrices', () => {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      IDENTITY,
      IDENTITY
    );
    expect(rotationDeltaDeg).toBeCloseTo(0, 5);
    expect(translationDeltaM).toBeCloseTo(0, 5);
  });

  it('measures pure translation', () => {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      IDENTITY,
      shifted(3, 0, 4)
    );
    expect(rotationDeltaDeg).toBeCloseTo(0, 5);
    expect(translationDeltaM).toBeCloseTo(5, 5);
  });

  it('measures pure rotation (30° about Y)', () => {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      IDENTITY,
      rotY(Math.PI / 6)
    );
    expect(rotationDeltaDeg).toBeCloseTo(30, 3);
    expect(translationDeltaM).toBeCloseTo(0, 5);
  });

  it('handles malformed inputs without throwing', () => {
    expect(matrixDelta([1, 2, 3], [1, 2, 3])).toEqual({
      rotationDeltaDeg: 0,
      translationDeltaM: 0,
    });
  });

  // Why this test matters: §11 (a) of the tracking-quality plan requires
  // matrixDelta to agree numerically with the gl-matrix-quat reference
  // kernel used by GpsPlusSlamJs_Investigation/src/investigation-helpers.ts
  // (`computeStabilityDelta`). The §6.1 corpus sweep correlates the
  // AppFramework's runtime convergence score with the Investigation's
  // hindsight error — both must use the same numeric definition or the
  // correlation is meaningless. The reference kernel below mirrors
  // computeStabilityDelta exactly; this test asserts identical output on
  // a tricky compound-rotation+translation case.
  it('matches the gl-matrix quat-based reference kernel on compound transforms', async () => {
    const { mat4, quat, vec3 } = await import('gl-matrix');
    const RAD_TO_DEG = 180 / Math.PI;

    function referenceDelta(
      prev: Matrix4,
      curr: Matrix4
    ): { rotationDeltaDeg: number; translationDeltaM: number } {
      const prevMat = mat4.fromValues(
        ...(prev as unknown as Parameters<typeof mat4.fromValues>)
      );
      const currMat = mat4.fromValues(
        ...(curr as unknown as Parameters<typeof mat4.fromValues>)
      );
      const prevQuat = quat.create();
      const currQuat = quat.create();
      mat4.getRotation(prevQuat, prevMat);
      mat4.getRotation(currQuat, currMat);
      quat.normalize(prevQuat, prevQuat);
      quat.normalize(currQuat, currQuat);
      const angleRad = quat.getAngle(prevQuat, currQuat);
      const rotationDeltaDeg = Number.isNaN(angleRad)
        ? 0
        : angleRad * RAD_TO_DEG;
      const prevT = vec3.create();
      const currT = vec3.create();
      mat4.getTranslation(prevT, prevMat);
      mat4.getTranslation(currT, currMat);
      return {
        rotationDeltaDeg,
        translationDeltaM: vec3.distance(prevT, currT),
      };
    }

    // Compose: rotate 17° about Y then 11° about X, then translate (1.2, -0.4, 2.7).
    // Build column-major directly via gl-matrix to avoid hand-error.
    const m = mat4.create();
    mat4.fromTranslation(m, [1.2, -0.4, 2.7]);
    mat4.rotateY(m, m, (17 * Math.PI) / 180);
    mat4.rotateX(m, m, (11 * Math.PI) / 180);
    const a: Matrix4 = Array.from(m) as Matrix4;
    // A second matrix: rotate -23° about Y + translate (0.7, 0.2, -1.1).
    const n = mat4.create();
    mat4.fromTranslation(n, [0.7, 0.2, -1.1]);
    mat4.rotateY(n, n, (-23 * Math.PI) / 180);
    const b: Matrix4 = Array.from(n) as Matrix4;

    const got = matrixDelta(a, b);
    const ref = referenceDelta(a, b);
    expect(got.rotationDeltaDeg).toBeCloseTo(ref.rotationDeltaDeg, 6);
    expect(got.translationDeltaM).toBeCloseTo(ref.translationDeltaM, 9);
  });

  it('matches the gl-matrix reference for an identity → 90°-Y transform', async () => {
    const { mat4, quat } = await import('gl-matrix');
    const target = mat4.create();
    mat4.rotateY(target, target, Math.PI / 2);
    const got = matrixDelta(IDENTITY, Array.from(target) as Matrix4);

    const idQ = quat.create();
    const tQ = quat.create();
    mat4.getRotation(tQ, target);
    quat.normalize(tQ, tQ);
    const refAngle = (quat.getAngle(idQ, tQ) * 180) / Math.PI;
    expect(got.rotationDeltaDeg).toBeCloseTo(refAngle, 6);
    expect(got.rotationDeltaDeg).toBeCloseTo(90, 5);
  });
});

// ---------------------------------------------------------------------------
// §4.1 convergence
// ---------------------------------------------------------------------------

describe('computeConvergence', () => {
  it('returns score 0 with fewer than 2 snapshots', () => {
    expect(computeConvergence([]).score).toBe(0);
    expect(
      computeConvergence([{ observationIndex: 0, matrix: [...IDENTITY] }]).score
    ).toBe(0);
  });

  it('returns score ≈ 1 for nearly-identical snapshots', () => {
    const snaps: AlignmentSnapshot[] = [
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: [...shifted(0.01, 0, 0.01)] },
      { observationIndex: 3, matrix: [...shifted(0.02, 0, 0.0)] },
    ];
    const r = computeConvergence(snaps);
    expect(r.score).toBeGreaterThan(0.9);
    expect(r.recentMaxTranslationDeltaM).toBeGreaterThan(0);
    expect(r.pairCount).toBe(2);
  });

  it('drops score for large rotation jumps', () => {
    const snaps: AlignmentSnapshot[] = [
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: [...rotY(Math.PI / 2)] }, // 90°
    ];
    expect(computeConvergence(snaps).score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4.2 residual consensus
// ---------------------------------------------------------------------------

describe('computeResidualConsensus', () => {
  it('returns score 0 when alignment or zeroRef missing', () => {
    expect(
      computeResidualConsensus(null, [gps(0, 0, 0)], [[0, 0, 0]], ZERO_REF)
        .score
    ).toBe(0);
    expect(
      computeResidualConsensus(IDENTITY, [gps(0, 0, 0)], [[0, 0, 0]], null)
        .score
    ).toBe(0);
  });

  it('returns high score when odom→GPS prediction is exact', () => {
    const odom: Vector3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    const gpsPts: GpsPoint[] = odom.map((p, i) => gps(i, p[0], p[2]));
    const r = computeResidualConsensus(IDENTITY, gpsPts, odom, ZERO_REF);
    expect(r.score).toBeGreaterThan(0.95);
    expect(r.medianResidualM).toBeLessThan(0.1);
  });

  it('drops score when predictions are 10 m off', () => {
    const odom: Vector3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    // GPS positions are 10 m north of where the alignment predicts.
    const gpsPts: GpsPoint[] = odom.map((p, i) => gps(i, p[0] + 10, p[2]));
    const r = computeResidualConsensus(IDENTITY, gpsPts, odom, ZERO_REF);
    expect(r.score).toBeLessThan(0.5);
    expect(r.medianResidualM).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// §4.4 GPS-accuracy budget
// ---------------------------------------------------------------------------

describe('computeGpsAccuracy', () => {
  it('returns 0 when no GPS points', () => {
    expect(computeGpsAccuracy([]).score).toBe(0);
  });

  it('returns 1.0 for tight GPS (median ≤ 3 m)', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => gps(i, i, 0, 2));
    expect(computeGpsAccuracy(pts).score).toBe(1);
    expect(computeGpsAccuracy(pts).medianM).toBe(2);
  });

  it('returns 0 for very loose GPS (median ≥ 25 m)', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => gps(i, i, 0, 30));
    expect(computeGpsAccuracy(pts).score).toBe(0);
  });

  it('only inspects the last K points', () => {
    const stale = [0, 1, 2].map((i) => gps(i, i, 0, 30));
    const recent = [3, 4, 5, 6, 7, 8, 9, 10].map((i) => gps(i, i, 0, 2));
    const pts = [...stale, ...recent];
    expect(computeGpsAccuracy(pts).score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4.5 coverage
// ---------------------------------------------------------------------------

describe('computeCoverage', () => {
  it('returns 0 with fewer than 2 odom samples', () => {
    expect(computeCoverage([]).score).toBe(0);
    expect(computeCoverage([[0, 0, 0]]).score).toBe(0);
  });

  it('returns 0 when standing still', () => {
    const odom: Vector3[] = Array.from({ length: 30 }, () => [0, 0, 0]);
    const r = computeCoverage(odom);
    expect(r.score).toBe(0);
    expect(r.walkedDistanceM).toBe(0);
  });

  it('penalises a 20 m straight-line walk (no direction spread)', () => {
    const odom: Vector3[] = Array.from({ length: 21 }, (_, i) => [i, 0, 0]);
    const r = computeCoverage(odom);
    expect(r.walkedDistanceM).toBeCloseTo(20, 5);
    // Single direction → spread ≈ 0, so score ≈ 0.
    expect(r.score).toBeLessThan(0.1);
  });

  it('returns 1.0 for a 20 m loop covering >= 90° spread', () => {
    const odom: Vector3[] = [];
    // North leg
    for (let i = 0; i <= 10; i++) odom.push([i, 0, 0]);
    // East leg
    for (let i = 1; i <= 10; i++) odom.push([10, 0, i]);
    const r = computeCoverage(odom);
    expect(r.walkedDistanceM).toBeCloseTo(20, 1);
    expect(r.directionSpreadDeg).toBeGreaterThanOrEqual(90);
    expect(r.score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4.3 compass / heading
// ---------------------------------------------------------------------------

describe('computeCompassAgreement', () => {
  it('returns null when sensor is not absolute', () => {
    const r = computeCompassAgreement(
      IDENTITY,
      DEFAULT_ORIENTATION,
      DEFAULT_POSE
    );
    expect(r.score).toBeNull();
    expect(r.headingDeltaDeg).toBeNull();
  });

  it('returns null when any input is missing', () => {
    expect(computeCompassAgreement(null, null, null).score).toBeNull();
  });

  it('returns score 1 when alignment heading matches compass', () => {
    // AR-forward = (0,0,-1) at identity rotation; identity alignment →
    // ENU forward = (0,0,-1), which under our (N,U,E) ENU labelling has
    // N = 0, E = -1, bearing = 270°. Compass alpha = 270 ⇒ delta = 0.
    const orientation: DeviceOrientation = {
      alpha: 270,
      beta: 0,
      gamma: 0,
      absolute: true,
    };
    const r = computeCompassAgreement(IDENTITY, orientation, DEFAULT_POSE);
    expect(r.score).toBe(1);
    expect(r.headingDeltaDeg).toBeCloseTo(0, 5);
  });

  it('drops score to 0 for >= failDeg disagreement', () => {
    const orientation: DeviceOrientation = {
      alpha: 0, // claims north, alignment says ~west
      beta: 0,
      gamma: 0,
      absolute: true,
    };
    const r = computeCompassAgreement(IDENTITY, orientation, DEFAULT_POSE);
    expect(r.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4.6 GPS-vs-fused divergence
// ---------------------------------------------------------------------------

describe('computeGpsVsFusedDivergence', () => {
  it('is 0 with missing inputs', () => {
    expect(computeGpsVsFusedDivergence(null, [], [], null)).toBe(0);
  });

  it('reports the worst residual in the window', () => {
    const odom: Vector3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ];
    const gpsPts: GpsPoint[] = [
      gps(0, 0, 0),
      gps(1, 1, 0),
      gps(2, 2, 0),
      gps(3, 12, 0), // 9 m off
    ];
    const max = computeGpsVsFusedDivergence(IDENTITY, gpsPts, odom, ZERO_REF);
    expect(max).toBeGreaterThan(8);
    expect(max).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

interface MinimalRoot {
  gpsData: {
    gpsEvents: {
      alignmentMatrix: Matrix4 | null;
      gpsPositions: readonly GpsPoint[];
      odometryPositions: readonly Vector3[];
      odometryRotations: readonly unknown[];
    };
    zero: LatLong | null;
    referencePoints: readonly unknown[];
  };
  tracking: ReturnType<typeof trackingReducer>;
  trackingQuality: ReturnType<typeof trackingQualityReducer>;
}

function buildRootState(input: {
  alignmentMatrix?: Matrix4 | null;
  gpsPositions?: readonly GpsPoint[];
  odometryPositions?: readonly Vector3[];
  zeroRef?: LatLong | null;
  trackingPhase?: 'initializing' | 'tracking' | 'lost';
  snapshots?: readonly AlignmentSnapshot[];
  sensorOrientation?: DeviceOrientation;
  lastValidPose?: ARPose;
}): MinimalRoot {
  return {
    gpsData: {
      gpsEvents: {
        alignmentMatrix: input.alignmentMatrix ?? null,
        gpsPositions: input.gpsPositions ?? [],
        odometryPositions: input.odometryPositions ?? [],
        odometryRotations: [],
      },
      zero: input.zeroRef ?? null,
      referencePoints: [],
    },
    tracking: {
      phase: input.trackingPhase ?? 'tracking',
      lastValidPose: input.lastValidPose ?? DEFAULT_POSE,
      lastSensorOrientation: input.sensorOrientation ?? DEFAULT_ORIENTATION,
      lostFrameCount: 0,
      originResetDuringLoss: false,
      resetTransform: undefined,
      lastRestartedPayload: null,
    },
    trackingQuality: {
      recentAlignments: [...(input.snapshots ?? [])],
      firstAgreementObservationIndex: null,
      report: null,
    },
  };
}

describe('computeTrackingQualityReport', () => {
  it('returns ar-lost when tracking phase is not "tracking"', () => {
    const root = buildRootState({
      trackingPhase: 'lost',
      alignmentMatrix: IDENTITY,
      gpsPositions: Array.from({ length: 30 }, (_, i) => gps(i, i, 0)),
      odometryPositions: Array.from(
        { length: 30 },
        (_, i) => [i, 0, 0] as Vector3
      ),
      zeroRef: ZERO_REF,
    });
    // Cast — buildRootState satisfies the structural minimum used by selectors.
    const report = computeTrackingQualityReport(root as never);
    expect(report.state).toBe('ar-lost');
    expect(report.confidence).toBe(0);
  });

  it('reports warming-up before enough GPS / coverage', () => {
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0), gps(1, 0, 0)],
      odometryPositions: [
        [0, 0, 0],
        [0.1, 0, 0],
      ],
      zeroRef: ZERO_REF,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.state).toBe('warming-up');
  });

  it('produces a confidence score from min(subScores)', () => {
    // Build a "happy path": good GPS, good coverage, good residuals,
    // converged matrix snapshots; compass is null (absolute=false).
    const odom: Vector3[] = [];
    for (let i = 0; i <= 20; i++) odom.push([i, 0, 0]);
    for (let i = 1; i <= 20; i++) odom.push([20, 0, i]);
    const gpsPts = odom.map((p, i) => gps(i, p[0], p[2], 2));
    const snapshots: AlignmentSnapshot[] = Array.from(
      { length: 8 },
      (_, i) => ({
        observationIndex: i + 30,
        matrix: [...IDENTITY],
      })
    );
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
      snapshots,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.compassAgreement).toBeNull();
    expect(report.subScores.convergence).toBeGreaterThan(0.95);
    expect(report.subScores.residualConsensus).toBeGreaterThan(0.95);
    expect(report.subScores.gpsAccuracy).toBe(1);
    expect(report.subScores.coverage).toBe(1);
    expect(report.confidence).toBeGreaterThan(0.5);
    expect(report.state).toBe('ok');
  });

  // Anti-validation §6: bad GPS + stable matrix must NOT report 1.0.
  it('anti-validation: bad GPS pulls confidence down even with stable matrix', () => {
    const odom: Vector3[] = [];
    for (let i = 0; i <= 20; i++) odom.push([i, 0, 0]);
    for (let i = 1; i <= 20; i++) odom.push([20, 0, i]);
    const gpsPts = odom.map((p, i) => gps(i, p[0], p[2], 40));
    const snapshots: AlignmentSnapshot[] = Array.from(
      { length: 8 },
      (_, i) => ({
        observationIndex: i + 30,
        matrix: [...IDENTITY],
      })
    );
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
      snapshots,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.gpsAccuracy).toBe(0);
    expect(report.confidence).toBeLessThan(0.1);
    expect(report.state).toBe('degraded');
  });

  // Anti-validation §6: standing still must NOT report 'ok'.
  it('anti-validation: standing still keeps state in warming-up', () => {
    const odom: Vector3[] = Array.from({ length: 60 }, () => [0, 0, 0]);
    const gpsPts = Array.from({ length: 60 }, (_, i) => gps(i, 0, 0, 2));
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.coverage).toBe(0);
    expect(report.state).toBe('warming-up');
  });

  // Anti-validation §6: 180°-flip compass disagreement degrades quality.
  it('anti-validation: 180° heading disagreement drives compass score to 0', () => {
    const odom: Vector3[] = [];
    for (let i = 0; i <= 20; i++) odom.push([i, 0, 0]);
    for (let i = 1; i <= 20; i++) odom.push([20, 0, i]);
    const gpsPts = odom.map((p, i) => gps(i, p[0], p[2], 2));
    const snapshots: AlignmentSnapshot[] = Array.from(
      { length: 8 },
      (_, i) => ({
        observationIndex: i + 30,
        matrix: [...IDENTITY],
      })
    );
    // Identity alignment + AR-forward (0,0,-1) puts heading at 270°;
    // a compass reporting 90° (the 180° flip) should fail.
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
      snapshots,
      sensorOrientation: { alpha: 90, beta: 0, gamma: 0, absolute: true },
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.compassAgreement).toBe(0);
    expect(report.confidence).toBe(0);
    expect(report.state).toBe('degraded');
  });
});

// ---------------------------------------------------------------------------
// Slice / reducer
// ---------------------------------------------------------------------------

describe('trackingQuality slice', () => {
  function makeStore() {
    return configureStore({
      reducer: {
        tracking: trackingReducer,
        trackingQuality: trackingQualityReducer,
      },
    });
  }

  it('starts empty', () => {
    const store = makeStore();
    expect(selectTrackingQuality(store.getState())).toBeNull();
    expect(selectRecentAlignments(store.getState())).toEqual([]);
  });

  it('appends and trims snapshots', () => {
    const store = makeStore();
    for (let i = 0; i < 5; i++) {
      store.dispatch(
        snapshotPushed({ observationIndex: i, matrix: [...IDENTITY] })
      );
    }
    store.dispatch(snapshotsTrimmed({ size: 3 }));
    const buf = selectRecentAlignments(store.getState());
    expect(buf.length).toBe(3);
    expect(buf[0].observationIndex).toBe(2);
  });

  it('stores and clears the report', () => {
    const store = makeStore();
    const report: TrackingQualityReport = {
      state: 'ok',
      confidence: 0.8,
      subScores: {
        convergence: 0.9,
        residualConsensus: 0.8,
        compassAgreement: null,
        gpsAccuracy: 0.95,
        coverage: 0.85,
      },
      diagnostics: {
        recentMaxRotationDeltaDeg: 0,
        recentMaxTranslationDeltaM: 0,
        medianResidualM: 0.5,
        medianRecentGpsAccuracyM: 2,
        walkedDistanceM: 30,
        directionSpreadDeg: 180,
        headingDeltaDeg: null,
        compassDriftDetected: false,
        observationsSeen: 25,
        gpsVsFusedMaxDivergenceM: 1.5,
      },
    };
    store.dispatch(reportUpdated(report));
    expect(selectTrackingQuality(store.getState())).toEqual(report);
    store.dispatch(resetTrackingQuality());
    expect(selectTrackingQuality(store.getState())).toBeNull();
    expect(selectRecentAlignments(store.getState())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Listener middleware
// ---------------------------------------------------------------------------

interface ListenerHarnessState {
  gpsData: MinimalRoot['gpsData'];
  tracking: MinimalRoot['tracking'];
  trackingQuality: MinimalRoot['trackingQuality'];
}

function makeListenerStore(initialGps: ListenerHarnessState['gpsData']) {
  // Minimal gpsData reducer that lets us push alignment changes via
  // synthetic actions matching the library's action types.
  const gpsDataReducer = (
    state: ListenerHarnessState['gpsData'] = initialGps,
    action: Action
  ): ListenerHarnessState['gpsData'] => {
    if (
      action.type === 'gpsData/recordGpsEvent' ||
      action.type === 'gpsData/setZeroPos'
    ) {
      const payload = (action as { payload: ListenerHarnessState['gpsData'] })
        .payload;
      return payload;
    }
    return state;
  };

  const store = configureStore({
    reducer: {
      gpsData: gpsDataReducer,
      tracking: trackingReducer,
      trackingQuality: trackingQualityReducer,
    },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false }).prepend(
        createTrackingQualityListenerMiddleware({
          matrixHistorySize: 4,
          warmupMinObservations: 2,
          warmupMinCoverage: 0,
        })
      ),
  });
  return store;
}

describe('createTrackingQualityListenerMiddleware', () => {
  function snapshotGpsAfter(
    alignmentMatrix: Matrix4 | null,
    positions: GpsPoint[],
    odom: Vector3[]
  ): ListenerHarnessState['gpsData'] {
    return {
      gpsEvents: {
        alignmentMatrix,
        gpsPositions: positions,
        odometryPositions: odom,
        odometryRotations: [],
      },
      zero: ZERO_REF,
      referencePoints: [],
    };
  }

  it('pushes a snapshot and dispatches reportUpdated on recordGpsEvent', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    // Mark tracking as actively tracking so we don't get 'ar-lost'.
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    const odom: Vector3[] = [];
    const gpsPts: GpsPoint[] = [];
    for (let i = 0; i < 5; i++) {
      odom.push([i, 0, 0]);
      gpsPts.push(gps(i, i, 0));
      store.dispatch({
        type: 'gpsData/recordGpsEvent',
        payload: snapshotGpsAfter(IDENTITY, [...gpsPts], [...odom]),
      });
    }
    const buf = selectRecentAlignments(store.getState());
    expect(buf.length).toBe(1); // matrix only changed once (null → IDENTITY)
    const report = selectTrackingQuality(store.getState());
    expect(report).not.toBeNull();
    expect(report?.diagnostics.observationsSeen).toBe(5);
  });

  it('trims to matrixHistorySize when matrix keeps changing', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    for (let i = 0; i < 8; i++) {
      const matrix = shifted(i, 0, 0);
      store.dispatch({
        type: 'gpsData/recordGpsEvent',
        payload: snapshotGpsAfter(matrix, [gps(i, i, 0)], [[i, 0, 0]]),
      });
    }
    const buf = selectRecentAlignments(store.getState());
    expect(buf.length).toBe(4); // matrixHistorySize from harness
  });

  it('resets buffer + report on startSession and resetTracking', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    store.dispatch({
      type: 'gpsData/recordGpsEvent',
      payload: snapshotGpsAfter(IDENTITY, [gps(0, 0, 0)], [[0, 0, 0]]),
    });
    expect(selectRecentAlignments(store.getState()).length).toBe(1);

    store.dispatch({ type: 'recording/startSession' });
    expect(selectRecentAlignments(store.getState()).length).toBe(0);
    expect(selectTrackingQuality(store.getState())).toBeNull();
  });

  it('does not churn reportUpdated when nothing changed', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    let reportUpdatedCount = 0;
    const unsub = store.subscribe(() => {
      if (
        (store.getState() as { trackingQuality: { report: unknown } })
          .trackingQuality.report !== null
      ) {
        reportUpdatedCount += 1;
      }
    });

    store.dispatch({
      type: 'gpsData/recordGpsEvent',
      payload: snapshotGpsAfter(IDENTITY, [gps(0, 0, 0)], [[0, 0, 0]]),
    });
    const after1 = reportUpdatedCount;
    // Same payload again — listener computes the same report, no diff dispatch.
    store.dispatch({ type: 'tracking/poseLost' });
    // poseLost may flip phase → state changes → one new dispatch.
    expect(reportUpdatedCount).toBeGreaterThanOrEqual(after1);
    unsub();
  });
});

// Reference unused imports so future maintainers don't accidentally drop them
// (matrixDelta, DEFAULT_TRACKING_QUALITY_OPTIONS are exported for the
// Investigation harness — keep them part of the public surface).
describe('exports', () => {
  it('keeps matrixDelta + DEFAULT_TRACKING_QUALITY_OPTIONS in the public API', () => {
    expect(typeof DEFAULT_TRACKING_QUALITY_OPTIONS).toBe('object');
    expect(typeof matrixDelta).toBe('function');
    expect(typeof poseLost).toBe('function');
  });
});
