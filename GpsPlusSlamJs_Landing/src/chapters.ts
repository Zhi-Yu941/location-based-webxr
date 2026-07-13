/**
 * The single source of truth for the scroll-story chapters.
 *
 * Every part of the page keys off this list: the DOM sections in
 * `index.html` (one `<section id="chapter-<id>">` per entry, same order),
 * the scroll state machine that maps scroll progress to a chapter, and the
 * 3D story timeline that stages the scene per chapter. The order is a
 * product decision (see the plan doc's "Proposed chapter order"): the
 * first-person dive comes after the fusion proof so visitors understand
 * WHAT is stable before seeing it first-person.
 */
export interface Chapter {
  /** Stable id shared between DOM, state machine, and timeline. */
  readonly id: string;
  /** Short human-readable label (used for aria/debugging, not copy). */
  readonly label: string;
}

export const CHAPTERS = [
  { id: "hero", label: "GPS alone → fused for AR" },
  { id: "qr", label: "QR code = door + instant anchor" },
  { id: "fusion", label: "Wobbly GPS vs. fused anchor" },
  { id: "dive", label: "Ego view through the phone" },
  { id: "anywhere", label: "Works anywhere, offline" },
  { id: "gallery", label: "Use-case gallery" },
  { id: "cta", label: "Code on GitHub + live demos" },
] as const satisfies readonly Chapter[];

export type ChapterId = (typeof CHAPTERS)[number]["id"];

export const CHAPTER_COUNT = CHAPTERS.length;

/** DOM element id of a chapter's `<section>` in index.html. */
export function sectionElementId(id: ChapterId): string {
  return `chapter-${id}`;
}
