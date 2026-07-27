/**
 * QR pose aggregation — unit tests.
 *
 * Why this test matters: rotation aggregation is the genuinely new, error-prone
 * piece. These pin the conventions everything downstream rides on:
 * - the quaternion DOUBLE-COVER guard (`q` ≡ `−q`) — the #1 bug here,
 * - angle-thresholded OUTLIER rejection (one bad rotation must not move the mean),
 * - the spread / inlier-count reporting the stability gate consumes,
 * - the `unknown → measuring → stable` lifecycle and its window slicing.
 */

import { describe, it, expect } from 'vitest';
import { quat } from 'gl-matrix';
import type { Quaternion } from 'gps-plus-slam-js';
import type { Pose } from './qr-pose';
import {
  averageRotation,
  aggregateQrPose,
  evaluateQrPoseStability,
} from './qr-pose-aggregation';

/** Quaternion [x,y,z,w] from an axis + angle (deg). */
function fromAxisAngle(
  axis: [number, number, number],
  deg: number
): Quaternion {
  const q = quat.create();
  quat.setAxisAngle(q, axis, (deg * Math.PI) / 180);
  quat.normalize(q, q);
  return [q[0], q[1], q[2], q[3]];
}

/** Shortest-arc angle (deg) between two rotations — double-cover safe. */
function angleDeg(a: Quaternion, b: Quaternion): number {
  const ga = quat.fromValues(a[0], a[1], a[2], a[3]);
  const gb = quat.fromValues(b[0], b[1], b[2], b[3]);
  const d = quat.dot(quat.normalize(ga, ga), quat.normalize(gb, gb));
  const c = Math.min(1, Math.max(-1, 2 * d * d - 1));
  return (Math.acos(c) * 180) / Math.PI;
}

const IDENTITY: Quaternion = [0, 0, 0, 1];

describe('averageRotation', () => {
  it('returns null for an empty input', () => {
    expect(averageRotation([])).toBeNull();
  });

  it('returns the same rotation for identical quats (zero spread)', () => {
    const q = fromAxisAngle([0, 1, 0], 30);
    const r = averageRotation([q, q, q]);
    expect(r).not.toBeNull();
    expect(angleDeg(r!.quat, q)).toBeLessThan(0.5);
    expect(r!.inlierCount).toBe(3);
    expect(r!.maxAngleDeg).toBeLessThan(0.5);
  });

  it('treats a hemisphere-flipped duplicate (−q) as the SAME rotation (double-cover guard)', () => {
    const q = fromAxisAngle([0, 0, 1], 40);
    const negQ: Quaternion = [-q[0], -q[1], -q[2], -q[3]];
    const r = averageRotation([q, negQ]);
    expect(r).not.toBeNull();
    // Naive component averaging of q and −q sums to ~0 → garbage. The guard
    // must instead recover the common rotation with (near) zero spread.
    expect(angleDeg(r!.quat, q)).toBeLessThan(0.5);
    expect(r!.inlierCount).toBe(2);
    expect(r!.maxAngleDeg).toBeLessThan(0.5);
  });

  it('rejects a single >threshold outlier among a good cluster', () => {
    const base = fromAxisAngle([0, 1, 0], 20);
    const good = [
      fromAxisAngle([0, 1, 0], 19),
      fromAxisAngle([0, 1, 0], 20),
      fromAxisAngle([0, 1, 0], 21),
      fromAxisAngle([0, 1, 0], 20),
    ];
    const outlier = fromAxisAngle([0, 1, 0], 90); // ~70° away → beyond 12°
    const r = averageRotation([...good, outlier], { inlierAngleDeg: 12 });
    expect(r).not.toBeNull();
    expect(r!.inlierCount).toBe(4); // outlier dropped
    expect(angleDeg(r!.quat, base)).toBeLessThan(2);
    expect(r!.maxAngleDeg).toBeLessThan(3); // spread of the good cluster only
  });

  it('reports the inlier spread (max angle to the mean)', () => {
    const a = fromAxisAngle([0, 1, 0], 0);
    const b = fromAxisAngle([0, 1, 0], 10);
    const r = averageRotation([a, b], { inlierAngleDeg: 30 });
    expect(r).not.toBeNull();
    expect(r!.inlierCount).toBe(2);
    // Mean is ~midway → each ~5° from it.
    expect(r!.maxAngleDeg).toBeGreaterThan(4);
    expect(r!.maxAngleDeg).toBeLessThan(6);
  });
});

