/**
 * Why this test matters: round-14 wants copy highlights (amber/red/AR
 * blue) to START colorless as a block fades in at the BOTTOM of the
 * screen and reach FULL color only as the block rises toward the TOP —
 * timed to the matching 3D beat. `scrollColorStrength` is the pure
 * driver: a 0→1 strength from an element's top position, expressed in
 * fractions of the viewport so it's viewport-independent (portrait vs
 * desktop). A wrong curve would color words too early (killing the
 * "why is that yellow?" beat) or never (missing it entirely).
 */
import { describe, expect, it } from "vitest";
import { scrollColorStrength } from "./scroll-color";

describe("scrollColorStrength", () => {
  const vh = 1000;

  it("is 0 while the element is low on screen (just faded in)", () => {
    // Default start = 0.85 vh: at/below that the block is colorless.
    expect(scrollColorStrength(900, vh)).toBe(0);
    expect(scrollColorStrength(vh, vh)).toBe(0);
    expect(scrollColorStrength(vh + 200, vh)).toBe(0);
  });

  it("is 1 once the element has reached the top band", () => {
    // Default full = 0.2 vh: at/above that the color is complete.
    expect(scrollColorStrength(200, vh)).toBe(1);
    expect(scrollColorStrength(50, vh)).toBe(1);
    expect(scrollColorStrength(-100, vh)).toBe(1);
  });

  it("ramps monotonically between the fade-in and full bands", () => {
    const mid = scrollColorStrength(550, vh); // between 0.85 and 0.2
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // Higher on screen (smaller top) → more color.
    expect(scrollColorStrength(400, vh)).toBeGreaterThan(
      scrollColorStrength(700, vh),
    );
  });

  it("is viewport-independent: same fractional position → same strength", () => {
    // Element top at 60% of the viewport on two very different screens.
    expect(scrollColorStrength(0.6 * 400, 400)).toBeCloseTo(
      scrollColorStrength(0.6 * 1600, 1600),
      6,
    );
  });

  it("honors custom start/full bands and stays clamped", () => {
    const s = scrollColorStrength(500, vh, { start: 0.7, full: 0.3 });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(scrollColorStrength(800, vh, { start: 0.7, full: 0.3 })).toBe(0);
    expect(scrollColorStrength(200, vh, { start: 0.7, full: 0.3 })).toBe(1);
  });

  it("degrades to full color on non-finite input (never a colorless flash)", () => {
    expect(scrollColorStrength(Number.NaN, vh)).toBe(1);
    expect(scrollColorStrength(300, Number.NaN)).toBe(1);
  });
});
