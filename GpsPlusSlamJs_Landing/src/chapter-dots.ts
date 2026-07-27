import type { Chapter } from "./chapters";

/**
 * Chapter progress dots (v3 F6): a fixed rail of one clickable dot per
 * chapter — finally a real consumer for the `chapters.ts` labels, which
 * become the dots' aria-labels. Pure string/render helpers here; the
 * bootstrap owns the DOM container, click delegation and smooth scroll
 * (reusing the jump-to-demos scroll mechanism).
 */

/** Id of the static `<nav>` rail in index.html. */
export const CHAPTER_DOTS_CONTAINER_ID = "chapter-dots";

const ACTIVE_CLASS = "active";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The rail's inner HTML: one button per chapter, `data-index` for click
 * delegation, the chapter label as aria-label (screen readers get real
 * names, not "dot 3").
 */
export function chapterDotsHtml(chapters: readonly Chapter[]): string {
  return chapters
    .map(
      (chapter, index) =>
        `<button type="button" data-index="${index}" ` +
        `aria-label="${escapeHtml(chapter.label)}"></button>`,
    )
    .join("");
}

/** The minimal element surface `updateActiveDot` needs (testable). */
export interface DotsContainerLike {
  readonly children: ArrayLike<{
    classList: { toggle(name: string, force: boolean): unknown };
  }>;
}

/**
 * Mark exactly the dot at `activeIndex` as active. Out-of-range indices
 * (e.g. -1 before the first measurement) simply clear all dots.
 */
export function updateActiveDot(
  container: DotsContainerLike,
  activeIndex: number,
): void {
  for (let i = 0; i < container.children.length; i += 1) {
    container.children[i]?.classList.toggle(ACTIVE_CLASS, i === activeIndex);
  }
}

/**
 * Resolve a click inside the rail to a chapter index, or null when the
 * click missed a dot. Defensive: a malformed data-index yields null.
 */
export function dotIndexFromClick(target: unknown): number | null {
  const dataset = (target as { dataset?: { index?: string } } | null)?.dataset;
  if (!dataset || typeof dataset.index !== "string") {
    return null;
  }
  const index = Number.parseInt(dataset.index, 10);
  return Number.isFinite(index) && index >= 0 ? index : null;
}
