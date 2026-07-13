import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { heroVeilOpacity, VEIL_END_PROGRESS } from "./hero-veil";

// Why this test matters: the veil is the round-2 "normal landing page
// first" illusion — fully opaque gradient at the top, gone by the end of
// the hero chapter, and BACK when scrolling up (a pure function of
// progress, no one-way latch). A non-monotone or out-of-range value would
// flash the 3D world at the wrong moment or permanently dim the story.
describe("heroVeilOpacity", () => {
  it("is fully applied at the top and gone by the end of the hero", () => {
    expect(heroVeilOpacity(0)).toBe(1);
    expect(heroVeilOpacity(VEIL_END_PROGRESS)).toBe(0);
    expect(heroVeilOpacity(0.5)).toBe(0);
    expect(heroVeilOpacity(1)).toBe(0);
  });

  it("returns to opaque when scrolling back up (pure function, no latch)", () => {
    const mid = heroVeilOpacity(VEIL_END_PROGRESS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Same input, same output — scrubbing back re-darkens by construction.
    expect(heroVeilOpacity(0)).toBe(1);
  });

  it("stays in [0,1] and never increases with progress", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const atLo = heroVeilOpacity(lo);
          const atHi = heroVeilOpacity(hi);
          expect(atLo).toBeGreaterThanOrEqual(0);
          expect(atLo).toBeLessThanOrEqual(1);
          expect(atHi).toBeLessThanOrEqual(atLo);
        },
      ),
    );
  });

  it("treats non-finite progress as the safe top-of-page state", () => {
    expect(heroVeilOpacity(Number.NaN)).toBe(1);
    expect(heroVeilOpacity(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
