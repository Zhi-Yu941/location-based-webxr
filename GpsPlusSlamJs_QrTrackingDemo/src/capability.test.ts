/**
 * Capability gate — unit tests.
 *
 * Why this matters: the demo must run wherever WebXR exists (depth is optional,
 * with a manual-size fallback) and block honestly where WebXR is absent, rather
 * than crashing on a missing `navigator.xr`.
 */

import { describe, it, expect } from "vitest";
import { isDemoSupported, capabilityMessage } from "./capability";

describe("capability gate", () => {
  it("supported when WebXR is present (depth optional)", () => {
    expect(isDemoSupported({ webxr: true, depthSensing: true })).toBe(true);
    expect(isDemoSupported({ webxr: true, depthSensing: false })).toBe(true);
    expect(isDemoSupported({ webxr: false, depthSensing: true })).toBe(false);
  });

  it("blocks with a message when WebXR is missing", () => {
    const msg = capabilityMessage({ webxr: false, depthSensing: false });
    expect(msg).toMatch(/WebXR/);
  });

  it("warns (non-blocking) about the manual-size fallback when depth is missing", () => {
    const msg = capabilityMessage({ webxr: true, depthSensing: false });
    expect(msg).toMatch(/manually|auto-sizing/i);
  });

  it("returns null when everything the demo needs is present", () => {
    expect(capabilityMessage({ webxr: true, depthSensing: true })).toBeNull();
  });
});
