import { describe, expect, it } from "vitest";
import { decideQualityTier, type CapabilityInputs } from "./capability";

// Why this test matters: the tier decision implements the plan's "full
// experience everywhere, tiered quality" fallback ladder. Getting a branch
// wrong doesn't crash anything — it silently gives phones a page that
// stutters (too high) or desktops a needlessly ugly scene (too low), or
// worse, plays scroll animation for users who asked for reduced motion.
// These tests pin every rung of the ladder.

const CAPABLE: CapabilityInputs = {
  webglSupported: true,
  prefersReducedMotion: false,
  deviceMemoryGb: 8,
  hardwareConcurrency: 12,
  devicePixelRatio: 2,
};

describe("decideQualityTier", () => {
  it("gives capable hardware the full scroll experience", () => {
    expect(decideQualityTier(CAPABLE)).toEqual({
      mode: "scroll",
      dprCap: 2,
      shadows: true,
      geometryDetail: "high",
    });
  });

  it("drops to the low tier on weak hardware but keeps the scroll story", () => {
    const weakMemory = decideQualityTier({ ...CAPABLE, deviceMemoryGb: 2 });
    expect(weakMemory.mode).toBe("scroll");
    expect(weakMemory.shadows).toBe(false);
    expect(weakMemory.geometryDetail).toBe("low");
    expect(weakMemory.dprCap).toBeLessThanOrEqual(1.5);

    const weakCpu = decideQualityTier({
      ...CAPABLE,
      hardwareConcurrency: 4,
    });
    expect(weakCpu.geometryDetail).toBe("low");
  });

  it("treats unknown hardware stats as capable (unknown ≠ weak)", () => {
    // Firefox/Safari expose neither deviceMemory nor (sometimes) meaningful
    // concurrency; punishing them by default would degrade most desktops.
    const unknown = decideQualityTier({
      ...CAPABLE,
      deviceMemoryGb: undefined,
      hardwareConcurrency: undefined,
    });
    expect(unknown.geometryDetail).toBe("high");
    expect(unknown.shadows).toBe(true);
  });

  it("selects reduced-motion mode when the user asks for it, at any tier", () => {
    const reduced = decideQualityTier({
      ...CAPABLE,
      prefersReducedMotion: true,
    });
    expect(reduced.mode).toBe("reduced-motion");
    // Quality tiering is orthogonal: a capable device still renders nicely.
    expect(reduced.geometryDetail).toBe("high");
  });

  it("falls back to static DOM when WebGL is unavailable, overriding everything", () => {
    const noWebgl = decideQualityTier({
      ...CAPABLE,
      webglSupported: false,
      prefersReducedMotion: true,
    });
    expect(noWebgl.mode).toBe("static-dom");
    expect(noWebgl.shadows).toBe(false);
  });

  it("never caps DPR above the device's actual ratio and never below 1", () => {
    expect(decideQualityTier({ ...CAPABLE, devicePixelRatio: 1 }).dprCap).toBe(
      1,
    );
    expect(decideQualityTier({ ...CAPABLE, devicePixelRatio: 3 }).dprCap).toBe(
      2,
    );
    // Defensive: garbage DPR (0, NaN) clamps to 1 instead of producing a
    // zero-sized framebuffer.
    expect(decideQualityTier({ ...CAPABLE, devicePixelRatio: 0 }).dprCap).toBe(
      1,
    );
    expect(
      decideQualityTier({ ...CAPABLE, devicePixelRatio: Number.NaN }).dprCap,
    ).toBe(1);
  });
});
