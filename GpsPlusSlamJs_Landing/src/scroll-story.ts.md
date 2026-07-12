# `scroll-story.ts` — scroll → chapter state machine

## Purpose

Pure mapping from a scroll position to the active story chapter and the
story-wide progress. It is the page's central state machine: the DOM
section highlighting, the reduced-motion chapter seeks, and the 3D
timeline scrub all consume its output.

## Public API

- `computeScrollState(scrollY, viewportHeight, sections) → ChapterScrollState`
  - `sections: readonly SectionMetrics[]` — `{ top, height }` in document
    px, sorted by `top` (the DOM order of the chapter `<section>`s).
  - Returns `{ chapterIndex, chapterProgress, overallProgress }`.
- `SectionMetrics`, `ChapterScrollState` — the associated types.

## Invariants & assumptions

- **Reference line:** the viewport center (`scrollY + viewportHeight/2`)
  in document coordinates. A chapter is active while that line is inside
  its section; a gap between sections belongs to the _previous_ section
  with `chapterProgress` clamped at 1 (no boundary flicker).
- **Clamping:** `chapterIndex ∈ [0, sections.length-1]`,
  `chapterProgress`/`overallProgress ∈ [0, 1]`. Above the first section →
  chapter 0 at progress 0; past the last → last chapter at progress 1.
- **Monotone in `scrollY`** (property-tested): scrolling down never moves
  the story backwards. The timeline scrub relies on this.
- **Defensive:** empty `sections` → inert zero state; non-finite
  `scrollY`/`viewportHeight` are treated as 0; zero/negative heights yield
  progress 0 instead of NaN. The landing page degrades, never crashes.
- Pure and allocation-light — called on every scroll event.

## Examples

```ts
const sections = chapterSections.map((el) => ({
  top: el.offsetTop,
  height: el.offsetHeight,
}));
const state = computeScrollState(window.scrollY, window.innerHeight, sections);
storyTimeline.seek(state.overallProgress * storyTimeline.duration);
```

## Tests

- `scroll-story.test.ts` — pinned semantics: center-line activation, gap
  handling, clamping at both ends, empty-list and NaN boundaries.
- `scroll-story.property.test.ts` — fast-check invariants: outputs always
  in range; monotonicity in `scrollY` for arbitrary stacked sections with
  gaps.
