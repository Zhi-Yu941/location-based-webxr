import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeScrollState, type SectionMetrics } from "./scroll-story";

// Why this test matters: the scroll mapping runs on every scroll event with
// arbitrary real-world metrics (fractional pixels, huge pages, tiny
// viewports). The invariants below — outputs always in range and monotone in
// scrollY — are exactly what the timeline scrubbing relies on; a violation
// would surface as a visual glitch that is very hard to reproduce manually.

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
          expect(state.overallProgress).toBeGreaterThanOrEqual(0);
          expect(state.overallProgress).toBeLessThanOrEqual(1);
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
          expect(after.overallProgress).toBeGreaterThanOrEqual(
            before.overallProgress,
          );
        },
      ),
    );
  });
});
