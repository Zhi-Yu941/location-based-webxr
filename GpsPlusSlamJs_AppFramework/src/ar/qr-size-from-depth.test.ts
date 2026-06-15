/**
 * QR size from depth — unit tests.
 *
 * Why this test matters: this is the measuring stage of the Note 3 size
 * lifecycle. The estimator must recover a known printed size from depth-
 * unprojected corners (metric scale, no solvePnP), score a clean read high and
 * a noisy/non-square read low, and the accumulator must only promote a size to
 * `estimated` once enough low-spread samples agree.
 */

import { describe, it, expect } from 'vitest';
import { mat4, vec4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types';
import { createDepthUnprojector } from './depth-unprojection';
import {
  estimateQrSizeFromDepth,
  createQrSizeAccumulator,
} from './qr-size-from-depth';

const ORIGIN: Vector3 = [0, 0, 0];
const IDENTITY: Quaternion = [0, 0, 0, 1];
const P = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

/** Project a world point (camera at origin, identity rot) to a DepthPoint. */
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

/** TL, TR, BR, BL of a fronto-parallel square of side `s` centered at `center`. */
function frontoSquare(
  s: number,
  center: Vector3
): [Vector3, Vector3, Vector3, Vector3] {
  const h = s / 2;
  const [cx, cy, cz] = center;
  return [
    [cx - h, cy + h, cz],
    [cx + h, cy + h, cz],
    [cx + h, cy - h, cz],
    [cx - h, cy - h, cz],
  ];
}

const unprojector = () => {
  const u = createDepthUnprojector(ORIGIN, IDENTITY, P);
  if (!u) throw new Error('unprojector');
  return u;
};

describe('estimateQrSizeFromDepth', () => {
  it('recovers a known fronto-parallel size with quality ≈ 1', () => {
    const s = 0.2;
    const [tl, tr, br, bl] = frontoSquare(s, [0, 0, -2]);
    const obs = estimateQrSizeFromDepth(
      [project(tl), project(tr), project(br), project(bl)],
      [],
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.sizeM).toBeCloseTo(s, 4);
    expect(obs!.quality).toBeGreaterThan(0.99);
  });

  it('scores a non-square (one corner pushed in depth) low', () => {
    const s = 0.2;
    const [tl, tr, br, bl] = frontoSquare(s, [0, 0, -2]);
    const badTl = project(tl);
    const obs = estimateQrSizeFromDepth(
      [
        { ...badTl, depthM: badTl.depthM + 0.15 },
        project(tr),
        project(br),
        project(bl),
      ],
      [],
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.quality).toBeLessThan(0.8); // rejected by the default gate
  });

  it('returns null when a corner cannot be unprojected (bad depth)', () => {
    const [tl, tr, br, bl] = frontoSquare(0.2, [0, 0, -2]);
    const obs = estimateQrSizeFromDepth(
      [{ ...project(tl), depthM: 0 }, project(tr), project(br), project(bl)],
      [],
      unprojector()
    );
    expect(obs).toBeNull();
  });
});

describe('createQrSizeAccumulator', () => {
  const good = { sizeM: 0.2, quality: 1 };

  it('walks the lifecycle unknown → measuring → estimated', () => {
    const acc = createQrSizeAccumulator({ minSamples: 4, maxSpreadM: 0.01 });
    expect(acc.current().status).toBe('unknown');
    expect(acc.add(good).status).toBe('measuring');
    acc.add(good);
    acc.add(good);
    const est = acc.add({ sizeM: 0.205, quality: 1 }); // 4 samples, spread 0.005
    expect(est.status).toBe('estimated');
    expect(est.estimateM).toBeCloseTo(0.2, 2);
    expect(est.sampleCount).toBe(4);
    expect(est.spreadM).toBeCloseTo(0.005, 6);
  });

  it('stays measuring while the spread is too wide', () => {
    const acc = createQrSizeAccumulator({ minSamples: 2, maxSpreadM: 0.01 });
    acc.add({ sizeM: 0.2, quality: 1 });
    const est = acc.add({ sizeM: 0.25, quality: 1 }); // spread 0.05 > 0.01
    expect(est.status).toBe('measuring');
  });

  it('ignores low-quality and null observations', () => {
    const acc = createQrSizeAccumulator({ qualityThreshold: 0.8 });
    expect(acc.add({ sizeM: 0.2, quality: 0.5 }).sampleCount).toBe(0);
    expect(acc.add(null).sampleCount).toBe(0);
    expect(acc.add(good).sampleCount).toBe(1);
  });

  it('reset() drops back to unknown', () => {
    const acc = createQrSizeAccumulator();
    acc.add(good);
    acc.reset();
    expect(acc.current().status).toBe('unknown');
  });
});
