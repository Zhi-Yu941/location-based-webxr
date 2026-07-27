import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeScrollState, type SectionMetrics } from "./scroll-story";

// Why this test matters: the scroll mapping runs on every scroll event with
// arbitrary real-world metrics (fractional pixels, huge pages, tiny
// viewports). The invariants below — outputs always in range, monotone in
// scrollY, continuous across section boundaries, and the PIECEWISE
// definition itself (fraction f of section i ⇒ (i+f)/N, independent of the
// section heights, i.e. of the viewport/layout) — are exactly what the
// timeline scrubbing relies on; a violation would surface as a visual
// glitch that is very hard to reproduce manually.

/** Arbitrary list of 1..10 stacked sections with optional gaps. */
const sectionsArb = fc
  .array(
    fc.record({
      gap: fc.double({ min: 0, max: 500, noNaN: true }),
      height: fc.double({ min: 1, max: 5000, noNaN: true }),
    }),
    { minLength: 1, maxLength: 10 },
  )
  .map((parts) => {
    const sections: SectionMetrics[] = [];
    let top = 0;
    for (const part of parts) {
      top += part.gap;
      sections.push({ top, height: part.height });
      top += part.height;
    }
    return sections;
  });

const scrollArb = fc.double({ min: -1000, max: 100000, noNaN: true });
const viewportArb = fc.double({ min: 100, max: 4000, noNaN: true });

describe("computeScrollState properties", () => {
  it("always returns an index in range and progresses in [0,1]", () => {
    fc.assert(
      fc.property(
        scrollArb,
        viewportArb,
        sectionsArb,
        (scrollY, vh, sections) => {
          const state = computeScrollState(scrollY, vh, sections);
          expect(state.chapterIndex).toBeGreaterThanOrEqual(0);
          expect(state.chapterIndex).toBeLessThan(sections.length);
          expect(state.chapterProgress).toBeGreaterThanOrEqual(0);
          expect(state.chapterProgress).toBeLessThanOrEqual(1);
          expect(state.storyProgress).toBeGreaterThanOrEqual(0);
          expect(state.storyProgress).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("is monotone in scrollY: scrolling down never moves the story backwards", () => {
    fc.assert(
      fc.property(
        scrollArb,
        fc.double({ min: 0, max: 50000, noNaN: true }),
        viewportArb,
        sectionsArb,
        (scrollY, delta, vh, sections) => {
          const before = computeScrollState(scrollY, vh, sections);
          const after = computeScrollState(scrollY + delta, vh, sections);
          expect(after.chapterIndex).toBeGreaterThanOrEqual(
            before.chapterIndex,
          );
          expect(after.storyProgress).toBeGreaterThanOrEqual(
            before.storyProgress,
          );
        },
      ),
    );
  });

  it("story progress is PIECEWISE: fraction f of section i maps to (i+f)/N regardless of section heights", () => {
    // This is the round-13 follow-up's core promise: the pairing between
    // visible copy (which section the center line is in) and the 3D
    // timeline window is independent of how tall the sections are — and
    // therefore independent of the viewport that determined those heights.
    fc.assert(
      fc.property(
        sectionsArb,
        viewportArb,
        fc.nat(9),
        // Bounded away from 0/1: reconstructing the center line via
        // `top + f·h − vh/2` and back loses an ulp, which at the EXACT
        // section edge flips the active index (the mapping VALUE is
        // continuous there, so this is a sampling artifact, not a bug).
        fc.double({ min: 0.001, max: 0.99, noNaN: true }),
        (sections, vh, indexSeed, fraction) => {
          const index = indexSeed % sections.length;
          const section = sections[index];
          if (section === undefined) {
            return;
          }
          const centerLine = section.top + fraction * section.height;
          const state = computeScrollState(centerLine - vh / 2, vh, sections);
          expect(state.chapterIndex).toBe(index);
          expect(state.storyProgress).toBeCloseTo(
            (index + fraction) / sections.length,
            6,
          );
        },
      ),
    );
  });

  it("story progress is continuous: a small scroll step never jumps it (no boundary cuts)", () => {
    // Piecewise mapping must still be seamless at section boundaries and
    // across gaps (which hold the value flat) — within a section the
    // slope is 1/(height·N), so a δ step moves the story by at most
    // δ/(minHeight·N).
    fc.assert(
      fc.property(
        scrollArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        viewportArb,
        sectionsArb,
        (scrollY, delta, vh, sections) => {
          const before = computeScrollState(scrollY, vh, sections);
          const after = computeScrollState(scrollY + delta, vh, sections);
          const minHeight = Math.min(...sections.map((s) => s.height));
          const bound = delta / (minHeight * sections.length) + 1e-9;
          expect(
            after.storyProgress - before.storyProgress,
          ).toBeLessThanOrEqual(bound);
        },
      ),
    );
  });
});
