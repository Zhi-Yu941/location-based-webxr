import { describe, expect, it } from "vitest";
import { computeScrollState, type SectionMetrics } from "./scroll-story";

// Why this test matters: computeScrollState is the page's central mapping —
// it decides which chapter is active and how far the 3D story timeline is
// scrubbed. A wrong index desynchronizes copy and scene; a progress value
// outside [0,1] would seek the anime.js timeline out of range. These tests
// pin the exact semantics (viewport-center reference line, clamping, gap
// handling, and the PIECEWISE story progress that keeps copy↔3D-beat
// pairing viewport-independent) so refactors can't silently change them.

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
    expect(state.storyProgress).toBeCloseTo(0.4 / 3, 5);
    expect(state.chapterProgress).toBeCloseTo(0.4, 5);
  });

  it("activates the section containing the viewport-center line", () => {
    // scrollY 1100 + viewport/2 (400) => center line at 1500, inside section 1
    const state = computeScrollState(1100, 800, STACKED);
    expect(state.chapterIndex).toBe(1);
    expect(state.chapterProgress).toBeCloseTo(0.5, 5);
  });

  it("maps story progress PIECEWISE per section, not linearly over the scroll range (round-13 follow-up)", () => {
    // The round-13 screenshot pass showed the linear mapping pairs 3D
    // beats with DIFFERENT copy per viewport (the CTA section is far
    // taller than the others). Piecewise, the center line sitting at
    // fraction f of section i always yields (i + f) / N — so a chapter's
    // copy is on screen exactly while the timeline is in that chapter's
    // window, on every device.
    const unequal: readonly SectionMetrics[] = [
      { top: 0, height: 500 },
      { top: 500, height: 500 },
      { top: 1000, height: 3000 }, // tall CTA-like section
    ];
    // Center mid section 1 → story progress (1 + 0.5) / 3, NOT 750/4000.
    const midSecond = computeScrollState(750 - 400, 800, unequal);
    expect(midSecond.chapterIndex).toBe(1);
    expect(midSecond.storyProgress).toBeCloseTo(1.5 / 3, 5);
    // Center mid the TALL section → (2 + 0.5) / 3, NOT 2500/4000.
    const midTall = computeScrollState(2500 - 400, 800, unequal);
    expect(midTall.chapterIndex).toBe(2);
    expect(midTall.storyProgress).toBeCloseTo(2.5 / 3, 5);
  });

  it("clamps to the last chapter with full progress when scrolled past the end", () => {
    const state = computeScrollState(999999, 800, STACKED);
    expect(state.chapterIndex).toBe(2);
    expect(state.chapterProgress).toBe(1);
    expect(state.storyProgress).toBe(1);
  });

  it("clamps to chapter 0 when the center line is above the first section", () => {
    const sections: readonly SectionMetrics[] = [
      { top: 500, height: 1000 },
      { top: 1500, height: 1000 },
    ];
    const state = computeScrollState(0, 800, sections);
    expect(state.chapterIndex).toBe(0);
    expect(state.chapterProgress).toBe(0);
    expect(state.storyProgress).toBe(0);
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
    // The gap holds the story at the section boundary value — entering
    // the next section continues seamlessly from it (no jump).
    expect(state.storyProgress).toBeCloseTo(0.5, 5);
    const atNextTop = computeScrollState(1500 - 400, 800, sections);
    expect(atNextTop.storyProgress).toBeCloseTo(0.5, 5);
  });

  it("returns an inert zero state for an empty section list instead of throwing", () => {
    // Defensive boundary: index.html failing to render sections must not
    // crash the whole page script.
    const state = computeScrollState(100, 800, []);
    expect(state).toEqual({
      chapterIndex: 0,
      chapterProgress: 0,
      storyProgress: 0,
    });
  });

  it("treats non-finite scroll input as 0 instead of propagating NaN", () => {
    const state = computeScrollState(Number.NaN, 800, STACKED);
    expect(state.chapterIndex).toBe(0);
    expect(Number.isFinite(state.storyProgress)).toBe(true);
    expect(Number.isFinite(state.chapterProgress)).toBe(true);
  });
});
