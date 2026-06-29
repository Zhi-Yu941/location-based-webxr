/**
 * Depth Sampler Tests
 *
 * Tests for sampling depth points from WebXR depth sensing API.
 *
 * Why this test matters:
 * Depth data provides 3D point samples that can be used for
 * 3D reconstruction and validating AR tracking accuracy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import type { Matrix4 } from 'gps-plus-slam-js';
import {
  DepthSampler,
  wrapXRDepthInfo,
  type DepthSamplerConfig,
  type DepthSamplerCallbacks,
} from './depth-sampler';

describe('DepthSampler', () => {
  let callbacks: DepthSamplerCallbacks;
  let sampler: DepthSampler;

  beforeEach(() => {
    callbacks = {
      onSampleCaptured: vi.fn(),
      getCurrentPose: vi.fn(() => ({
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      })),
    };
    sampler = new DepthSampler(callbacks);
  });

  afterEach(() => {
    sampler.stop();
  });

  describe('constructor', () => {
    it('creates with default config', () => {
      expect(sampler.getSampleCount()).toBe(0);
      expect(sampler.isRunning()).toBe(false);
    });

    it('accepts custom config', () => {
      const config: Partial<DepthSamplerConfig> = {
        intervalMs: 500,
        gridSize: 5,
      };
      const customSampler = new DepthSampler(callbacks, config);
      expect(customSampler.getConfig().intervalMs).toBe(500);
      expect(customSampler.getConfig().gridSize).toBe(5);
      customSampler.stop();
    });

    it('uses default interval of 1000ms', () => {
      expect(sampler.getConfig().intervalMs).toBe(1000);
    });

    /**
     * Why this test matters:
     * The default density feeds the AR-space occupancy grid
     * (2026-06-11-depth-occupancy-grid-port-plan.md §1): 16×16 = 256 pts/s
     * is the minimum useful density for judging grid correctness on-device.
     */
    it('uses default grid size of 16', () => {
      expect(sampler.getConfig().gridSize).toBe(16);
    });

    /**
     * Why this test matters: the constructor must apply the SAME validation as
     * `updateConfig` (a fractional `gridSize` makes no sense as an N×N grid, and
     * a non-finite/non-positive `intervalMs` disables the throttle so every
     * frame captures). Previously the constructor merged config verbatim
     * (`{ ...DEFAULT_CONFIG, ...config }`), so `new DepthSampler(cb, bad)` could
     * seat values `updateConfig` itself would refuse — the same constructor-vs-
     * updateConfig inconsistency fixed for `camera-frame-source` (PR #91).
     */
    it('rejects invalid config at construction, like updateConfig', () => {
      const bad = new DepthSampler(callbacks, {
        gridSize: 2.5,
        intervalMs: NaN,
      });
      expect(bad.getConfig().gridSize).toBe(16); // fractional → default kept
      expect(bad.getConfig().intervalMs).toBe(1000); // NaN → default kept
      bad.stop();
    });
  });

  describe('updateConfig', () => {
    /**
     * Why these tests matter:
     * The recorder's depth.gridSize/intervalMs settings were dead knobs —
     * persisted and shown in the settings UI but never reaching the
     * sampler (webxr-session constructed it without config; port plan
     * Iter 6). updateConfig is the plumbing seam: startDepthCapture
     * applies the user's recording options just before sampling starts,
     * and invalid values must be ignored defensively.
     */
    it('applies partial overrides to the active config', () => {
      sampler.updateConfig({ gridSize: 8, intervalMs: 500 });
      expect(sampler.getConfig().gridSize).toBe(8);
      expect(sampler.getConfig().intervalMs).toBe(500);
      // Untouched keys keep their values
      expect(sampler.getConfig().unavailabilityThresholdMs).toBe(5000);
    });

    it('affects the next sample (gridSize change takes effect)', () => {
      sampler.updateConfig({ gridSize: 4 });
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(4));
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.points).toHaveLength(16);
    });

    it('ignores invalid values (non-finite, non-positive, fractional gridSize)', () => {
      const before = sampler.getConfig();
      sampler.updateConfig({
        gridSize: 0,
        intervalMs: NaN,
        unavailabilityThresholdMs: -1,
      });
      expect(sampler.getConfig()).toEqual(before);
      sampler.updateConfig({ gridSize: 2.5 });
      expect(sampler.getConfig().gridSize).toBe(before.gridSize);
    });
  });

  describe('start/stop', () => {
    it('starts sampling when start() is called', () => {
      sampler.start();
      expect(sampler.isRunning()).toBe(true);
    });

    it('stops sampling when stop() is called', () => {
      sampler.start();
      sampler.stop();
      expect(sampler.isRunning()).toBe(false);
    });

    it('can be started and stopped multiple times', () => {
      sampler.start();
      sampler.stop();
      sampler.start();
      expect(sampler.isRunning()).toBe(true);
    });

    it('resets sample count on start', () => {
      sampler.start();
      // Simulate a sample via onFrame
      sampler.onFrame(1000, createMockDepthInfo(3));
      expect(sampler.getSampleCount()).toBe(1);

      sampler.stop();
      sampler.start();
      expect(sampler.getSampleCount()).toBe(0);
    });
  });

  describe('onFrame', () => {
    it('does not sample when not running', () => {
      sampler.onFrame(1000, createMockDepthInfo(3));
      expect(callbacks.onSampleCaptured).not.toHaveBeenCalled();
    });

    it('samples immediately on first frame after start', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));
      expect(callbacks.onSampleCaptured).toHaveBeenCalledOnce();
    });

    it('respects sampling interval', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));
      sampler.onFrame(500, createMockDepthInfo(3)); // Too soon
      sampler.onFrame(1000, createMockDepthInfo(3)); // Should sample

      expect(callbacks.onSampleCaptured).toHaveBeenCalledTimes(2);
    });

    it('does not sample if depth info is null', () => {
      sampler.start();
      sampler.onFrame(0, null);
      expect(callbacks.onSampleCaptured).not.toHaveBeenCalled();
    });

    it('does not sample if pose is null', () => {
      vi.mocked(callbacks.getCurrentPose).mockReturnValue(null);
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));
      expect(callbacks.onSampleCaptured).not.toHaveBeenCalled();
    });

    it('increments sample count on successful sample', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));
      sampler.onFrame(1000, createMockDepthInfo(3));

      expect(sampler.getSampleCount()).toBe(2);
    });
  });

  describe('depth sampling', () => {
    /**
     * Why this test matters:
     * cameraPos must be in raw WebXR convention (the reducer applies
     * webxrToNUE). WebXR {x:1, y:2, z:3} → [1, 2, 3]
     * Timestamp must be epoch ms (not DOMHighResTimeStamp) for consistency
     * with all other action timestamps.
     */
    it('provides cameraPos in raw WebXR convention and timestamp as epoch ms', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.cameraPos).toEqual([1, 2, 3]);
      expect(sample.cameraRot).toEqual([0, 0, 0, 1]);
      // Timestamp should be performance.timeOrigin + frame time (0)
      expect(sample.timestamp).toBe(performance.timeOrigin);
    });

    it('samples grid of points from depth buffer', () => {
      const gridSampler = new DepthSampler(callbacks, { gridSize: 3 });
      gridSampler.start();
      gridSampler.onFrame(0, createMockDepthInfo(3));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      // 3x3 grid = 9 points
      expect(sample.points).toHaveLength(9);
      gridSampler.stop();
    });

    it('uses correct grid coordinates', () => {
      const config: Partial<DepthSamplerConfig> = {
        intervalMs: 1000,
        gridSize: 3,
      };
      const gridSampler = new DepthSampler(callbacks, config);
      gridSampler.start();
      gridSampler.onFrame(0, createMockDepthInfo(3));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      // Should have points at normalized coords like (0.25, 0.25), (0.5, 0.5), (0.75, 0.75)
      expect(sample.points[0].screenX).toBeCloseTo(0.25, 2);
      expect(sample.points[0].screenY).toBeCloseTo(0.25, 2);

      gridSampler.stop();
    });

    it('includes depth values in meters', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      for (const point of sample.points) {
        expect(typeof point.depthM).toBe('number');
        expect(point.depthM).toBeGreaterThan(0);
      }
    });

    /**
     * Why these tests matter:
     * The capturing view's projection matrix is the camera intrinsics needed
     * to unproject (screenX, screenY, depthM) back into a 3D AR-space point
     * (occupancy-grid port plan §1 blocker). It must travel inside each
     * persisted DepthSample; samples from old recordings without it must
     * still flow through unchanged (additive format change).
     */
    it('copies the projectionMatrix from depth info into the emitted sample', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3, TEST_PROJECTION_MATRIX));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.projectionMatrix).toEqual(TEST_PROJECTION_MATRIX);
    });

    it('omits projectionMatrix when depth info has none (back-compat)', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.projectionMatrix).toBeUndefined();
      // The sample must remain JSON-round-trippable without the field
      expect(JSON.parse(JSON.stringify(sample))).toEqual(sample);
    });

    it('handles varying grid sizes', () => {
      const config: Partial<DepthSamplerConfig> = {
        intervalMs: 1000,
        gridSize: 5,
      };
      const largeSampler = new DepthSampler(callbacks, config);
      largeSampler.start();
      largeSampler.onFrame(0, createMockDepthInfo(5));

      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      // 5x5 grid = 25 points
      expect(sample.points).toHaveLength(25);

      largeSampler.stop();
    });
  });

  describe('property-based tests', () => {
    /**
     * Why this test matters:
     * Grid size determines point count - must always be gridSize^2 points.
     */
    it('always produces gridSize^2 points for any valid grid size', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10 }), (gridSize) => {
          const config: Partial<DepthSamplerConfig> = {
            intervalMs: 1000,
            gridSize,
          };
          const propSampler = new DepthSampler(callbacks, config);
          propSampler.start();
          propSampler.onFrame(0, createMockDepthInfo(gridSize));

          const sample = vi
            .mocked(callbacks.onSampleCaptured)
            .mock.calls.pop()![0];
          expect(sample.points).toHaveLength(gridSize * gridSize);

          propSampler.stop();
        })
      );
    });

    /**
     * Why this test matters:
     * All grid coordinates must be within (0, 1) range and avoid edges.
     */
    it('all grid points are within (0, 1) bounds', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10 }), (gridSize) => {
          const config: Partial<DepthSamplerConfig> = {
            intervalMs: 1000,
            gridSize,
          };
          const propSampler = new DepthSampler(callbacks, config);
          propSampler.start();
          propSampler.onFrame(0, createMockDepthInfo(gridSize));

          const sample = vi
            .mocked(callbacks.onSampleCaptured)
            .mock.calls.pop()![0];
          for (const point of sample.points) {
            expect(point.screenX).toBeGreaterThan(0);
            expect(point.screenX).toBeLessThan(1);
            expect(point.screenY).toBeGreaterThan(0);
            expect(point.screenY).toBeLessThan(1);
          }

          propSampler.stop();
        })
      );
    });

    /**
     * Why this test matters:
     * Interval enforcement must work for any positive interval value.
     */
    it('respects any positive sampling interval', () => {
      fc.assert(
        fc.property(fc.integer({ min: 100, max: 5000 }), (intervalMs) => {
          const config: Partial<DepthSamplerConfig> = {
            intervalMs,
            gridSize: 2,
          };
          const intervalCallbacks: DepthSamplerCallbacks = {
            onSampleCaptured: vi.fn(),
            getCurrentPose: () => ({
              position: { x: 0, y: 0, z: 0 },
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            }),
          };
          const propSampler = new DepthSampler(intervalCallbacks, config);
          propSampler.start();

          // First sample at t=0
          propSampler.onFrame(0, createMockDepthInfo(2));
          // Too early - should not sample
          propSampler.onFrame(intervalMs - 1, createMockDepthInfo(2));
          // Exactly on interval - should sample
          propSampler.onFrame(intervalMs, createMockDepthInfo(2));

          expect(intervalCallbacks.onSampleCaptured).toHaveBeenCalledTimes(2);

          propSampler.stop();
        })
      );
    });
  });

  describe('RGB enrichment (occupancy-grid port plan Iter 8)', () => {
    /**
     * Why these tests matter:
     * Per-point RGB rides the persisted DepthSample, so the enrichment
     * contract has three load-bearing properties: (1) the lookup is
     * acquired at most ONCE per *emitted* sample — never per frame or per
     * point — because acquisition is a GPU-stall blit+readback; (2) the
     * `rgb` recording option must actually gate the work (a dead knob here
     * silently burns GPU time, the Iter-6 lesson in reverse); (3) every
     * failure path (no callback, null lookup, throwing callback, null per
     * point) degrades to color-less points, never a crash in the XR frame
     * loop.
     */
    it('attaches the looked-up rgb to every point, acquiring the lookup once per sample', () => {
      const acquireRgbLookup = vi.fn(
        () => (x: number, y: number) =>
          [Math.round(x * 100), Math.round(y * 100), 7] as const
      );
      const rgbSampler = new DepthSampler(
        { ...callbacks, acquireRgbLookup },
        { gridSize: 2 }
      );
      rgbSampler.start();
      rgbSampler.onFrame(0, createMockDepthInfo(2));
      rgbSampler.onFrame(100, createMockDepthInfo(2)); // within interval — no sample

      expect(acquireRgbLookup).toHaveBeenCalledTimes(1);
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.points).toHaveLength(4);
      for (const point of sample.points) {
        expect(point.rgb).toEqual([
          Math.round(point.screenX * 100),
          Math.round(point.screenY * 100),
          7,
        ]);
      }
      rgbSampler.stop();
    });

    it('rgb: false disables the work entirely (option must reach the consumer)', () => {
      const acquireRgbLookup = vi.fn(() => () => [1, 2, 3] as const);
      const rgbSampler = new DepthSampler(
        { ...callbacks, acquireRgbLookup },
        { gridSize: 2 }
      );
      rgbSampler.updateConfig({ rgb: false });
      rgbSampler.start();
      rgbSampler.onFrame(0, createMockDepthInfo(2));

      expect(acquireRgbLookup).not.toHaveBeenCalled();
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.points[0].rgb).toBeUndefined();
      rgbSampler.stop();
    });

    it('rgb defaults to true and updateConfig ignores non-boolean values', () => {
      expect(sampler.getConfig().rgb).toBe(true);
      sampler.updateConfig({ rgb: 'yes' as unknown as boolean });
      expect(sampler.getConfig().rgb).toBe(true);
      sampler.updateConfig({ rgb: false });
      expect(sampler.getConfig().rgb).toBe(false);
    });

    it('emits color-less points when no acquireRgbLookup callback is provided (back-compat)', () => {
      sampler.start();
      sampler.onFrame(0, createMockDepthInfo(3));
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.points[0].rgb).toBeUndefined();
      // The field must be ABSENT, not undefined, so persisted JSON is
      // identical to the pre-Iter-8 format.
      expect('rgb' in sample.points[0]).toBe(false);
    });

    it('emits color-less points when the lookup acquisition returns null', () => {
      const rgbSampler = new DepthSampler(
        { ...callbacks, acquireRgbLookup: () => null },
        { gridSize: 2 }
      );
      rgbSampler.start();
      rgbSampler.onFrame(0, createMockDepthInfo(2));
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.points.every((p) => p.rgb === undefined)).toBe(true);
      rgbSampler.stop();
    });

    it('still emits the sample when the lookup acquisition throws (best-effort)', () => {
      const rgbSampler = new DepthSampler(
        {
          ...callbacks,
          acquireRgbLookup: () => {
            throw new Error('GL context lost');
          },
        },
        { gridSize: 2 }
      );
      rgbSampler.start();
      expect(() => rgbSampler.onFrame(0, createMockDepthInfo(2))).not.toThrow();
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      expect(sample.points).toHaveLength(4);
      expect(sample.points[0].rgb).toBeUndefined();
      rgbSampler.stop();
    });

    it('omits rgb for individual points where the lookup returns null', () => {
      const rgbSampler = new DepthSampler(
        {
          ...callbacks,
          // Only points in the left half of the view get a color
          acquireRgbLookup: () => (x: number) =>
            x < 0.5 ? ([9, 9, 9] as const) : null,
        },
        { gridSize: 2 }
      );
      rgbSampler.start();
      rgbSampler.onFrame(0, createMockDepthInfo(2));
      const sample = vi.mocked(callbacks.onSampleCaptured).mock.calls[0][0];
      const withRgb = sample.points.filter((p) => p.rgb !== undefined);
      const withoutRgb = sample.points.filter((p) => p.rgb === undefined);
      expect(withRgb).toHaveLength(2); // 2×2 grid → left column
      expect(withoutRgb).toHaveLength(2);
      expect(withRgb[0].rgb).toEqual([9, 9, 9]);
      rgbSampler.stop();
    });
  });

  describe('depth unavailability detection', () => {
    /**
     * These tests validate Field Test Readiness Issue #8:
     * Notify user when depth sensing is unavailable despite being requested.
     */

    it('does not fire unavailable callback before threshold', () => {
      const onDepthUnavailable = vi.fn();
      const testSampler = new DepthSampler(
        { ...callbacks, onDepthUnavailable },
        { unavailabilityThresholdMs: 5000 }
      );

      // Mock performance.now to return predictable values
      let mockTime = 0;
      const performanceSpy = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => mockTime);

      testSampler.start();
      mockTime = 1000;
      testSampler.onFrame(1000, null); // No depth data

      expect(onDepthUnavailable).not.toHaveBeenCalled();

      testSampler.stop();
      performanceSpy.mockRestore();
    });

    it('fires unavailable callback after threshold with no depth data', () => {
      const onDepthUnavailable = vi.fn();
      const testSampler = new DepthSampler(
        { ...callbacks, onDepthUnavailable },
        { unavailabilityThresholdMs: 5000 }
      );

      let mockTime = 0;
      const performanceSpy = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => mockTime);

      testSampler.start();
      mockTime = 5001; // Past threshold
      testSampler.onFrame(5001, null); // No depth data

      expect(onDepthUnavailable).toHaveBeenCalledTimes(1);

      testSampler.stop();
      performanceSpy.mockRestore();
    });

    it('does not fire unavailable callback if depth data is received', () => {
      const onDepthUnavailable = vi.fn();
      const testSampler = new DepthSampler(
        { ...callbacks, onDepthUnavailable },
        { unavailabilityThresholdMs: 5000 }
      );

      let mockTime = 0;
      const performanceSpy = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => mockTime);

      testSampler.start();
      mockTime = 1000;
      // Receive valid depth data
      testSampler.onFrame(1000, createMockDepthInfo(3));
      mockTime = 6000;
      testSampler.onFrame(6000, null); // Depth later becomes unavailable

      expect(onDepthUnavailable).not.toHaveBeenCalled();

      testSampler.stop();
      performanceSpy.mockRestore();
    });

    it('fires unavailable callback only once', () => {
      const onDepthUnavailable = vi.fn();
      const testSampler = new DepthSampler(
        { ...callbacks, onDepthUnavailable },
        { unavailabilityThresholdMs: 5000 }
      );

      let mockTime = 0;
      const performanceSpy = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => mockTime);

      testSampler.start();
      mockTime = 6000;
      testSampler.onFrame(6000, null);
      testSampler.onFrame(7000, null);
      testSampler.onFrame(8000, null);

      expect(onDepthUnavailable).toHaveBeenCalledTimes(1);

      testSampler.stop();
      performanceSpy.mockRestore();
    });

    it('does not throw if no unavailable callback is provided', () => {
      // Use default callbacks without onDepthUnavailable
      const testSampler = new DepthSampler(callbacks, {
        unavailabilityThresholdMs: 100,
      });

      const performanceSpy = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => 1000);

      testSampler.start();

      expect(() => testSampler.onFrame(1000, null)).not.toThrow();

      testSampler.stop();
      performanceSpy.mockRestore();
    });

    it('hasReceivedDepth returns false initially', () => {
      expect(sampler.hasReceivedDepth()).toBe(false);
    });

    it('hasReceivedDepth returns true after receiving depth', () => {
      sampler.start();
      sampler.onFrame(1000, createMockDepthInfo(3));
      expect(sampler.hasReceivedDepth()).toBe(true);
    });

    it('hasReceivedDepth resets to false on start', () => {
      sampler.start();
      sampler.onFrame(1000, createMockDepthInfo(3));
      sampler.stop();
      sampler.start();
      expect(sampler.hasReceivedDepth()).toBe(false);
    });
  });
});

