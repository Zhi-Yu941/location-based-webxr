/**
 * Tests for `createQrSizeDepthContext` — the shared factory that builds a
 * {@link QrSizeDepthContext} (unprojector + bilinear grid lookup) from one
 * {@link DepthSample}.
 *
 * Why this matters: the QR-tracking demo (`seams.getDepthContext`) and the
 * Recorder live-QR resolver (`qr-depth-resolver.contextFromSample`) both built
 * this exact wiring independently — a divergence risk (e.g. one switching the
 * grid lookup from bilinear to nearest would silently make the two apps measure
 * different QR sizes). These tests pin the single factory's contract:
 * (1) `null` when the sample has no / a singular projection (no unprojector),
 * (2) a usable unprojector + `depthAt` for a valid sample, and
 * (3) `depthAt` reads the depth grid (bilinear), not a constant.
 */

import { describe, it, expect } from 'vitest';
import type { Matrix4, Quaternion, Vector3 } from '../core/index.js';
import type { DepthPoint, DepthSample } from '../types/ar-types.js';
import { createQrSizeDepthContext } from './qr-size-depth-context.js';

/** An invertible projection so `createDepthUnprojector` yields a real unprojector. */
const IDENTITY_PROJ = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
] as unknown as Matrix4;

/** A singular (non-invertible) projection — all zeros → no unprojector. */
const SINGULAR_PROJ = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
] as unknown as Matrix4;

const camPos = [0, 0, 0] as Vector3;
const camRot = [0, 0, 0, 1] as Quaternion;

/**
 * A 2×2 grid whose depth varies in screenX so a bilinear lookup at the midpoint
 * returns the average — distinguishing real interpolation from a constant.
 */
function rampGrid(): DepthPoint[] {
  return [
    { screenX: 1 / 3, screenY: 1 / 3, depthM: 1 },
    { screenX: 2 / 3, screenY: 1 / 3, depthM: 3 },
    { screenX: 1 / 3, screenY: 2 / 3, depthM: 1 },
    { screenX: 2 / 3, screenY: 2 / 3, depthM: 3 },
  ];
}

function sample(projectionMatrix: Matrix4 | undefined): DepthSample {
  return {
    timestamp: 0,
    cameraPos: camPos,
    cameraRot: camRot,
    points: rampGrid(),
    ...(projectionMatrix ? { projectionMatrix } : {}),
  };
}

describe('createQrSizeDepthContext', () => {
  it('returns null when the sample has no projection matrix', () => {
    expect(createQrSizeDepthContext(sample(undefined))).toBeNull();
  });

  it('returns null when the projection matrix is singular (no unprojector)', () => {
    expect(createQrSizeDepthContext(sample(SINGULAR_PROJ))).toBeNull();
  });

  it('builds an unprojector + depthAt for a valid sample', () => {
    const ctx = createQrSizeDepthContext(sample(IDENTITY_PROJ));
    expect(ctx).not.toBeNull();
    // A usable point unprojects to a 3-vector (not null).
    const world = ctx!.unprojector.unproject({
      screenX: 0.5,
      screenY: 0.5,
      depthM: 2,
    });
    expect(world).not.toBeNull();
    expect(world).toHaveLength(3);
  });

  it('reads the depth grid via bilinear interpolation, not a constant', () => {
    const ctx = createQrSizeDepthContext(sample(IDENTITY_PROJ));
    // Midpoint of the screenX ramp (1 at x=1/3, 3 at x=2/3) → average 2.
    expect(ctx!.depthAt(0.5, 0.5)).toBeCloseTo(2, 6);
    // Nearer the low-depth column reads below the midpoint (proves it is not
    // returning one constant node).
    const low = ctx!.depthAt(1 / 3, 0.5);
    expect(low).not.toBeNull();
    expect(low!).toBeLessThan(2);
  });
});
