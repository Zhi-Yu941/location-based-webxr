import { describe, expect, it } from "vitest";
import { computeScrollState, type SectionMetrics } from "./scroll-story";

// Why this test matters: computeScrollState is the page's central mapping —
// it decides which chapter is active and how far the 3D story timeline is
// scrubbed. A wrong index desynchronizes copy and scene; a progress value
// outside [0,1] would seek the anime.js timeline out of range. These tests
// pin the exact semantics (viewport-center reference line, clamping, gap
// handling) so refactors can't silently change them.

/** Three 1000px-tall sections stacked from y=0, no gaps. */
const STACKED: readonly SectionMetrics[] = [
  { top: 0, height: 1000 },
  { top: 1000, height: 1000 },
  { top: 2000, height: 1000 },
];

describe("computeScrollState", () => {
  it("starts at chapter 0 with zero progress at the top of the page", () => {
    const state = computeScrollState(0, 800, STACKED);
    expect(state.chapterIndex).toBe(0);
    expect(state.overallProgress).toBeCloseTo(400 / 3000, 5);
    expect(state.chapterProgress).toBeCloseTo(0.4, 5);
  });

  it("activates the section containing the viewport-center line", () => {
    // scrollY 1100 + viewport/2 (400) => center line at 1500, inside section 1
    const state = computeScrollState(1100, 800, STACKED);
    expect(state.chapterIndex).toBe(1);
    expect(state.chapterProgress).toBeCloseTo(0.5, 5);
  });

  it("clamps to the last chapter with full progress when scrolled past the end", () => {
    const state = computeScrollState(999999, 800, STACKED);
    expect(state.chapterIndex).toBe(2);
    expect(state.chapterProgress).toBe(1);
    expect(state.overallProgress).toBe(1);
  });

  it("clamps to chapter 0 when the center line is above the first section", () => {
    const sections: readonly SectionMetrics[] = [
      { top: 500, height: 1000 },
      { top: 1500, height: 1000 },
    ];
    const state = computeScrollState(0, 800, sections);
    expect(state.chapterIndex).toBe(0);
    expect(state.chapterProgress).toBe(0);
    expect(state.overallProgress).toBe(0);
  });

  it("assigns a gap between sections to the previous section, clamped to full progress", () => {
    const sections: readonly SectionMetrics[] = [
      { top: 0, height: 1000 },
      { top: 1500, height: 1000 }, // 500px gap after section 0
    ];
    // center line at 1200: in the gap after section 0
    const state = computeScrollState(800, 800, sections);
    expect(state.chapterIndex).toBe(0);
    expect(state.chapterProgress).toBe(1);
  });

  it("returns an inert zero state for an empty section list instead of throwing", () => {
    // Defensive boundary: index.html failing to render sections must not
    // crash the whole page script.
    const state = computeScrollState(100, 800, []);
    expect(state).toEqual({
      chapterIndex: 0,
      chapterProgress: 0,
      overallProgress: 0,
    });
  });

  it("treats non-finite scroll input as 0 instead of propagating NaN", () => {
    const state = computeScrollState(Number.NaN, 800, STACKED);
    expect(state.chapterIndex).toBe(0);
    expect(Number.isFinite(state.overallProgress)).toBe(true);
    expect(Number.isFinite(state.chapterProgress)).toBe(true);
  });
});
