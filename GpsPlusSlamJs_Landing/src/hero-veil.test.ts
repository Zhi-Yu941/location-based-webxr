import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { heroVeilOpacity, VEIL_END_VIEWPORTS } from "./hero-veil";

// Why this test matters: the veil is the round-2 "normal landing page
// first" illusion — FULLY opaque at scrollTop 0 (the mobile screenshot
// pass caught a half-transparent veil when it was keyed off story
// progress, whose center-line reference is > 0 at the top), gone after
// scrolling less than one viewport, and BACK when scrolling up (a pure
// function of the scroll offset, no one-way latch).
describe("heroVeilOpacity", () => {
  it("is FULLY opaque at the very top and gone within one viewport of scrolling", () => {
    expect(heroVeilOpacity(0)).toBe(1);
    expect(heroVeilOpacity(VEIL_END_VIEWPORTS)).toBe(0);
    expect(heroVeilOpacity(1)).toBe(0);
    expect(heroVeilOpacity(5)).toBe(0);
  });

  it("returns to opaque when scrolling back up (pure function, no latch)", () => {
    const mid = heroVeilOpacity(VEIL_END_VIEWPORTS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Same input, same output — scrubbing back re-darkens by construction.
    expect(heroVeilOpacity(0)).toBe(1);
  });

  it("stays in [0,1] and never increases with scrolling", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
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

  it("treats non-finite input as the safe top-of-page state", () => {
    expect(heroVeilOpacity(Number.NaN)).toBe(1);
    expect(heroVeilOpacity(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
