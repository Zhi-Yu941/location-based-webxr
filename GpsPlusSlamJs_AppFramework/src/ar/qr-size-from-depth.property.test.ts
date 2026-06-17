/**
 * QR size from depth — property tests.
 *
 * Why this test matters: depth gives METRIC scale, so the recovered size must
 * match the printed size for any size, distance, and viewing angle (not just
 * fronto-parallel) — that angle-robustness is the whole point of measuring from
 * depth rather than solvePnP. A garbage (non-planar) read must score low.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mat4, vec3, vec4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types';
import { createDepthUnprojector } from './depth-unprojection';
import {
  estimateQrSizeFromDepth,
  estimateQrSizeFromDepthDense,
  type ScreenPoint,
} from './qr-size-from-depth';

const ORIGIN: Vector3 = [0, 0, 0];
const IDENTITY: Quaternion = [0, 0, 0, 1];
const P = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

function project(world: Vector3): DepthPoint {
  const clip = vec4.transformMat4(
    vec4.create(),
    [world[0], world[1], world[2], 1],
    P
  );
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  return {
    screenX: (ndcX + 1) / 2,
    screenY: (1 - ndcY) / 2,
    depthM: -world[2],
  };
}

/** A square of side `s` centered at `center`, yaw-tilted by `angle` about Y. */
function tiltedSquare(
  s: number,
  center: Vector3,
  angle: number
): [Vector3, Vector3, Vector3, Vector3] {
  const h = s / 2;
  // Local plane coords (TL, TR, BR, BL), then rotate about Y and translate.
  const local: Vector3[] = [
    [-h, h, 0],
    [h, h, 0],
    [h, -h, 0],
    [-h, -h, 0],
  ];
  const rot = mat4.fromYRotation(mat4.create(), angle);
  return local.map((p) => {
    const r = vec3.transformMat4(vec3.create(), p, rot);
    return [r[0] + center[0], r[1] + center[1], r[2] + center[2]] as Vector3;
  }) as [Vector3, Vector3, Vector3, Vector3];
}

const unprojector = () => {
  const u = createDepthUnprojector(ORIGIN, IDENTITY, P);
  if (!u) throw new Error('unprojector');
  return u;
};

/** Bilinear n×n lattice of interior points across a quad (TL,TR,BR,BL). */
function quadLattice(
  quad: [Vector3, Vector3, Vector3, Vector3],
  n: number
): Vector3[] {
  const [tl, tr, br, bl] = quad;
  const lerp = (a: Vector3, b: Vector3, t: number): Vector3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const v = i / (n - 1);
    const top = lerp(tl, tr, v);
    const bottom = lerp(bl, br, v);
    for (let j = 0; j < n; j++) {
      pts.push(lerp(top, bottom, j / (n - 1)));
    }
  }
  return pts;
}

const screenOf = (world: Vector3): ScreenPoint => {
  const p = project(world);
  return { screenX: p.screenX, screenY: p.screenY };
};

describe('estimateQrSizeFromDepthDense properties', () => {
  it('recovers the printed size from interior reads for any size / distance / yaw', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 0.8, noNaN: true }),
        fc.double({ min: 1.5, max: 8, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -Math.PI / 3, max: Math.PI / 3, noNaN: true }),
        (s, d, x, angle) => {
          const quad = tiltedSquare(s, [x, 0, -d], angle);
          const samples = quadLattice(quad, 5).map(project);
          const obs = estimateQrSizeFromDepthDense(
            [
              screenOf(quad[0]),
              screenOf(quad[1]),
              screenOf(quad[2]),
              screenOf(quad[3]),
            ],
            samples,
            unprojector()
          );
          expect(obs).not.toBeNull();
          expect(Math.abs(obs!.sizeM - s)).toBeLessThan(5e-3 * Math.max(1, s));
          expect(obs!.quality).toBeGreaterThan(0.9);
        }
      )
    );
  });

  it('stays accurate when a minority of interior reads are gross outliers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        fc.double({ min: 2, max: 6, noNaN: true }),
        fc.integer({ min: 0, max: 4 }), // how many of 36 reads to corrupt
        (s, d, badCount) => {
          const quad = tiltedSquare(s, [0, 0, -d], 0);
          const samples = quadLattice(quad, 6).map(project);
          for (let k = 0; k < badCount; k++) {
            const i = (k * 7 + 3) % samples.length;
            samples[i] = { ...samples[i]!, depthM: samples[i]!.depthM + 0.5 };
          }
          const obs = estimateQrSizeFromDepthDense(
            [
              screenOf(quad[0]),
              screenOf(quad[1]),
              screenOf(quad[2]),
              screenOf(quad[3]),
            ],
            samples,
            unprojector()
          );
          expect(obs).not.toBeNull();
          // Outliers are rejected, not averaged in → size stays close to truth.
          expect(Math.abs(obs!.sizeM - s)).toBeLessThan(0.02 * Math.max(1, s));
        }
      )
    );
  });
});

describe('estimateQrSizeFromDepth properties', () => {
  it('recovers the printed size for any size / distance / viewing angle', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 1, noNaN: true }), // size
        fc.double({ min: 1.5, max: 8, noNaN: true }), // distance
        fc.double({ min: -0.6, max: 0.6, noNaN: true }), // x offset
        fc.double({ min: -Math.PI / 3, max: Math.PI / 3, noNaN: true }), // yaw
        (s, d, x, angle) => {
          const [tl, tr, br, bl] = tiltedSquare(s, [x, 0, -d], angle);
          const obs = estimateQrSizeFromDepth(
            [project(tl), project(tr), project(br), project(bl)],
            [],
            unprojector()
          );
          expect(obs).not.toBeNull();
          // Metric scale from depth → size within a tight tolerance.
          expect(Math.abs(obs!.sizeM - s)).toBeLessThan(1e-3 * Math.max(1, s));
          expect(obs!.quality).toBeGreaterThan(0.98);
        }
      )
    );
  });

  it('scores a non-planar quad low (one corner shifted off the plane)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 0.5, noNaN: true }),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }), // off-plane shift
        (s, shift) => {
          const [tl, tr, br, bl] = tiltedSquare(s, [0, 0, -3], 0);
          // Push TL toward/away from the camera so it leaves the QR plane.
          const badTl: Vector3 = [tl[0], tl[1], tl[2] + shift];
          const obs = estimateQrSizeFromDepth(
            [project(badTl), project(tr), project(br), project(bl)],
            [],
            unprojector()
          );
          // It may still produce a number, but quality must reflect the defect.
          expect(obs === null || obs.quality < 0.95).toBe(true);
        }
      )
    );
  });
});
