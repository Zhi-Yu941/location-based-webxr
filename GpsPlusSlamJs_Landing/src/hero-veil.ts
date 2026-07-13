/**
 * Hero veil opacity: the round-2 "normal landing page first" illusion.
 *
 * A fixed gradient overlay (`#hero-veil` in index.html) hides most of the
 * 3D world while the visitor is at the top of the page; this pure mapping
 * drives its opacity from the overall scroll progress. It is deliberately
 * a pure function with NO latch: scrolling back up re-darkens the hero,
 * so the page always looks like a normal landing page at the top.
 */

/** Story progress at which the veil has fully lifted (~hero chapter end). */
export const VEIL_END_PROGRESS = 0.12;

/**
 * Opacity in [0,1]: 1 at the top, eased down to 0 at VEIL_END_PROGRESS.
 * Non-finite input (defensive: broken layout math upstream) yields the
 * safe top-of-page state (fully veiled) rather than flashing the scene.
 */
export function heroVeilOpacity(overallProgress: number): number {
  if (!Number.isFinite(overallProgress)) {
    return 1;
  }
  const t = Math.min(1, Math.max(0, overallProgress / VEIL_END_PROGRESS));
  // Smoothstep: eases both the lift-off and the final fade (no hard edge
  // at either end while scrubbing).
  const eased = t * t * (3 - 2 * t);
  return 1 - eased;
}
