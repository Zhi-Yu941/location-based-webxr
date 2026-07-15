import { describe, expect, it } from "vitest";
import { CHAPTERS, CHAPTER_COUNT, sectionElementId } from "./chapters";

// Why this test matters: the chapter list is the single source of truth that
// the scroll state machine, the DOM sections in index.html, and the 3D story
// timeline all key off. If ids drift, duplicate, or reorder silently, the
// page still "works" but chapters and scenes desynchronize — these pins make
// that a loud failure instead.
describe("chapters", () => {
  it("defines the seven v1 chapters in the agreed narrative order", () => {
    // Order is a product decision from the plan doc ("Proposed chapter
    // order"): the dive comes after the fusion proof on purpose.
    expect(CHAPTERS.map((c) => c.id)).toEqual([
      "hero",
      "qr",
      "fusion",
      "dive",
      "anywhere",
      "gallery",
      "cta",
    ]);
    expect(CHAPTER_COUNT).toBe(7);
  });

  it("has unique ids and non-empty labels", () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chapter of CHAPTERS) {
      expect(chapter.label.length).toBeGreaterThan(0);
    }
  });

  it("maps chapter ids to the DOM section element ids used by index.html", () => {
    expect(sectionElementId("hero")).toBe("chapter-hero");
    expect(sectionElementId("cta")).toBe("chapter-cta");
  });
});
