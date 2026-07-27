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
  - Returns `{ chapterIndex, chapterProgress, storyProgress }`.
- `SectionMetrics`, `ChapterScrollState` — the associated types.

## Invariants & assumptions

- **Reference line:** the viewport center (`scrollY + viewportHeight/2`)
  in document coordinates. A chapter is active while that line is inside
  its section; a gap between sections belongs to the _previous_ section
  with `chapterProgress` clamped at 1 (no boundary flicker).
- **`storyProgress` is PIECEWISE per section (round-13 follow-up):** the
  center line at fraction f of section i maps to `(i + f) / N`. Every
  chapter owns exactly 1/N of the timeline regardless of its rendered
  section height, so the copy↔3D-beat pairing is viewport-independent
  (the previous linear-over-scroll-range mapping ran the 3D beats up to
  a chapter ahead of the copy on landscape phones, where the CTA section
  towers over the rest). Accepted trade-off: taller sections scrub their
  chapter window slower. `scripts/shoot-chapters.mjs` inverts this same
  mapping for `ms:` targets — keep the two in sync.
- **Clamping:** `chapterIndex ∈ [0, sections.length-1]`,
  `chapterProgress`/`storyProgress ∈ [0, 1]`. Above the first section →
  chapter 0 at progress 0; past the last → last chapter at progress 1.
- **Monotone AND continuous in `scrollY`** (property-tested): scrolling
  down never moves the story backwards, and a small scroll step never
  jumps the story (gaps hold the value flat; section boundaries hand
  over seamlessly). The timeline scrub relies on both.
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
storyTimeline.seek(state.storyProgress * storyTimeline.duration);
```

## Tests

- `scroll-story.test.ts` — pinned semantics: center-line activation, gap
  handling (incl. seamless hand-over into the next section), the
  piecewise-vs-linear distinction on unequal section heights, clamping at
  both ends, empty-list and NaN boundaries.
- `scroll-story.property.test.ts` — fast-check invariants: outputs always
  in range; monotonicity in `scrollY`; the piecewise definition itself
  (`(i + f) / N` independent of section heights); continuity (a δ scroll
  step moves the story ≤ δ/(minHeight·N)).
