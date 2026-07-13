# `hero-veil.ts` — "normal landing page first" veil opacity

## Purpose

Pure mapping from the scroll offset (in viewport heights) to the opacity
of the `#hero-veil` gradient overlay (round-2 R4): at scrollTop 0 the
veil FULLY hides the 3D world so the hero reads as a normal 2D landing
page; scrolling lifts it (gone after `VEIL_END_VIEWPORTS` of a
viewport), scrolling back re-darkens it — a pure function, deliberately
without a latch.

## Public API

- `heroVeilOpacity(scrolledViewports) → number` — opacity in [0,1];
  smoothstep-eased from 1 (at 0) to 0 (at `VEIL_END_VIEWPORTS`).
- `VEIL_END_VIEWPORTS` (0.85) — scroll offset in viewport heights where
  the veil is fully lifted.

## Invariants & assumptions

- **Keyed off `scrollTop / viewportHeight`, NOT story progress** — the
  story's viewport-center reference sits well past zero at scrollTop 0,
  which left the veil half-transparent at the very top (caught by the
  mobile screenshot pass). The raw offset guarantees full opacity exactly
  at the top.
- Output always in [0,1]; monotone non-increasing (property-tested) —
  the reveal never flickers while scrubbing.
- Non-finite input → 1 (the safe fully-veiled top-of-page state).
- Consumed by `main.ts` on every scroll event; the DOM element and its
  gradient/z-index live in `index.html` (`--veil` per palette; stronger
  small-screen gradient via media query).

## Examples

```ts
veil.style.opacity = String(
  heroVeilOpacity(scroller.scrollTop / scroller.clientHeight),
);
```

## Tests

`hero-veil.test.ts` — endpoint pins, no-latch purity, fast-check
range+monotonicity, non-finite fallback.