describe('wrapXRDepthInfo', () => {
  /**
   * Why these tests matter:
   * webxr-session.ts used to hand the raw browser XRDepthInformation object
   * to the sampler as-is. To attach the capturing view's projectionMatrix,
   * it now wraps it via wrapXRDepthInfo — the wrapper must keep
   * getDepthInMeters bound to the original object (browser implementations
   * are this-sensitive) and defensively validate the matrix input.
   */
  function createRawDepthInformation() {
    return {
      width: 160,
      height: 90,
      // this-sensitive on purpose: throws when called unbound
      getDepthInMeters(this: { width: number }, x: number, _y: number) {
        if (typeof this.width !== 'number') {
          throw new Error('getDepthInMeters called with wrong this');
        }
        return 1 + x;
      },
    };
  }

  it('copies width/height and keeps getDepthInMeters bound to the source', () => {
    const raw = createRawDepthInformation();
    const wrapped = wrapXRDepthInfo(
      raw,
      new Float32Array(TEST_PROJECTION_MATRIX)
    );

    expect(wrapped.width).toBe(160);
    expect(wrapped.height).toBe(90);
    const fn = wrapped.getDepthInMeters;
    expect(fn(0.5, 0.5)).toBeCloseTo(1.5);
  });

  it('copies a valid 16-float matrix into a plain serializable tuple', () => {
    const source = new Float32Array(TEST_PROJECTION_MATRIX);
    const wrapped = wrapXRDepthInfo(createRawDepthInformation(), source);

    expect(wrapped.projectionMatrix).toEqual(TEST_PROJECTION_MATRIX);
    expect(Array.isArray(wrapped.projectionMatrix)).toBe(true);
    // Must be a copy, not a view aliasing the (reused) GPU-side array
    source[0] = 999;
    expect(wrapped.projectionMatrix?.[0]).toBe(TEST_PROJECTION_MATRIX[0]);
  });

  it('omits the matrix when input is missing, wrong-length, or non-finite', () => {
    const raw = createRawDepthInformation();
    expect(wrapXRDepthInfo(raw, undefined).projectionMatrix).toBeUndefined();
    expect(
      wrapXRDepthInfo(raw, new Float32Array(12)).projectionMatrix
    ).toBeUndefined();
    const withNaN = new Float32Array(TEST_PROJECTION_MATRIX);
    withNaN[5] = NaN;
    expect(wrapXRDepthInfo(raw, withNaN).projectionMatrix).toBeUndefined();
  });

  /**
   * Why these tests matter (live depth occluder, Iter 1 —
   * 2026-06-14-webxr-depth-occlusion-plan.md §2/§8):
   * The live occluder is a SECOND consumer of the same per-frame
   * XRCPUDepthInformation. It needs three fields the sparse sampler never read:
   * the raw `data` buffer, `rawValueToMeters`, and the `normDepthBufferFromNormView`
   * UV transform. The wrapper must now carry them — `data` by LIVE reference (the
   * per-frame buffer is too large to clone and is uploaded synchronously),
   * `rawValueToMeters` validated finite, and the UV transform's `.matrix` copied
   * + validated exactly like `projectionMatrix`. Missing/invalid fields must
   * degrade to absent, never throw, so the existing grid path is unaffected.
   */
  it('preserves the raw depth `data` buffer by reference (not copied)', () => {
    const data = new ArrayBuffer(160 * 90 * 2);
    const wrapped = wrapXRDepthInfo(
      { ...createRawDepthInformation(), data },
      undefined
    );
    // Same buffer instance — the occluder uploads it in-place this frame.
    expect(wrapped.data).toBe(data);
  });

  it('omits `data` when the source has none or it is not an ArrayBuffer', () => {
    expect(
      wrapXRDepthInfo(createRawDepthInformation(), undefined).data
    ).toBeUndefined();
    expect(
      wrapXRDepthInfo(
        { ...createRawDepthInformation(), data: 'not-a-buffer' as never },
        undefined
      ).data
    ).toBeUndefined();
  });

  it('preserves `rawValueToMeters` only when it is a finite number', () => {
    expect(
      wrapXRDepthInfo(
        { ...createRawDepthInformation(), rawValueToMeters: 0.001 },
        undefined
      ).rawValueToMeters
    ).toBe(0.001);
    expect(
      wrapXRDepthInfo(
        { ...createRawDepthInformation(), rawValueToMeters: NaN },
        undefined
      ).rawValueToMeters
    ).toBeUndefined();
    expect(
      wrapXRDepthInfo(createRawDepthInformation(), undefined).rawValueToMeters
    ).toBeUndefined();
  });

  it('copies the normDepthBufferFromNormView matrix into a serializable tuple', () => {
    const matrix = new Float32Array(TEST_PROJECTION_MATRIX);
    const wrapped = wrapXRDepthInfo(
      {
        ...createRawDepthInformation(),
        normDepthBufferFromNormView: { matrix },
      },
      undefined
    );

    expect(wrapped.normDepthBufferFromNormView).toEqual(TEST_PROJECTION_MATRIX);
    expect(Array.isArray(wrapped.normDepthBufferFromNormView)).toBe(true);
    // Copy, not a view aliasing the (UA-reused) backing array.
    matrix[0] = 999;
    expect(wrapped.normDepthBufferFromNormView?.[0]).toBe(
      TEST_PROJECTION_MATRIX[0]
    );
  });

  it('omits normDepthBufferFromNormView when absent, null, wrong-length, or non-finite', () => {
    const raw = createRawDepthInformation();
    expect(
      wrapXRDepthInfo(raw, undefined).normDepthBufferFromNormView
    ).toBeUndefined();
    expect(
      wrapXRDepthInfo({ ...raw, normDepthBufferFromNormView: null }, undefined)
        .normDepthBufferFromNormView
    ).toBeUndefined();
    expect(
      wrapXRDepthInfo(
        {
          ...raw,
          normDepthBufferFromNormView: { matrix: new Float32Array(9) },
        },
        undefined
      ).normDepthBufferFromNormView
    ).toBeUndefined();
    const withNaN = new Float32Array(TEST_PROJECTION_MATRIX);
    withNaN[3] = Infinity;
    expect(
      wrapXRDepthInfo(
        { ...raw, normDepthBufferFromNormView: { matrix: withNaN } },
        undefined
      ).normDepthBufferFromNormView
    ).toBeUndefined();
  });
});

/**
 * A plausible column-major perspective projection matrix (60° vFOV, 16:9)
 * with all entries representable exactly enough in float32 for toEqual
 * comparisons after a Float32Array round-trip.
 */
const TEST_PROJECTION_MATRIX: Matrix4 = [
  0.974279, 0, 0, 0, 0, 1.732051, 0, 0, 0, 0, -1.000391, -1, 0, 0, -0.020004, 0,
].map((v) => Math.fround(v)) as unknown as Matrix4;

/**
 * Create a mock depth info object for testing.
 */
function createMockDepthInfo(
  _gridSize: number,
  projectionMatrix?: Matrix4
): {
  getDepthInMeters: (x: number, y: number) => number;
  width: number;
  height: number;
  projectionMatrix?: Matrix4;
} {
  return {
    width: 256,
    height: 256,
    getDepthInMeters: (x: number, y: number) => {
      // Return a depth based on position (1-5 meters)
      return 1 + x * 2 + y * 2;
    },
    ...(projectionMatrix ? { projectionMatrix } : {}),
  };
}
