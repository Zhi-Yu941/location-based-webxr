/**
 * Hero veil opacity: the round-2 "normal landing page first" illusion.
 *
 * A fixed gradient overlay (`#hero-veil` in index.html) hides most of the
 * 3D world while the visitor is at the top of the page; this pure mapping
 * drives its opacity from the SCROLL OFFSET IN VIEWPORT HEIGHTS
 * (`scrollTop / viewportHeight`) — deliberately NOT from the story
 * progress, whose viewport-center reference sits well past zero even at
 * scrollTop 0 (which left the veil half-transparent at the very top,
 * caught by the mobile screenshot pass). It is a pure function with NO
 * latch: scrolling back up re-darkens the hero, so the page always looks
 * like a normal landing page at the top.
 */

/** Scroll offset (in viewport heights) at which the veil has fully lifted. */
export const VEIL_END_VIEWPORTS = 0.85;

/**
 * Opacity in [0,1]: 1 at scrollTop 0, eased down to 0 once the visitor
 * has scrolled VEIL_END_VIEWPORTS of a viewport. Non-finite input
 * (defensive: broken layout math upstream) yields the safe top-of-page
 * state (fully veiled) rather than flashing the scene.
 */
export function heroVeilOpacity(scrolledViewports: number): number {
  if (!Number.isFinite(scrolledViewports)) {
    return 1;
  }
  const t = Math.min(1, Math.max(0, scrolledViewports / VEIL_END_VIEWPORTS));
  // Smoothstep: eases both the lift-off and the final fade (no hard edge
  // at either end while scrubbing).
  const eased = t * t * (3 - 2 * t);
  return 1 - eased;
}
