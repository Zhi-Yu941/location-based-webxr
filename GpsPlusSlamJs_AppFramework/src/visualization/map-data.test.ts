/**
 * Shared `MapData` builder — unit tests (TDD red-first).
 *
 * Why these tests matter: `buildMapData` is the single source of trajectory
 * data for BOTH the live/replay 3D Leaflet overlay and the 2D summary map
 * (decisions D1–D4 in
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-user-feedback.md).
 * Before this builder existed, the two maps were fed by separate code paths
 * and visibly diverged (feedback Findings 1–2). The defining contract is
 * D2: the fused path is ALWAYS recomputed from the latest alignment matrix
 * via `computeFusedPath`, never frozen per-event — so the live fused polyline
 * "snaps" as alignment improves, exactly like the summary.
 */

import { describe, it, expect } from 'vitest';
import { buildMapData } from './map-data';
import { computeFusedPath } from '../utils/fused-path';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { RawGpsSample } from '../types/geo-types';
import { computeUserHeadingDeg } from '../utils/user-heading';

// ============================================================================
// Fixtures
// ============================================================================

/** Identity matrix (column-major). */
const IDENTITY_MAT4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Translate by (10, 0, 20) ENU meters (column-major). */
const TRANSLATION_MAT4: Matrix4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 20, 1,
];

const ZERO_REF = { lat: 50.0, lon: 8.0 } as const;

const ODOM: Vector3[] = [
  [0, 0, 0],
  [1, 0, 1],
  [2, 0, 2],
];

const RAW: RawGpsSample[] = [
  { lat: 50.0, lng: 8.0, accuracy: 5 },
  { lat: 50.001, lng: 8.001 },
];

// ============================================================================
// Tests
// ============================================================================

describe('buildMapData', () => {
  it('passes raw GPS and snapshots through unchanged', () => {
    const snapshots = [{ lat: 50.0, lng: 8.0 }];
    const data = buildMapData({
      rawGpsPath: RAW,
      alignmentSnapshots: snapshots,
    });

    expect(data.rawGpsPath).toEqual(RAW);
    expect(data.alignmentSnapshots).toEqual(snapshots);
  });

  it('defensively copies array inputs (no aliasing of caller arrays)', () => {
    const raw = [...RAW];
    const data = buildMapData({ rawGpsPath: raw });
    expect(data.rawGpsPath).not.toBe(raw);
    expect(data.rawGpsPath).toEqual(raw);
  });

  it('returns empty arrays (never undefined) for an empty input', () => {
    const data = buildMapData({});
    expect(data.rawGpsPath).toEqual([]);
    expect(data.fusedPath).toEqual([]);
    expect(data.alignmentSnapshots).toEqual([]);
    expect(data.userPosition).toBeNull();
  });

  describe('D2 — fused path always recomputed from latest matrix', () => {
    it('derives fusedPath from computeFusedPath over ALL odometry positions', () => {
      const data = buildMapData({
        odometryPositions: ODOM,
        alignmentMatrix: TRANSLATION_MAT4,
        zeroRef: ZERO_REF,
      });

      const expected = computeFusedPath({
        odometryPositions: ODOM,
        alignmentMatrix: TRANSLATION_MAT4,
        zeroRef: ZERO_REF,
      });

      expect(data.fusedPath).toEqual(expected);
      expect(data.fusedPath.length).toBe(ODOM.length);
    });

    it('rebuilds the WHOLE fused path when the matrix changes (snaps, not appends)', () => {
      const first = buildMapData({
        odometryPositions: ODOM,
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      });
      const second = buildMapData({
        odometryPositions: ODOM,
        alignmentMatrix: TRANSLATION_MAT4,
        zeroRef: ZERO_REF,
      });

      // Every point reflects the NEW matrix — none are frozen from the first.
      expect(second.fusedPath).toEqual(
        computeFusedPath({
          odometryPositions: ODOM,
          alignmentMatrix: TRANSLATION_MAT4,
          zeroRef: ZERO_REF,
        })
      );
      expect(second.fusedPath).not.toEqual(first.fusedPath);
    });

    it('returns an empty fusedPath when the matrix is null', () => {
      const data = buildMapData({
        odometryPositions: ODOM,
        alignmentMatrix: null,
        zeroRef: ZERO_REF,
      });
      expect(data.fusedPath).toEqual([]);
    });

    it('returns an empty fusedPath when zeroRef is null', () => {
      const data = buildMapData({
        odometryPositions: ODOM,
        alignmentMatrix: TRANSLATION_MAT4,
        zeroRef: null,
      });
      expect(data.fusedPath).toEqual([]);
    });
  });

  describe('userPosition', () => {
    it('defaults to the last raw GPS point when not provided', () => {
      const data = buildMapData({ rawGpsPath: RAW });
      expect(data.userPosition).toEqual({ lat: 50.001, lng: 8.001 });
    });

    it('honours an explicit userPosition over the raw fallback', () => {
      const explicit = { lat: 1, lng: 2 };
      const data = buildMapData({ rawGpsPath: RAW, userPosition: explicit });
      expect(data.userPosition).toEqual(explicit);
    });

    it('is null when there is no raw GPS and none is provided', () => {
      const data = buildMapData({ odometryPositions: ODOM });
      expect(data.userPosition).toBeNull();
    });
  });

  // Finding 2 (2026-06-28): the live/replay overlay draws a thin view-direction
  // line from the user dot. buildMapData carries the bearing as userHeadingDeg.
  // The frame algebra itself is pinned by user-heading.test.ts; here we only
  // assert the wiring (latest rotation + alignment matrix → kernel result).
  describe('userHeadingDeg (Finding 2)', () => {
    const IDENTITY_Q: Quaternion = [0, 0, 0, 1];
    // A non-identity rotation that must be IGNORED when it is not the latest.
    const OTHER_Q: Quaternion = [0, 0.7071, 0, 0.7071];

    it('is null on empty input', () => {
      expect(buildMapData({}).userHeadingDeg).toBeNull();
    });

    it('is null when there is no alignment matrix yet', () => {
      const data = buildMapData({
        odometryRotations: [IDENTITY_Q],
        alignmentMatrix: null,
      });
      expect(data.userHeadingDeg).toBeNull();
    });

    it('is null when there are no rotations yet', () => {
      const data = buildMapData({
        odometryRotations: [],
        alignmentMatrix: IDENTITY_MAT4,
      });
      expect(data.userHeadingDeg).toBeNull();
    });

    it('computes the bearing from the LATEST rotation and alignment matrix', () => {
      const data = buildMapData({
        // First entry is non-identity and must be ignored; the last wins.
        odometryRotations: [OTHER_Q, IDENTITY_Q],
        alignmentMatrix: IDENTITY_MAT4,
      });
      const expected = computeUserHeadingDeg({
        odometryRotation: IDENTITY_Q,
        alignmentMatrix: IDENTITY_MAT4,
      });
      expect(data.userHeadingDeg).toBe(expected);
      expect(data.userHeadingDeg).toBeCloseTo(0, 3); // identity camera → North
    });
  });
});
