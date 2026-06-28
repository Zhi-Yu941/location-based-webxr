/**
 * Example + edge-case tests for COLMAP coordinate + intrinsics conversions.
 *
 * Why this test file matters:
 * Complements the property tests with concrete, hand-verifiable fixtures (so a
 * regression points at a specific wrong number, not just "a property failed")
 * and pins the error paths. Includes a deliberately NON-identity pose because
 * identity fixtures hide axis/sign bugs (lessons-learned, repeatedly).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from 'gps-plus-slam-app-framework/core';
import {
  webxrToColmapPose,
  webxrToColmapWorldPoint,
  pinholeFromProjection,
} from './colmap-conversions';

describe('webxrToColmapPose', () => {
  it('identity WebXR pose → identity extrinsic (camera flip cancels world flip)', () => {
    // Camera at origin looking down −Z (WebXR). The extrinsic now expresses the
    // pose in the COLMAP *world* frame (Y-down gravity, the upside-down fix —
    // follow-up Item B), so the camera-frame flip (180° about X) and the
    // world-frame flip (also 180° about X) cancel: the extrinsic is identity.
    const { qvec, tvec } = webxrToColmapPose([0, 0, 0], [0, 0, 0, 1]);
    expect(Math.abs(qvec[0])).toBeCloseTo(1, 6); // qw (sign is gauge-free)
    expect(qvec[1]).toBeCloseTo(0, 6);
    expect(qvec[2]).toBeCloseTo(0, 6);
    expect(qvec[3]).toBeCloseTo(0, 6);
    expect(tvec[0]).toBeCloseTo(0, 6);
    expect(tvec[1]).toBeCloseTo(0, 6);
    expect(tvec[2]).toBeCloseTo(0, 6);
  });

  it('a point straight ahead lands on the +Z axis in front of the camera', () => {
    // Camera at (1,2,3) looking down −Z (identity rotation). A world point 5 m
    // in front of it (along −Z in WebXR) must sit at COLMAP cam (0,0,5): +Z
    // forward, centered. The extrinsic now lives in the COLMAP world frame, so
    // the world point is fed through the SAME flip the points export applies —
    // proving cameras and points stay registered (the camera coords of the
    // physical point are unchanged by the world basis change).
    const camPos: Vector3 = [1, 2, 3];
    const { qvec, tvec } = webxrToColmapPose(camPos, [0, 0, 0, 1]);
    const worldPoint = new THREE.Vector3(
      ...webxrToColmapWorldPoint([1, 2, 3 - 5]) // 5 m along −Z, flipped
    );
    const rot = new THREE.Quaternion(qvec[1], qvec[2], qvec[3], qvec[0]);
    const cam = worldPoint.applyQuaternion(rot).add(new THREE.Vector3(...tvec));
    expect(cam.x).toBeCloseTo(0, 5);
    expect(cam.y).toBeCloseTo(0, 5);
    expect(cam.z).toBeCloseTo(5, 5); // 5 m forward in COLMAP (+Z)
  });

  it('a point above the camera maps to NEGATIVE Y in COLMAP (Y is down)', () => {
    const camPos: Vector3 = [0, 0, 0];
    const { qvec, tvec } = webxrToColmapPose(camPos, [0, 0, 0, 1]);
    // 1 m up (+Y WebXR) and 5 m forward (−Z), fed through the world flip.
    const worldPoint = new THREE.Vector3(
      ...webxrToColmapWorldPoint([0, 1, -5])
    );
    const rot = new THREE.Quaternion(qvec[1], qvec[2], qvec[3], qvec[0]);
    const cam = worldPoint.applyQuaternion(rot).add(new THREE.Vector3(...tvec));
    expect(cam.y).toBeCloseTo(-1, 5); // up in WebXR → down (negative Y) in COLMAP
    expect(cam.z).toBeCloseTo(5, 5);
  });

  it('non-trivial rotated pose round-trips a world point correctly', () => {
    const camPos: Vector3 = [2, -1, 4];
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.3, -0.7, 0.4, 'XYZ')
    );
    const camRot: Quaternion = [q.x, q.y, q.z, q.w];
    const { qvec, tvec } = webxrToColmapPose(camPos, camRot);

    const worldPoint: Vector3 = [5, 6, 7];
    // Expected COLMAP camera coords of the PHYSICAL point: WebXR view coords
    // then the camera basis change (negate Y,Z). Invariant under the world flip.
    const camToWorld = new THREE.Matrix4().compose(
      new THREE.Vector3(...camPos),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    const viewWebxr = new THREE.Vector3(...worldPoint).applyMatrix4(
      camToWorld.clone().invert()
    );
    const expected = new THREE.Vector3(viewWebxr.x, -viewWebxr.y, -viewWebxr.z);

    // Actual: feed the flipped world point through the extrinsic.
    const rot = new THREE.Quaternion(qvec[1], qvec[2], qvec[3], qvec[0]);
    const actual = new THREE.Vector3(...webxrToColmapWorldPoint(worldPoint))
      .applyQuaternion(rot)
      .add(new THREE.Vector3(...tvec));
    expect(actual.x).toBeCloseTo(expected.x, 5);
    expect(actual.y).toBeCloseTo(expected.y, 5);
    expect(actual.z).toBeCloseTo(expected.z, 5);
  });
});

describe('pinholeFromProjection', () => {
  it('recovers W/2, H/2 principal point from a symmetric frustum', () => {
    const W = 1280;
    const H = 960;
    // Symmetric perspective: m20 = m21 = 0, m00 = 2fx/W, m11 = 2fy/H.
    const fx = 1000;
    const fy = 1100;
    const m = new Array(16).fill(0) as number[];
    m[0] = (2 * fx) / W;
    m[5] = (2 * fy) / H;
    m[10] = -1;
    m[11] = -1;
    m[14] = -0.2;
    const intr = pinholeFromProjection(m as unknown as Matrix4, W, H);
    expect(intr.fx).toBeCloseTo(fx, 4);
    expect(intr.fy).toBeCloseTo(fy, 4);
    expect(intr.cx).toBeCloseTo(W / 2, 4);
    expect(intr.cy).toBeCloseTo(H / 2, 4);
  });

  it('throws on a non-16-length or non-finite matrix', () => {
    expect(() =>
      pinholeFromProjection([1, 2, 3] as unknown as Matrix4, 100, 100)
    ).toThrow(RangeError);
    const bad = new Array(16).fill(0) as number[];
    bad[0] = Number.NaN;
    expect(() =>
      pinholeFromProjection(bad as unknown as Matrix4, 100, 100)
    ).toThrow(RangeError);
  });

  it('throws on non-positive width/height', () => {
    const m = new Array(16).fill(0) as number[];
    m[0] = 1.5;
    m[5] = 1.5;
    expect(() =>
      pinholeFromProjection(m as unknown as Matrix4, 0, 100)
    ).toThrow(RangeError);
    expect(() =>
      pinholeFromProjection(m as unknown as Matrix4, 100, -10)
    ).toThrow(RangeError);
  });

  it('throws when the matrix yields a non-positive focal length', () => {
    const m = new Array(16).fill(0) as number[];
    m[0] = 0; // fx = 0
    m[5] = 1.5;
    expect(() =>
      pinholeFromProjection(m as unknown as Matrix4, 100, 100)
    ).toThrow(RangeError);
  });
});
