# `chapters.ts` — chapter list (single source of truth)

## Purpose

Defines the seven v1 story chapters (ids, order, debug labels). Everything
keys off this list: the DOM sections in `index.html`
(`<section id="chapter-<id>">`, same order), the scroll state machine, and
the story timeline's per-chapter staging.

## Public API

- `CHAPTERS` — readonly chapter list (`{ id, label }`), narrative order:
  `hero → qr → fusion → dive → anywhere → gallery → cta`.
- `ChapterId` — union of the ids.
- `CHAPTER_COUNT` — list length (7).
- `sectionElementId(id)` — DOM section element id (`chapter-<id>`).

## Invariants & assumptions

- **Order is a product decision** (plan doc "Proposed chapter order"): the
  dive comes after the fusion proof so visitors understand WHAT is stable
  before seeing it first-person. Test-pinned.
- Ids are unique; each has a matching `<section>` in `index.html`
  (`main.ts` warns loudly if one is missing).
- The story timeline assumes `CHAPTER_COUNT × CHAPTER_DURATION_MS` total
  duration — adding a chapter means adding BOTH a DOM section and a
  timeline segment.

## Examples

```ts
const sections = CHAPTERS.map((c) =>
  document.getElementById(sectionElementId(c.id)),
);
```

## Tests

`chapters.test.ts` — order, uniqueness, non-empty labels, element-id
mapping.
