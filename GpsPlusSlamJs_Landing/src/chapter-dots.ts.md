# `chapter-dots.ts` — story progress dot rail (v3 F6)

## Purpose

Render/update helpers for the fixed chapter-dot rail: one clickable dot
per chapter, active dot accent-colored, click = smooth scroll. The
first real consumer of the `chapters.ts` labels — they become the dots'
aria-labels.

## Public API

- `chapterDotsHtml(chapters): string` — one `<button data-index="i"
aria-label="<label>">` per chapter; labels are HTML-escaped.
- `updateActiveDot(container, activeIndex): void` — toggles the
  `active` class; out-of-range indices clear all dots.
- `dotIndexFromClick(target): number | null` — click-delegation helper;
  null on misses/malformed `data-index`.
- `CHAPTER_DOTS_CONTAINER_ID` (`"chapter-dots"`) — the static `<nav>`
  in index.html.

## Invariants & assumptions

- Pure helpers over minimal structural types — no DOM globals, tests
  run in plain node. The bootstrap (`main.ts`) owns the container,
  fills it once via `innerHTML`, delegates clicks, calls
  `updateActiveDot` from the scroll state machine, and scrolls with the
  same scroller mechanism as jump-to-demos (smooth, or instant under
  reduced motion).
- Labels are DATA: escaped on render — a future label with `<`/`"`
  can never inject markup.
- The static `<nav id="chapter-dots">` ships EMPTY (progressive
  enhancement: harmless without JS).

## Examples

```ts
container.innerHTML = chapterDotsHtml(CHAPTERS);
container.addEventListener("click", (e) => {
  const index = dotIndexFromClick(e.target);
  if (index !== null) scrollToChapter(index);
});
updateActiveDot(container, state.chapterIndex);
```

## Tests

`chapter-dots.test.ts` — button count + aria-labels from chapters.ts,
data-index order, HTML escaping, exact active-dot toggling, out-of-range
clearing, click resolution incl. malformed inputs.
`playwright-tests/scroll-story.spec.js` — rail presence (7 dots) and
click-to-navigate.
