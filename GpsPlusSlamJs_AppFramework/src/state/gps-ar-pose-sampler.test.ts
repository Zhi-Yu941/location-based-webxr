/**
 * gps-ar-pose-sampler tests.
 *
 * Why these tests matter: this module lifts a small but ubiquitous capture
 * shape out of `gps-event-coordinator.ts` so the recorder (and future
 * non-recorder consumers) can reuse it. The tests pin the contract: pose
 * tuple extraction, GPS pass-through, optional fused GPS, deterministic
 * timestamp override.
 */

import { describe, it, expect } from 'vitest';
import {
  captureGpsAnchorSample,
  extractOdomPosition,
  extractOdomRotation,
} from './gps-ar-pose-sampler';
import type { ARPose } from '../types/ar-types';

const arPose: ARPose = {
  position: { x: 1, y: 2, z: 3 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

describe('captureGpsAnchorSample', () => {
  it('extracts odom tuples from the arPose', () => {
    const s = captureGpsAnchorSample(
      arPose,
      { latitude: 50.749, longitude: 6.479, altitude: 100 },
      { timestamp: 1000 }
    );
    expect(s.odomPosition).toEqual([1, 2, 3]);
    expect(s.odomRotation).toEqual([0, 0, 0, 1]);
  });

  it('passes through gpsPoint verbatim', () => {
    const gps = { latitude: 50.749, longitude: 6.479, altitude: 100 };
    const s = captureGpsAnchorSample(arPose, gps, { timestamp: 1 });
    expect(s.gpsPoint).toBe(gps);
  });

  it('omits fusedGpsPoint when not provided', () => {
    const s = captureGpsAnchorSample(
      arPose,
      { latitude: 50.749, longitude: 6.479 },
      { timestamp: 1 }
    );
    expect(s.fusedGpsPoint).toBeUndefined();
  });

  it('passes through fusedGpsPoint when provided', () => {
    const fused = { latitude: 50.7491, longitude: 6.4791, altitude: 99 };
    const s = captureGpsAnchorSample(
      arPose,
      { latitude: 50.749, longitude: 6.479 },
      { fusedGpsPoint: fused, timestamp: 1 }
    );
    expect(s.fusedGpsPoint).toBe(fused);
  });

  it('honors an explicit timestamp', () => {
    const s = captureGpsAnchorSample(
      arPose,
      { latitude: 50.749, longitude: 6.479 },
      { timestamp: 42 }
    );
    expect(s.timestamp).toBe(42);
  });

  it('defaults timestamp to Date.now() when omitted', () => {
    const before = Date.now();
    const s = captureGpsAnchorSample(arPose, {
      latitude: 50.749,
      longitude: 6.479,
    });
    const after = Date.now();
    expect(s.timestamp).toBeGreaterThanOrEqual(before);
    expect(s.timestamp).toBeLessThanOrEqual(after);
  });

  it('re-exports extractOdomPosition / extractOdomRotation', () => {
    expect(extractOdomPosition(arPose)).toEqual([1, 2, 3]);
    expect(extractOdomRotation(arPose)).toEqual([0, 0, 0, 1]);
  });
});
