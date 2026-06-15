/**
 * QR detection scheduler — unit tests.
 *
 * Why this test matters: these pin the three runtime behaviors that keep the
 * heavy detection off the render thread and reject one-off bad reads — throttle
 * (≤ one start per interval), coalesce (no overlapping detections), and the
 * N-consecutive-lock gate with miss/error reset. The clock and the async detect
 * are injected so the timing is deterministic.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createQrDetectionScheduler,
  type QrDetectionScheduler,
} from './qr-detection-scheduler';
import type { QrPoseSolution } from './qr-pose';
import type { RgbaImage } from './qr-frontend';

const image: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};

const solution: QrPoseSolution = {
  qrPoseWorld: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
  reprojectionErrorPx: 0,
};

/** A controllable async `detect` whose pending promises we resolve by hand. */
function controllableDetect() {
  type Deferred = {
    resolve: (v: QrPoseSolution | null) => void;
    reject: (e: unknown) => void;
  };
  const deferreds: Deferred[] = [];
  const detect = vi.fn(
    () =>
      new Promise<QrPoseSolution | null>((resolve, reject) => {
        deferreds.push({ resolve, reject });
      })
  );
  // Flush the .then/.catch/.finally microtask chain.
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  async function settle(value: QrPoseSolution | null): Promise<void> {
    deferreds.shift()?.resolve(value);
    await flush();
  }
  async function reject(err: unknown): Promise<void> {
    deferreds.shift()?.reject(err);
    await flush();
  }
  return { detect, settle, reject };
}

describe('createQrDetectionScheduler', () => {
  it('throttles detection starts to one per minIntervalMs', async () => {
    let t = 0;
    const { detect, settle } = controllableDetect();
    const s = createQrDetectionScheduler({
      detect,
      minIntervalMs: 100,
      now: () => t,
    });

    s.offerFrame(image); // t=0 → starts #1
    expect(detect).toHaveBeenCalledTimes(1);
    await settle(null); // clear in-flight

    t = 50;
    s.offerFrame(image); // throttled (50 < 100)
    expect(detect).toHaveBeenCalledTimes(1);

    t = 100;
    s.offerFrame(image); // allowed
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('coalesces: never starts a second detection while one is in flight', async () => {
    const t = 0;
    const { detect, settle } = controllableDetect();
    const s = createQrDetectionScheduler({
      detect,
      minIntervalMs: 0,
      now: () => t,
    });

    s.offerFrame(image); // starts #1 (pending)
    expect(s.inFlight).toBe(true);
    s.offerFrame(image); // coalesced
    s.offerFrame(image); // coalesced
    expect(detect).toHaveBeenCalledTimes(1);

    await settle(null);
    expect(s.inFlight).toBe(false);
    s.offerFrame(image); // now allowed
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('locks only after N consecutive successes and resets on a miss', async () => {
    let t = 0;
    const onLocked = vi.fn();
    const onMiss = vi.fn();
    const { detect, settle } = controllableDetect();
    const s: QrDetectionScheduler = createQrDetectionScheduler({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 3,
      now: () => t,
      onLocked,
      onMiss,
    });

    const tick = async (value: QrPoseSolution | null) => {
      t += 1;
      s.offerFrame(image);
      await settle(value);
    };

    await tick(solution);
    expect(s.consecutiveLocks).toBe(1);
    expect(s.locked).toBe(false);
    await tick(solution);
    expect(s.locked).toBe(false);
    await tick(solution); // 3rd → lock
    expect(s.locked).toBe(true);
    expect(onLocked).toHaveBeenCalledTimes(1);

    await tick(solution); // stays locked, fires again, count capped
    expect(onLocked).toHaveBeenCalledTimes(2);
    expect(s.consecutiveLocks).toBe(3);

    await tick(null); // miss resets
    expect(s.consecutiveLocks).toBe(0);
    expect(s.locked).toBe(false);
    expect(onMiss).toHaveBeenCalledTimes(1);
  });

  it('resets the counter and reports when detect rejects', async () => {
    let t = 0;
    const onError = vi.fn();
    const { detect, settle, reject } = controllableDetect();
    const s = createQrDetectionScheduler({
      detect,
      minIntervalMs: 0,
      requiredLockCount: 2,
      now: () => t,
      onError,
    });

    t = 1;
    s.offerFrame(image);
    await settle(solution);
    expect(s.consecutiveLocks).toBe(1);

    t = 2;
    s.offerFrame(image);
    await reject(new Error('detector blew up'));
    expect(s.consecutiveLocks).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(s.inFlight).toBe(false);
  });
});
