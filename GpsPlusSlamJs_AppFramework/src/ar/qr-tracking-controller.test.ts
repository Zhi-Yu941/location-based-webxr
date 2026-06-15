/**
 * QR tracking controller — unit tests.
 *
 * Why this test matters: this pins the async-UI state machine the demonstrator
 * relies on (idle→scanning→loading-level→tracking, error on failure), the level
 * cache (one fetch per URL), and that a lock actually dispatches the synthetic
 * votes. Every dependency is faked so the orchestration is tested without WASM,
 * a device, or a real store.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createQrTrackingController,
  type QrTrackingStatus,
} from './qr-tracking-controller';
import type { QrPoseSolution } from './qr-pose';
import type { QrLevel } from './qr-level';
import type { RgbaImage, QrDetection, QrFrontEnd } from './qr-frontend';

const image: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};
const corners: QrDetection['corners'] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const detection: QrDetection = { corners, text: 'https://lvl/1' };

const level: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  },
};

const solution: QrPoseSolution = {
  qrPoseWorld: { position: [1, 2, -3], rotation: [0, 0, 0, 1] },
  qrPoseInCamera: { position: [0, 0, -1.5], rotation: [0, 0, 0, 1] },
  reprojectionErrorPx: 0.5,
};

const cameraPose = {
  position: [0, 0, 0] as const,
  rotation: [0, 0, 0, 1] as const,
};
const intrinsics = { fx: 600, fy: 600, cx: 320, cy: 240 };

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(
  overrides: Partial<Parameters<typeof createQrTrackingController>[0]> = {}
) {
  const statuses: QrTrackingStatus[] = [];
  const dispatched: unknown[] = [];
  const frontEnd: QrFrontEnd = {
    kind: 'barcode-detector',
    detect: vi.fn(() => Promise.resolve<QrDetection | null>(detection)),
  };
  const fetchLevel = vi.fn(() => Promise.resolve(level));
  const controller = createQrTrackingController({
    frontEnd,
    solvePose: () => solution,
    fetchLevel,
    dispatchVotes: (votes) => dispatched.push(...votes),
    getCameraPose: () => cameraPose,
    getIntrinsics: () => intrinsics,
    syntheticAccuracyM: 0.05,
    requiredLockCount: 2,
    minIntervalMs: 0,
    onStatus: (s) => statuses.push(s),
    ...overrides,
  });
  return { controller, statuses, dispatched, frontEnd, fetchLevel };
}

async function tick(controller: { offerFrame: (i: RgbaImage) => void }) {
  controller.offerFrame(image);
  await flush();
}

describe('createQrTrackingController', () => {
  it('progresses idle → scanning → loading-level → tracking and dispatches votes', async () => {
    const { controller, statuses, dispatched } = setup();
    expect(controller.status).toBe('idle');

    await tick(controller); // 1st detect: scanning, loading-level, 1 success
    await tick(controller); // 2nd detect: lock → tracking + votes

    expect(controller.status).toBe('tracking');
    expect(statuses).toEqual(['scanning', 'loading-level', 'tracking']);
    expect(dispatched).toHaveLength(4); // 4-corner multi-correspondence
  });

  it('fetches the level only once per URL (cache)', async () => {
    const { controller, fetchLevel } = setup();
    await tick(controller);
    await tick(controller);
    await tick(controller);
    expect(fetchLevel).toHaveBeenCalledTimes(1);
  });

  it('goes to error and reports when the level fetch fails', async () => {
    const onError = vi.fn();
    const { controller, statuses } = setup({
      fetchLevel: vi.fn(() => Promise.reject(new Error('404'))),
      onError,
    });
    await tick(controller);
    expect(controller.status).toBe('error');
    expect(statuses).toContain('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stays scanning when no QR is detected', async () => {
    const { controller, dispatched } = setup({
      frontEnd: {
        kind: 'barcode-detector',
        detect: () => Promise.resolve(null),
      },
    });
    await tick(controller);
    expect(controller.status).toBe('scanning');
    expect(dispatched).toHaveLength(0);
  });

  it('does not lock when the plausibility gate rejects the pose', async () => {
    const { controller, dispatched } = setup({ isPlausible: () => false });
    await tick(controller);
    await tick(controller);
    expect(dispatched).toHaveLength(0);
    expect(controller.status).not.toBe('tracking');
  });

  it('reset() clears the cache and returns to idle', async () => {
    const { controller, fetchLevel } = setup();
    await tick(controller);
    controller.reset();
    expect(controller.status).toBe('idle');
    await tick(controller);
    await tick(controller);
    expect(fetchLevel).toHaveBeenCalledTimes(2); // cache cleared → refetched
  });
});
