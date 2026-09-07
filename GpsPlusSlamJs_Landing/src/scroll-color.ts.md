# `scroll-color.ts` — scroll-linked copy highlight color (R14-4)

## Purpose

Drives the round-14 effect where a copy block's color-coded words
(amber GPS, red anchors, AR blue, …) START colorless as the block fades
in near the BOTTOM of the screen and reach FULL color only as it rises
toward the TOP — timed to the matching 3D beat, so the reader asks "why
is that word colored?".

## Public API

- `scrollColorStrength(topPx, viewportHeight, bands?) → number` — pure
  0→1 strength from a copy element's top position (viewport px). 0 =
  colorless (block low), 1 = full color (block in the top band).
- `ColorBands` — `{ start, full }` as fractions of the viewport height
  (defaults 0.85 → 0.2).

## Invariants & assumptions

- **Viewport-independent:** bands are FRACTIONS of `viewportHeight`, so
  the same fractional element position yields the same strength on a
  portrait phone and a desktop (same lesson as the piecewise
  scroll→timeline mapping).
- **Monotone:** higher on screen (smaller `topPx`) → more color.
- **Safe default:** non-finite input → 1 (full color), never a colorless
  flash.
- **Consumption:** `main.ts` writes the result to each `.copy` element's
  `--hl-strength` on scroll (scroll mode only); the CSS lerps
  `.copy .hl-raw/.hl-code/.hl-fused` from `--text` to the target via
  `color-mix`. Default `--hl-strength: 1` keeps hero/snippet/no-JS/
  reduced-motion at full color.

## Tests

`scroll-color.test.ts` — 0 low / 1 in the top band, monotone ramp,
viewport independence, custom bands clamped, non-finite → 1.
