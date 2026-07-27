/**
 * Hero code snippet expander (round-9 R9-5).
 *
 * v2 B3 hid the snippet entirely on small viewports (fold constraint).
 * Round-9 keeps it available EVERYWHERE instead: the snippet is a
 * native <details> that ships COLLAPSED in the static HTML (safe fold
 * on phones and for the no-JS floor) and is expanded at boot on
 * desktop-class viewports, where there is plenty of room.
 */

/** Id of the snippet <details> element in index.html. */
export const HERO_SNIPPET_ID = "hero-snippet";

export interface SnippetViewport {
  /** `window.innerWidth` in CSS px. */
  readonly width: number;
  /** `window.innerHeight` in CSS px. */
  readonly height: number;
}

/**
 * True iff the snippet should start expanded: wider than the v2 B3
 * phone breakpoint AND taller than the short-landscape floor (the same
 * boundaries that used to hide it entirely).
 */
export function shouldExpandHeroSnippet(viewport: SnippetViewport): boolean {
  return viewport.width > 720 && viewport.height > 500;
}

/**
 * Apply the default open state to the <details>. Missing element is a
 * no-op — the static page must never break over an enhancement.
 */
export function applyHeroSnippetDefault(
  doc: Pick<Document, "getElementById">,
  expand: boolean,
): void {
  const details = doc.getElementById(HERO_SNIPPET_ID);
  if (!details) {
    return;
  }
  (details as HTMLDetailsElement).open = expand;
}
