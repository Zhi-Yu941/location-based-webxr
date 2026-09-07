# `hero-snippet.ts` — snippet expander default (round-9 R9-5)

## Purpose

Decides whether the hero code snippet (`<details id="hero-snippet">`)
starts expanded. v2 B3 hid the snippet entirely on phones; round-9 made
it available everywhere — collapsed by default in the static HTML,
opened at boot on desktop-class viewports.

## Public API

- `shouldExpandHeroSnippet({ width, height }): boolean` — true iff
  `width > 720 && height > 500` (the same boundaries that used to hide
  the snippet entirely).
- `applyHeroSnippetDefault(doc, expand): void` — sets `details.open`;
  missing element is a no-op.
- `HERO_SNIPPET_ID` (`"hero-snippet"`).

## Invariants & assumptions

- The static HTML ships the `<details>` CLOSED: with JS disabled (or on
  the static floor) phones keep their fold and desktops see a one-line
  summary — the safe default in both worlds.
- Pure decision + minimal DOM surface (`Pick<Document,
"getElementById">`) — tests run in plain node.
- Boot-time only; no resize re-evaluation on purpose (flipping the
  expander under the user's finger mid-session would be worse than a
  stale default).

## Examples

```ts
applyHeroSnippetDefault(
  document,
  shouldExpandHeroSnippet({
    width: window.innerWidth,
    height: window.innerHeight,
  }),
);
```

## Tests

`hero-snippet.test.ts` — viewport decision matrix + property-based
boundary equivalence, open/collapse application, missing-element no-op.
`playwright-tests/scroll-story.spec.js` — desktop starts open; mobile
suites assert collapsed + visible summary.
