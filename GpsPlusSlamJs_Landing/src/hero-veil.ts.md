# `hero-veil.ts` — "normal landing page first" veil opacity

## Purpose

Pure mapping from overall scroll progress to the opacity of the
`#hero-veil` gradient overlay (round-2 R4): at the top of the page the
veil hides most of the 3D world so the hero reads as a normal 2D landing
page; scrolling lifts it (fully gone by `VEIL_END_PROGRESS`), scrolling
back re-darkens it — a pure function, deliberately without a latch.

## Public API

- `heroVeilOpacity(overallProgress) → number` — opacity in [0,1];
  smoothstep-eased from 1 (at 0) to 0 (at `VEIL_END_PROGRESS`).
- `VEIL_END_PROGRESS` (0.12) — story progress where the veil is fully
  lifted (~end of the hero chapter).

## Invariants & assumptions

- Output always in [0,1]; monotone non-increasing in progress
  (property-tested) — the reveal never flickers while scrubbing.
- Non-finite input → 1 (the safe fully-veiled top-of-page state).
- Consumed by `main.ts` on every scroll event with
  `computeScrollState(...).overallProgress`; the DOM element and its
  gradient/z-index live in `index.html` (`--veil` per palette).

## Examples

```ts
veilElement.style.opacity = String(heroVeilOpacity(state.overallProgress));
```

## Tests

`hero-veil.test.ts` — endpoint pins, no-latch purity, fast-check
range+monotonicity, non-finite fallback.
