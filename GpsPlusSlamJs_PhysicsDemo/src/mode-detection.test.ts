/**
 * Tests for `detectArSupport`.
 *
 * Why this test matters:
 * This single signal decides which whole path the demo runs (live AR vs. desktop
 * replay). It must be robustly defensive: a browser with no WebXR, or one whose
 * capability probe throws, must fall back to the replay path rather than crash on
 * startup — so every non-`true` branch is pinned here.
 */

import { describe, it, expect, vi } from "vitest";
import { detectArSupport } from "./mode-detection";

describe("detectArSupport", () => {
  it("returns false when navigator.xr is absent", async () => {
    expect(await detectArSupport(undefined)).toBe(false);
  });

  it("returns false when isSessionSupported is missing", async () => {
    expect(await detectArSupport({})).toBe(false);
  });

  it("returns true when immersive-ar is supported", async () => {
    const xr = { isSessionSupported: vi.fn().mockResolvedValue(true) };
    expect(await detectArSupport(xr)).toBe(true);
    expect(xr.isSessionSupported).toHaveBeenCalledWith("immersive-ar");
  });

  it("returns false when immersive-ar is unsupported", async () => {
    expect(
      await detectArSupport({
        isSessionSupported: () => Promise.resolve(false),
      }),
    ).toBe(false);
  });

  it("returns false when the probe rejects (no crash)", async () => {
    expect(
      await detectArSupport({
        isSessionSupported: () => Promise.reject(new Error("nope")),
      }),
    ).toBe(false);
  });
});
