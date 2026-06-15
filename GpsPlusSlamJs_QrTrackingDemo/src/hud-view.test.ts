/**
 * HUD view-model — unit tests.
 *
 * Why this matters: the developer reads the running median off this HUD to
 * confirm a freshly printed QR against a tape measure, so the cm/mm formatting
 * and the lifecycle labels must be exact.
 */

import { describe, it, expect } from "vitest";
import { toHudView } from "./hud-view";

describe("toHudView", () => {
  it("shows placeholders when no size is known yet", () => {
    const v = toHudView("scanning", undefined);
    expect(v.statusLabel).toMatch(/scanning/i);
    expect(v.sizeLabel).toBe("—");
    expect(v.sampleLabel).toBe("0 samples");
    expect(v.lifecycleLabel).toBe("unknown");
  });

  it("formats the median in cm and the spread in mm", () => {
    const v = toHudView("tracking", {
      status: "estimated",
      estimateM: 0.201,
      sampleCount: 12,
      spreadM: 0.004,
    });
    expect(v.statusLabel).toMatch(/Locked/);
    expect(v.sizeLabel).toBe("20.1 cm");
    expect(v.sampleLabel).toBe("12 samples");
    expect(v.spreadLabel).toBe("±4 mm");
    expect(v.lifecycleLabel).toBe("estimated");
  });

  it("uses the singular 'sample' for exactly one", () => {
    const v = toHudView("scanning", {
      status: "measuring",
      estimateM: 0.2,
      sampleCount: 1,
      spreadM: 0,
    });
    expect(v.sampleLabel).toBe("1 sample");
  });

  it("shows 'measuring…' while measuring with no median yet", () => {
    const v = toHudView("scanning", {
      status: "measuring",
      estimateM: null,
      sampleCount: 0,
      spreadM: 0,
    });
    expect(v.sizeLabel).toBe("measuring…");
  });
});