describe('aggregateQrPose', () => {
  const pose = (pos: [number, number, number], rot: Quaternion): Pose => ({
    position: pos,
    rotation: rot,
  });

  it('returns null for an empty window', () => {
    expect(aggregateQrPose([])).toBeNull();
  });

  it('uses the per-axis median for position', () => {
    const poses = [
      pose([0, 0, 0], IDENTITY),
      pose([1, 10, -5], IDENTITY),
      pose([2, 20, -10], IDENTITY),
    ];
    const agg = aggregateQrPose(poses);
    expect(agg!.pose.position).toEqual([1, 10, -5]); // per-axis middle
  });

  it('rejects a bad-rotation outlier so it does not move the mean', () => {
    const good = fromAxisAngle([0, 1, 0], 15);
    const poses = [
      pose([0, 0, 0], fromAxisAngle([0, 1, 0], 14)),
      pose([0, 0, 0], fromAxisAngle([0, 1, 0], 15)),
      pose([0, 0, 0], fromAxisAngle([0, 1, 0], 16)),
      pose([0, 0, 0], fromAxisAngle([1, 0, 0], 80)), // wild outlier
    ];
    const agg = aggregateQrPose(poses, { inlierAngleDeg: 12 });
    expect(agg!.inlierCount).toBe(3);
    expect(angleDeg(agg!.pose.rotation, good)).toBeLessThan(2);
  });

  it('computes the translation spread (max abs deviation from the median)', () => {
    const poses = [
      pose([0, 0, 0], IDENTITY),
      pose([0.01, 0, 0], IDENTITY),
      pose([0.02, 0, 0], IDENTITY),
    ];
    const agg = aggregateQrPose(poses);
    // median x = 0.01; max |dev| = 0.01
    expect(agg!.translationSpreadM).toBeCloseTo(0.01, 6);
  });
});

describe('evaluateQrPoseStability', () => {
  const steadyPose = (jitterDeg: number): Pose => ({
    position: [0, 0, -1],
    rotation: fromAxisAngle([0, 1, 0], 30 + jitterDeg),
  });

  it('is unknown for an empty window', () => {
    const s = evaluateQrPoseStability([]);
    expect(s.status).toBe('unknown');
    expect(s.pose).toBeNull();
  });

  it('is measuring (not stable) until minObservations is reached', () => {
    const poses = [steadyPose(0), steadyPose(0), steadyPose(0)];
    const s = evaluateQrPoseStability(poses, { minObservations: 5 });
    expect(s.status).toBe('measuring');
    expect(s.pose).not.toBeNull(); // aggregate exists, just not trusted yet
  });

  it('becomes stable once enough low-spread observations accumulate', () => {
    const poses = Array.from({ length: 6 }, () => steadyPose(0));
    const s = evaluateQrPoseStability(poses, {
      minObservations: 5,
      maxRotationSpreadDeg: 5,
      maxTranslationSpreadM: 0.03,
    });
    expect(s.status).toBe('stable');
    expect(s.pose).not.toBeNull();
    expect(s.sampleCount).toBe(6);
  });

  it('stays measuring when the rotation spread is too high', () => {
    // Alternating ±10° rotations → spread ~20°, above the 5° gate.
    const poses = Array.from({ length: 6 }, (_, i) =>
      steadyPose(i % 2 === 0 ? -10 : 10)
    );
    const s = evaluateQrPoseStability(poses, {
      minObservations: 5,
      maxRotationSpreadDeg: 5,
      inlierAngleDeg: 30, // keep them all inliers so spread is measured, not rejected
    });
    expect(s.status).toBe('measuring');
  });

  it('only aggregates the last `window` poses', () => {
    // 3 stale far-away poses then 5 fresh steady ones; window=5 must ignore the stale.
    const stale = Array.from({ length: 3 }, () => ({
      position: [100, 100, 100] as [number, number, number],
      rotation: fromAxisAngle([1, 0, 0], 80),
    }));
    const fresh = Array.from({ length: 5 }, () => steadyPose(0));
    const s = evaluateQrPoseStability([...stale, ...fresh], {
      window: 5,
      minObservations: 5,
    });
    expect(s.status).toBe('stable');
    expect(s.sampleCount).toBe(5);
    expect(s.pose!.position[0]).toBeCloseTo(0, 6); // stale [100,…] excluded
  });
});
