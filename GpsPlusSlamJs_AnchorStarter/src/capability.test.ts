/**
 * Tests for the capability-gating helpers.
 *
 * Why this matters: decision D5 (E1) requires an honest, capability-gated
 * message instead of a thrown error on unsupported devices. These tests pin
 * that the message names exactly what is missing and is omitted when the
 * demo can actually run.
 */

import { describe, it, expect } from 'vitest';
import { isFullySupported, capabilityMessage } from './capability.js';

describe('isFullySupported', () => {
  it('is true only when both WebXR and geolocation are available', () => {
    expect(isFullySupported({ webxr: true, geolocation: true })).toBe(true);
    expect(isFullySupported({ webxr: true, geolocation: false })).toBe(false);
    expect(isFullySupported({ webxr: false, geolocation: true })).toBe(false);
    expect(isFullySupported({ webxr: false, geolocation: false })).toBe(false);
  });
});

describe('capabilityMessage', () => {
  it('returns null when everything is supported', () => {
    expect(capabilityMessage({ webxr: true, geolocation: true })).toBeNull();
  });

  it('names WebXR when only AR is missing', () => {
    const msg = capabilityMessage({ webxr: false, geolocation: true });
    expect(msg).toContain('WebXR');
    expect(msg).not.toContain('GPS / geolocation');
    expect(msg).toContain('AR-capable phone');
  });

  it('names GPS when only geolocation is missing', () => {
    const msg = capabilityMessage({ webxr: true, geolocation: false });
    expect(msg).toContain('GPS / geolocation');
    expect(msg).not.toContain('WebXR');
  });

  it('names both when nothing is supported', () => {
    const msg = capabilityMessage({ webxr: false, geolocation: false });
    expect(msg).toContain('WebXR');
    expect(msg).toContain('GPS / geolocation');
    expect(msg).toContain('and');
  });
});
