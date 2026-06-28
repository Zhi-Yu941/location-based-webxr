/**
 * Tests for image-capture module
 *
 * Why these tests matter:
 * - Image capture is a critical feature for recording visual context
 * - Canvas operations and blob handling need careful testing
 * - Timing logic must be correct to avoid excessive captures
 * - Integration with store and file system must work correctly
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  expectTypeOf,
} from 'vitest';
import {
  ImageCaptureManager,
  type ImageCaptureConfig,
  type ImageCaptureCallbacks,
  type CapturedImage,
  type CapturedFrame,
  DEFAULT_CAPTURE_CONFIG,
  MIN_VALID_IMAGE_BYTES,
} from './image-capture';
import type { ARPose } from '../types/ar-types';

describe('image-capture', () => {
  describe('DEFAULT_CAPTURE_CONFIG', () => {
    it('has sensible default values', () => {
      // Why this test matters: ensures defaults are reasonable
      expect(DEFAULT_CAPTURE_CONFIG.intervalMs).toBe(2000);
      expect(DEFAULT_CAPTURE_CONFIG.quality).toBeGreaterThan(0);
      expect(DEFAULT_CAPTURE_CONFIG.quality).toBeLessThanOrEqual(1);
    });
  });

  describe('MIN_VALID_IMAGE_BYTES', () => {
    /**
     * Why this test matters:
     * The minimum valid image size threshold is used to detect suspicious
     * (likely black/empty) images. It should be set to a reasonable value
     * that catches obviously broken captures without false positives.
     * A real camera JPEG at 0.7 quality is typically 50KB+.
     */
    it('has a reasonable threshold value', () => {
      expect(MIN_VALID_IMAGE_BYTES).toBeGreaterThan(1000);
      expect(MIN_VALID_IMAGE_BYTES).toBeLessThan(20000);
    });
  });

  describe('ImageCaptureManager', () => {
    let mockCanvas: HTMLCanvasElement;
    let mockCallbacks: ImageCaptureCallbacks;
    let manager: ImageCaptureManager;

    beforeEach(() => {
      // Create mock canvas with toBlob support
      mockCanvas = {
        toBlob: vi.fn(
          (callback: BlobCallback, type?: string, _quality?: number) => {
            // Simulate async blob creation
            const blob = new Blob(['fake image data'], {
              type: type || 'image/jpeg',
            });
            setTimeout(() => callback(blob), 0);
          }
        ),
        width: 1920,
        height: 1080,
      } as unknown as HTMLCanvasElement;

      mockCallbacks = {
        getCurrentPose: vi.fn(() => ({
          position: { x: 1, y: 2, z: 3 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        })),
        getScreenRotation: vi.fn(() => 0),
        onCaptured: vi.fn(),
      };
    });

    afterEach(() => {
      if (manager) {
        manager.stop();
      }
    });

    it('should not capture when not started', () => {
      // Why this test matters: prevents accidental captures before session starts
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);

      // Try to trigger a capture check
      manager.onFrame(1000);
      manager.onFrame(5000);

      expect(mockCanvas.toBlob).not.toHaveBeenCalled();
    });

    it('should capture immediately on first frame after start', async () => {
      // Why this test matters: first capture should happen immediately
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000);

      // Wait for async toBlob callback
      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
      });
    });

    it('does not save a frame whose encode completes after stop() (legacy path)', async () => {
      // The default config has no quality gate, so a captured blob saves
      // synchronously in the toBlob callback. If stop() lands while toBlob is
      // still encoding (the common case — the gate is off by default), the late
      // callback ran saveCapture → onCaptured on a stopped session, writing a
      // frame after teardown that the recorded frameCount never saw.
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000); // schedules toBlob (callback deferred to a macrotask)
      expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
      manager.stop(); // stop before the encode callback fires

      await new Promise((r) => setTimeout(r, 0)); // toBlob callback fires now

      expect(mockCallbacks.onCaptured).not.toHaveBeenCalled();
      expect(manager.getFrameCount()).toBe(0);
    });

    it('re-arms the quality gate after a tracking-loss outage longer than maxWaitMs', async () => {
      // Regression: `qualityDeadlineBase` (the never-good fallback clock) is
      // measured from the FIRST quality attempt of an interval and only cleared
      // on save. If tracking is lost for longer than `maxWaitMs` mid-retry, the
      // clock stays stale, so the FIRST frame after recovery satisfies
      // `time - base >= maxWaitMs` and is saved fail-open WITHOUT quality
      // analysis — even if it is blurry/black. Tracking loss must reset the
      // quality-gate retry state so recovery gets a fresh quality attempt.
      const analyze = vi.fn().mockResolvedValue({ accept: false }); // always reject → retry
      let pose: ARPose | null = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      const callbacks: ImageCaptureCallbacks = {
        getCurrentPose: () => pose,
        getScreenRotation: () => 0,
        onCaptured: vi.fn(),
        analyzeFrame: analyze,
      };
      const config: ImageCaptureConfig = {
        intervalMs: 2000,
        quality: 0.8,
        captureTimeoutMs: 10000,
        resolutionDivisor: 1,
        motionFilter: DEFAULT_CAPTURE_CONFIG.motionFilter,
        qualityFilter: {
          enabled: true,
          blurRelativeThreshold: 0.5,
          minMeanLuminance: 10,
          maxWaitMs: 3000,
        },
      };
      manager = new ImageCaptureManager(mockCanvas, callbacks, config);
      manager.start();

      // Initial capture at t=1000 → gate rejects → retryPending set, quality
      // deadline clock armed at t=1000.
      manager.onFrame(1000);
      await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));

      // Tracking lost for an outage longer than maxWaitMs (no capture happens).
      pose = null;
      manager.onFrame(5000);

      // Tracking recovers at t=5001 (4001 ms after the armed clock).
      pose = {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      };
      manager.onFrame(5001);
      await new Promise((r) => setTimeout(r, 0)); // let the toBlob callback + analysis run

      // The recovery frame must be quality-analyzed afresh, not blind-saved by
      // the stale deadline. Without the reset, analyze stays at 1 and onCaptured
      // fires (fail-open save); with it, analyze runs again and the frame is held.
      expect(analyze).toHaveBeenCalledTimes(2);
      expect(callbacks.onCaptured).not.toHaveBeenCalled();
    });

    it('should not capture again before interval elapses', async () => {
      // Why this test matters: prevents excessive captures
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000); // First capture at t=1000

      // Wait for first capture
      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
      });

      // Call onFrame again before interval (default 2000ms)
      manager.onFrame(1500); // Only 500ms later
      manager.onFrame(2000); // Only 1000ms later
      manager.onFrame(2500); // Only 1500ms later

      // Should still only have 1 capture
      expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
    });

    it('should capture again after interval elapses', async () => {
      // Why this test matters: ensures periodic capture works
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000); // First capture at t=1000

      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
      });

      // Wait for callback to complete (captureInProgress flag to reset)
      await new Promise((r) => setTimeout(r, 10));

      // Wait and call after interval (default 2000ms)
      manager.onFrame(3001); // 2001ms later

      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2);
      });
    });

    it('should use custom interval from config', async () => {
      // Why this test matters: interval must be configurable
      const config: ImageCaptureConfig = {
        intervalMs: 5000,
        quality: 0.8,
        captureTimeoutMs: 5000,
        resolutionDivisor: 1,
        motionFilter: DEFAULT_CAPTURE_CONFIG.motionFilter,
        qualityFilter: DEFAULT_CAPTURE_CONFIG.qualityFilter,
      };
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks, config);
      manager.start();

      manager.onFrame(1000); // First capture

      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
      });

      // Wait for callback to complete
      await new Promise((r) => setTimeout(r, 10));

      // Call after default interval (2000ms) but before custom (5000ms)
      manager.onFrame(4000); // Only 3000ms later

      // Should still be 1
      expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);

      // Call after custom interval
      manager.onFrame(6001); // 5001ms later

      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2);
      });
    });

    it('should pass quality to toBlob', async () => {
      // Why this test matters: JPEG quality affects file size and performance
      const config: ImageCaptureConfig = {
        intervalMs: 2000,
        quality: 0.6,
        captureTimeoutMs: 5000,
        resolutionDivisor: 1,
        motionFilter: DEFAULT_CAPTURE_CONFIG.motionFilter,
        qualityFilter: DEFAULT_CAPTURE_CONFIG.qualityFilter,
      };
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks, config);
      manager.start();

      manager.onFrame(1000);

      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledWith(
          expect.any(Function),
          'image/jpeg',
          0.6
        );
      });
    });

    it('should call onCaptured with blob and pose data', async () => {
      // Why this test matters: caller needs the captured data
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000);

      await vi.waitFor(() => {
        expect(mockCallbacks.onCaptured).toHaveBeenCalledWith(
          expect.objectContaining({
            blob: expect.any(Blob),
            timestamp: expect.any(Number),
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            screenRotation: 0,
            // Legacy canvas.toBlob path: the captured image carries the canvas
            // backing-store dimensions (mock canvas is 1920×1080), which are
            // the encoded JPEG's true pixel size. Persisted for aspect-correct
            // frame-tile rendering (D1).
            width: 1920,
            height: 1080,
          })
        );
      });
    });

    it('derives the timestamp from the XR frame time (performance.timeOrigin + time)', async () => {
      // Why this test matters: the captured timestamp flows into the
      // add2dImage `capturedAt` field and must share the exact same epoch-ms
      // time domain as every other per-frame stream (e.g. depth samples, which
      // use `performance.timeOrigin + time`). Using Date.now() instead would
      // introduce sub-frame drift, breaking precise alignment between images
      // and the AR pose captured in the same frame. See depth-sampler.ts and
      // 2026-04-18-recorder-app-code-audit.md (Issue 9).
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      const frameTime = 1234.5; // DOMHighResTimeStamp from the XR frame loop
      manager.onFrame(frameTime);

      await vi.waitFor(() => {
        expect(mockCallbacks.onCaptured).toHaveBeenCalledWith(
          expect.objectContaining({
            timestamp: performance.timeOrigin + frameTime,
          })
        );
      });
    });

    it('should not call onCaptured if toBlob returns null', async () => {
      // Why this test matters: handles edge case of failed capture
      mockCanvas.toBlob = vi.fn((callback: BlobCallback) => {
        setTimeout(() => callback(null), 0);
      });

      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000);

      // Wait a bit for async callback
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCallbacks.onCaptured).not.toHaveBeenCalled();
    });

    it('should stop capturing after stop() is called', async () => {
      // Why this test matters: prevents captures after session ends
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000); // First capture

      await vi.waitFor(() => {
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
      });

      manager.stop();

      // Try to capture again after interval
      manager.onFrame(4000);

      // Should still be 1
      expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
    });

    it('should use 1-based frame indexing for file naming', async () => {
      /**
       * Why this test matters:
       * Design docs (opfs-storage.ts.md) specify 1-based indexing for frames
       * (frame-000001.jpg, frame-000002.jpg, etc.). The frameIndex passed to
       * onCaptured must be 1-based to match the storage layer's expectations.
       */
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000); // First capture → index 1

      await vi.waitFor(() => {
        expect(mockCallbacks.onCaptured).toHaveBeenCalledWith(
          expect.objectContaining({ frameIndex: 1 })
        );
      });

      manager.onFrame(3001); // Second capture → index 2

      await vi.waitFor(() => {
        expect(mockCallbacks.onCaptured).toHaveBeenCalledWith(
          expect.objectContaining({ frameIndex: 2 })
        );
      });
    });

    it('should reset frame counter on start()', () => {
      // Why this test matters: each session should start from frame 0
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);

      // First session
      manager.start();
      manager.onFrame(1000);
      manager.stop();

      // Second session
      manager.start();
      expect(manager.getFrameCount()).toBe(0);
    });

    it('should handle getCurrentPose returning null gracefully', () => {
      // Why this test matters: AR pose may not be available yet
      mockCallbacks.getCurrentPose = vi.fn(() => null);

      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      manager.onFrame(1000);

      // Should not throw, just skip capture
      expect(mockCanvas.toBlob).not.toHaveBeenCalled();
    });

    it('should report isCapturing correctly', () => {
      // Why this test matters: external code may need to check state
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);

      expect(manager.isCapturing()).toBe(false);

      manager.start();
      expect(manager.isCapturing()).toBe(true);

      manager.stop();
      expect(manager.isCapturing()).toBe(false);
    });

    /**
     * Why this test matters (Issue #11 - Field Test Readiness):
     * When canvas.toBlob() fails and returns null (e.g., low memory on mobile),
     * the capture is silently skipped. Users don't know frames are being lost.
     * This test ensures the onCaptureFailed callback is invoked so the UI can
     * track and report capture failures to the user.
     */
    it('should call onCaptureFailed when toBlob returns null', async () => {
      mockCanvas.toBlob = vi.fn((callback: BlobCallback) => {
        setTimeout(() => callback(null), 0);
      });

      const onCaptureFailed = vi.fn();
      const callbacksWithFailure: ImageCaptureCallbacks = {
        ...mockCallbacks,
        onCaptureFailed,
      };

      manager = new ImageCaptureManager(mockCanvas, callbacksWithFailure);
      manager.start();

      manager.onFrame(1000);

      await vi.waitFor(() => {
        expect(onCaptureFailed).toHaveBeenCalledTimes(1);
      });

      // Should not call onCaptured
      expect(mockCallbacks.onCaptured).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * When no onCaptureFailed callback is provided, the capture manager should
     * still work (fails silently like before). This ensures backward compatibility.
     */
    it('should handle null blob gracefully when onCaptureFailed not provided', async () => {
      mockCanvas.toBlob = vi.fn((callback: BlobCallback) => {
        setTimeout(() => callback(null), 0);
      });

      // Don't provide onCaptureFailed
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      // Should not throw
      expect(() => manager.onFrame(1000)).not.toThrow();

      await new Promise((r) => setTimeout(r, 50));

      // Should still work, just no callback
      expect(mockCallbacks.onCaptured).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters (User Feedback - Black Images):
     * Users reported that captured images are all black on their phone.
     * This can happen when the WebGL context hasn't composited the frame yet.
     * A suspiciously small blob (< 5KB) likely indicates a black/empty image
     * since even a mostly-black JPEG has headers and some data.
     * This test ensures we detect and report such suspicious captures.
     */
    it('should call onSuspiciousImage when blob is too small', async () => {
      // Create a tiny blob that would indicate a black/empty image
      const tinyBlob = new Blob(['tiny'], { type: 'image/jpeg' });
      mockCanvas.toBlob = vi.fn((callback: BlobCallback) => {
        setTimeout(() => callback(tinyBlob), 0);
      });

      const onSuspiciousImage = vi.fn();
      const callbacksWithSuspicious: ImageCaptureCallbacks = {
        ...mockCallbacks,
        onSuspiciousImage,
      };

      manager = new ImageCaptureManager(mockCanvas, callbacksWithSuspicious);
      manager.start();

      manager.onFrame(1000);

      await vi.waitFor(() => {
        expect(onSuspiciousImage).toHaveBeenCalledTimes(1);
        expect(onSuspiciousImage).toHaveBeenCalledWith(
          tinyBlob.size,
          1 // frameIndex (1-based per design docs)
        );
      });

      // Should STILL call onCaptured (we save the image for debugging)
      expect(mockCallbacks.onCaptured).toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * When no onSuspiciousImage callback is provided, the capture manager should
     * still work and save the image. This ensures backward compatibility.
     */
    it('should save suspicious image even when onSuspiciousImage not provided', async () => {
      const tinyBlob = new Blob(['tiny'], { type: 'image/jpeg' });
      mockCanvas.toBlob = vi.fn((callback: BlobCallback) => {
        setTimeout(() => callback(tinyBlob), 0);
      });

      // Don't provide onSuspiciousImage
      manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
      manager.start();

      // Should not throw
      expect(() => manager.onFrame(1000)).not.toThrow();

      await vi.waitFor(() => {
        // Should still save the image
        expect(mockCallbacks.onCaptured).toHaveBeenCalledWith(
          expect.objectContaining({ blob: tinyBlob })
        );
      });
    });

    /**
     * Why this test matters:
     * Normal-sized blobs should NOT trigger the suspicious image callback.
     * Only very small blobs (< MIN_VALID_IMAGE_BYTES) should trigger it.
     */
    it('should NOT call onSuspiciousImage when blob is normal size', async () => {
      // Create a blob larger than MIN_VALID_IMAGE_BYTES (5000)
      const normalData = new Uint8Array(10000).fill(0);
      const normalBlob = new Blob([normalData], { type: 'image/jpeg' });
      mockCanvas.toBlob = vi.fn((callback: BlobCallback) => {
        setTimeout(() => callback(normalBlob), 0);
      });

      const onSuspiciousImage = vi.fn();
      const callbacksWithSuspicious: ImageCaptureCallbacks = {
        ...mockCallbacks,
        onSuspiciousImage,
      };

      manager = new ImageCaptureManager(mockCanvas, callbacksWithSuspicious);
      manager.start();

      manager.onFrame(1000);

      await vi.waitFor(() => {
        expect(mockCallbacks.onCaptured).toHaveBeenCalled();
      });

      // Should NOT call onSuspiciousImage
      expect(onSuspiciousImage).not.toHaveBeenCalled();
    });

    describe('captureFrame callback (blit technique)', () => {
      /**
       * Why this test matters (Black Frames Bug Fix):
       * When a custom captureFrame function is provided (e.g., from CameraBlitCapture),
       * it should be used INSTEAD of canvas.toBlob(). This is the primary mechanism
       * for fixing the WebXR opaque texture black frames issue on Android Chrome.
       */
      it('should use captureFrame instead of canvas.toBlob when provided', async () => {
        const fakeBlob = new Blob(['blit capture data'], {
          type: 'image/jpeg',
        });
        // The blit pipeline returns the encoded blob plus its render-target
        // pixel dimensions (CapturedFrame), not a bare Blob.
        const captureFrame = vi
          .fn()
          .mockResolvedValue({ blob: fakeBlob, width: 800, height: 600 });

        const callbacksWithCapture: ImageCaptureCallbacks = {
          ...mockCallbacks,
          captureFrame,
        };

        manager = new ImageCaptureManager(mockCanvas, callbacksWithCapture);
        manager.start();

        manager.onFrame(1000);

        await vi.waitFor(() => {
          expect(captureFrame).toHaveBeenCalledTimes(1);
          expect(captureFrame).toHaveBeenCalledWith(0.7); // default quality
        });

        // canvas.toBlob should NOT be called when captureFrame is provided
        expect(mockCanvas.toBlob).not.toHaveBeenCalled();

        // onCaptured should receive the blob AND the blit dimensions from
        // captureFrame (not the canvas size) — these are the JPEG's true pixels.
        await vi.waitFor(() => {
          expect(mockCallbacks.onCaptured).toHaveBeenCalledWith(
            expect.objectContaining({ blob: fakeBlob, width: 800, height: 600 })
          );
        });
      });

      /**
       * Why this test matters:
       * When captureFrame returns null (blit failed), it should trigger
       * onCaptureFailed just like canvas.toBlob returning null.
       */
      it('should call onCaptureFailed when captureFrame returns null', async () => {
        const captureFrame = vi.fn().mockResolvedValue(null);
        const onCaptureFailed = vi.fn();

        const callbacksWithCapture: ImageCaptureCallbacks = {
          ...mockCallbacks,
          captureFrame,
          onCaptureFailed,
        };

        manager = new ImageCaptureManager(mockCanvas, callbacksWithCapture);
        manager.start();

        manager.onFrame(1000);

        await vi.waitFor(() => {
          expect(onCaptureFailed).toHaveBeenCalledTimes(1);
        });

        expect(mockCallbacks.onCaptured).not.toHaveBeenCalled();
      });

      /**
       * Why this test matters:
       * The captureFrame function handles timing the same way as canvas.toBlob —
       * once a capture is in progress, no overlapping captures should occur.
       */
      it('should not overlap captures when captureFrame is async', async () => {
        let resolveCapture: ((frame: CapturedFrame | null) => void) | null =
          null;
        const captureFrame = vi.fn().mockImplementation(
          () =>
            new Promise<CapturedFrame | null>((resolve) => {
              resolveCapture = resolve;
            })
        );

        const callbacksWithCapture: ImageCaptureCallbacks = {
          ...mockCallbacks,
          captureFrame,
        };

        manager = new ImageCaptureManager(mockCanvas, callbacksWithCapture);
        manager.start();

        manager.onFrame(1000); // Start first capture
        manager.onFrame(5000); // Should be ignored (still in progress)

        expect(captureFrame).toHaveBeenCalledTimes(1);

        // Resolve first capture
        resolveCapture!({
          blob: new Blob(['data'], { type: 'image/jpeg' }),
          width: 800,
          height: 600,
        });
        await vi.waitFor(() => {
          expect(mockCallbacks.onCaptured).toHaveBeenCalledTimes(1);
        });
      });

      /**
       * Why this test matters:
       * When captureFrame is provided, suspicious image detection should
       * still work based on blob size.
       */
      it('should detect suspicious images from captureFrame', async () => {
        const tinyBlob = new Blob(['tiny'], { type: 'image/jpeg' });
        const captureFrame = vi
          .fn()
          .mockResolvedValue({ blob: tinyBlob, width: 4, height: 4 });
        const onSuspiciousImage = vi.fn();

        const callbacksWithCapture: ImageCaptureCallbacks = {
          ...mockCallbacks,
          captureFrame,
          onSuspiciousImage,
        };

        manager = new ImageCaptureManager(mockCanvas, callbacksWithCapture);
        manager.start();

        manager.onFrame(1000);

        await vi.waitFor(() => {
          expect(onSuspiciousImage).toHaveBeenCalledTimes(1);
        });

        // Should still save the image
        expect(mockCallbacks.onCaptured).toHaveBeenCalled();
      });

      /**
       * Why this test matters:
       * If captureFrame is not provided, the existing canvas.toBlob path
       * must continue to work unchanged (backward compatibility).
       */
      it('should fall back to canvas.toBlob when captureFrame not provided', async () => {
        // Don't provide captureFrame
        manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
        manager.start();

        manager.onFrame(1000);

        await vi.waitFor(() => {
          expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);
        });
      });
    });

    describe('captureInProgress safety timeout', () => {
      /**
       * Why this test matters:
       * If a capture promise never resolves (e.g., canvas.toBlob callback dropped
       * in WebXR compositor), captureInProgress stays true forever and blocks all
       * future captures. A safety timeout resets the flag after a configurable
       * duration, preventing permanent pipeline deadlock.
       */
      it('should reset captureInProgress after timeout when captureFrame never resolves', async () => {
        vi.useFakeTimers();

        // captureFrame returns a promise that never resolves
        const neverResolving = new Promise<Blob | null>(() => {});
        const captureFrame = vi.fn().mockReturnValue(neverResolving);

        const callbacksWithCapture: ImageCaptureCallbacks = {
          ...mockCallbacks,
          captureFrame,
        };

        manager = new ImageCaptureManager(mockCanvas, callbacksWithCapture, {
          ...DEFAULT_CAPTURE_CONFIG,
          captureTimeoutMs: 3000,
        });
        manager.start();

        // First frame triggers capture
        manager.onFrame(1000);
        expect(captureFrame).toHaveBeenCalledTimes(1);

        // Second frame should be blocked (capture in progress)
        manager.onFrame(4000);
        expect(captureFrame).toHaveBeenCalledTimes(1);

        // Advance past the timeout
        vi.advanceTimersByTime(3000);

        // Flush microtasks
        await vi.runAllTimersAsync();

        // Now the next frame should be able to capture again
        manager.onFrame(8000);
        expect(captureFrame).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
      });

      /**
       * Why this test matters:
       * When the capture resolves normally before the timeout, the timeout
       * should be cancelled to avoid double-resetting captureInProgress.
       */
      it('should cancel timeout when capture resolves normally', async () => {
        vi.useFakeTimers();

        let resolveCapture: ((frame: CapturedFrame | null) => void) | undefined;
        const captureFrame = vi.fn(
          () =>
            new Promise<CapturedFrame | null>((resolve) => {
              resolveCapture = resolve;
            })
        );

        const callbacksWithCapture: ImageCaptureCallbacks = {
          ...mockCallbacks,
          captureFrame,
        };

        manager = new ImageCaptureManager(mockCanvas, callbacksWithCapture, {
          ...DEFAULT_CAPTURE_CONFIG,
          captureTimeoutMs: 3000,
        });
        manager.start();

        manager.onFrame(1000);
        expect(captureFrame).toHaveBeenCalledTimes(1);

        // Resolve before timeout
        resolveCapture!({
          blob: new Blob(['data'], { type: 'image/jpeg' }),
          width: 800,
          height: 600,
        });
        await vi.advanceTimersByTimeAsync(10);

        expect(mockCallbacks.onCaptured).toHaveBeenCalledTimes(1);

        // Advance past where timeout would have fired
        vi.advanceTimersByTime(5000);

        // Should be able to capture again
        manager.onFrame(5000);
        expect(captureFrame).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
      });

      /**
       * Why this test matters:
       * The default timeout value should be exported and have a sensible default
       * (5 seconds). This ensures safety even when no custom config is provided.
       */
      it('should use default timeout of 5000ms', () => {
        expect(DEFAULT_CAPTURE_CONFIG.captureTimeoutMs).toBe(5000);
      });

      /**
       * Why this test matters (field-drop audit F3):
       * resolutionDivisor was folded into ImageCaptureConfig so the whole user
       * image-options section flows through startImageCapture as one object
       * instead of a bolted-on positional parameter. The default must be 1
       * (full native resolution) so omitting it never silently downscales.
       */
      it('should default resolutionDivisor to 1 (full resolution)', () => {
        expect(DEFAULT_CAPTURE_CONFIG.resolutionDivisor).toBe(1);
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Issue 7: stop() must clear pending capture state
    // ──────────────────────────────────────────────────────────────────────────

    describe('stop() cleanup', () => {
      it('should clear safety timeout and reset captureInProgress on stop()', () => {
        // Why: Without clearing, an in-flight capture's safety timeout fires
        // after stop(), potentially resetting captureInProgress at an
        // unexpected time and causing state corruption.
        vi.useFakeTimers();

        manager = new ImageCaptureManager(mockCanvas, mockCallbacks);
        manager.start();

        // Trigger a capture to set captureInProgress and start safety timeout
        manager.onFrame(3000);
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1);

        // stop() should clean up in-flight capture state
        manager.stop();

        // Advance past the safety timeout — it should NOT fire (was cleared)
        vi.advanceTimersByTime(10000);

        // After stop, onFrame should not capture (capturing=false)
        manager.onFrame(20000);
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(1); // no new captures

        // Restarting should work — captureInProgress was reset by stop()
        manager.start();
        manager.onFrame(25000);
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2); // new capture works

        vi.useRealTimers();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * CapturedImage is a snapshot from WebXR, constructed once and never mutated.
     */
    it('CapturedImage ≡ Readonly<CapturedImage>', () => {
      expectTypeOf<CapturedImage>().toEqualTypeOf<Readonly<CapturedImage>>();
    });
  });
});
