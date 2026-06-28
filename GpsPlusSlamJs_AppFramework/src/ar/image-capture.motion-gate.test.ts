/**
 * Integration tests for the motion gate inside ImageCaptureManager.
 *
 * Why this matters: the pure helpers are unit-tested elsewhere; these tests pin
 * the WIRING — that a synthetic fast→calm pose sequence makes the manager defer
 * a due capture while moving and fire on the first genuinely-calm frame, that
 * the never-calm safety fallback eventually fires, that disabling the filter
 * restores legacy interval capture, and that a glitch frame is not grabbed.
 * See 2026-06-23-blurry-frame-motion-gating-plan.md §4.3-4.5, §6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ImageCaptureManager,
  type ImageCaptureCallbacks,
  type ImageCaptureConfig,
  type CapturedImage,
  DEFAULT_CAPTURE_CONFIG,
} from './image-capture';
import { DEFAULT_MOTION_FILTER } from './capture-motion-gate';

/** Unit quaternion (WebXR object form) for a rotation of `angle` rad about Y. */
function yQuat(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

describe('ImageCaptureManager — motion gate', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockCallbacks: ImageCaptureCallbacks;
  let manager: ImageCaptureManager;
  let currentPose: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };

  /** Set the pose for the next frame and drive one onFrame. */
  function frame(t: number, angle: number, pos = { x: 0, y: 0, z: 0 }): void {
    currentPose = { position: pos, orientation: yQuat(angle) };
    manager.onFrame(t);
  }

  /** Drive one onFrame where tracking has been lost (getCurrentPose → null). */
  function frameNoPose(t: number): void {
    (
      mockCallbacks.getCurrentPose as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce(null);
    manager.onFrame(t);
  }

  /** Wait until `n` captures have fully completed (captureInProgress reset). */
  async function flushCaptures(n: number): Promise<void> {
    await vi.waitFor(() =>
      expect(mockCallbacks.onCaptured).toHaveBeenCalledTimes(n)
    );
  }

  function toBlobCalls(): number {
    return (mockCanvas.toBlob as ReturnType<typeof vi.fn>).mock.calls.length;
  }

  beforeEach(() => {
    mockCanvas = {
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        const blob = new Blob(['fake image data'], {
          type: type || 'image/jpeg',
        });
        setTimeout(() => callback(blob), 0);
      }),
      width: 1920,
      height: 1080,
    } as unknown as HTMLCanvasElement;

    currentPose = { position: { x: 0, y: 0, z: 0 }, orientation: yQuat(0) };
    mockCallbacks = {
      getCurrentPose: vi.fn(() => currentPose),
      getScreenRotation: vi.fn(() => 0),
      onCaptured: vi.fn(),
    };
  });

  afterEach(() => {
    manager?.stop();
  });

  it('defers a due capture during fast rotation and fires on the first calm frame', async () => {
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
    manager.start();

    // First capture is immediate (no motion data yet → gate is bypassed). Use a
    // realistic non-zero frame time: a capture at t=0 would set lastCaptureTime
    // to 0, which the interval guard reads as "never captured".
    frame(1000, 0);
    await flushCaptures(1);
    expect(toBlobCalls()).toBe(1);

    // Build a window of fast rotation just before the next due time (3000ms).
    frame(2968, 0); // first post-capture sample (slow)
    frame(2984, 0.2); // dt 16ms, 0.2 rad → 12.5 rad/s (fast)
    frame(3000, 0.4); // due AND fast → defer
    expect(toBlobCalls()).toBe(1);

    // Rotation stops, but the window still carries the fast samples.
    frame(3016, 0.4); // window: [12.5, 12.5, 0] → still fast
    frame(3032, 0.4); // window: [12.5, 0, 0] → still fast
    expect(toBlobCalls()).toBe(1);

    // Window now fully calm → capture fires on this frame.
    frame(3048, 0.4); // window: [0, 0, 0] → calm
    expect(toBlobCalls()).toBe(2);
    await flushCaptures(2);

    // lastCaptureTime tracks the REAL (deferred) capture time: the 2nd capture's
    // timestamp is derived from t=3048, not the nominal due time 3000.
    const onCapturedMock = mockCallbacks.onCaptured as ReturnType<typeof vi.fn>;
    const secondImage = onCapturedMock.mock.calls[1][0] as CapturedImage;
    expect(secondImage.timestamp).toBe(performance.timeOrigin + 3048);
  });

  it('fires the never-calm safety fallback after maxWaitMs of continuous motion', async () => {
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
    manager.start();

    frame(1000, 0);
    await flushCaptures(1);

    // Continuous ~1 rad/s rotation (> 0.6 threshold) from the due time onward.
    // dueTime = 3000; maxWaitMs = 4000 → fallback fires once t >= 7000.
    for (let t = 3000; t <= 6500; t += 500) {
      frame(t, t / 1000); // angle grows 1 rad per second → ~1 rad/s
    }
    expect(toBlobCalls()).toBe(1); // still deferred up to 6500 (msSinceDue 3500)

    frame(7000, 7.0); // msSinceDue = 4000 ≥ maxWaitMs → capture regardless
    expect(toBlobCalls()).toBe(2);
    await flushCaptures(2);
  });

  it('captures at the interval regardless of motion when the filter is disabled', async () => {
    const config: ImageCaptureConfig = {
      ...DEFAULT_CAPTURE_CONFIG,
      motionFilter: { ...DEFAULT_MOTION_FILTER, enabled: false },
    };
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks, config);
    manager.start();

    frame(1000, 0);
    await flushCaptures(1);

    // Fast rotation at the due time — with the gate off this captures anyway.
    frame(2984, 0.0);
    frame(3000, 0.4); // due + fast, but filter disabled
    expect(toBlobCalls()).toBe(2);
    await flushCaptures(2);
  });

  it('resets motion history on tracking loss so a calm frame after recovery is not blocked by stale maxima', async () => {
    // Regression: a `!pose` frame (tracking loss) left prevPose/prevTime and the
    // sliding window intact. The first post-loss sample was then computed across
    // the whole outage gap (violating the "instantaneous motion" assumption), and
    // stale pre-loss fast maxima kept deferring captures after recovery.
    // MotionWindow.reset()'s own doc says it should be cleared "on tracking loss".
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
    manager.start();

    frame(1000, 0);
    await flushCaptures(1);

    // Build a window of fast rotation just before the next due time (3000ms).
    frame(2968, 0); // slow first post-capture sample
    frame(2984, 0.2); // 12.5 rad/s (fast)
    frame(3000, 0.4); // due AND fast → defer
    expect(toBlobCalls()).toBe(1);

    // Tracking is lost for one frame, then recovers at a genuinely calm pose.
    frameNoPose(3016);
    frame(3032, 0.4); // calm (no rotation), still due

    // Without the reset, the stale [.,12.5,.] window keeps deferring here. With
    // the reset, the window is empty → treated as the first post-recovery sample
    // → the due capture fires.
    expect(toBlobCalls()).toBe(2);
    await flushCaptures(2);
  });

  it('does not grab a frame whose own sample is a tracking glitch', async () => {
    manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
    manager.start();

    frame(1000, 0, { x: 0, y: 0, z: 0 });
    await flushCaptures(1);

    // Two calm samples, then the due frame is a position teleport
    // (relocalization): linear velocity ~62500 m/s ≫ glitch ceiling.
    frame(2968, 0, { x: 0, y: 0, z: 0 });
    frame(2984, 0, { x: 0, y: 0, z: 0 });
    frame(3000, 0, { x: 1000, y: 0, z: 0 }); // due, but THIS frame is a glitch
    // Window maxima (from the two calm samples) are calm, yet we must not grab
    // the glitch frame itself.
    expect(toBlobCalls()).toBe(1);

    // A clean, calm frame near the teleported position → capture.
    frame(3016, 0, { x: 1000.001, y: 0, z: 0 });
    expect(toBlobCalls()).toBe(2);
    await flushCaptures(2);
  });
});
