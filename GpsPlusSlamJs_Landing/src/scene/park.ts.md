# `scene/park.ts` — mini parkour park (R14-12)

## Purpose

A small rounded lawn patch in front of the city highrises with a little
course of green blocks that pop in while the works-anywhere copy ("a
park with your jump-and-run parkour") is on screen — the word
"jump-and-run parkour" reveals in the matching green.

## Public API

- `buildParcoursPark(anchor: Vector3): Group` — the `parcours-park` group:
  a permanent sunken lawn disc (`grass` role) + a `parkour-blocks`
  (`PARK_BLOCKS_NAME`) child group of green blocks (`parkour` role, a new
  coding color) of varying heights.
- `PARK_NAME`, `PARK_BLOCKS_NAME`.

## Invariants & assumptions

- **Lawn permanent, blocks animated:** the lawn is scenery; the story
  timeline primes the `parkour-blocks` children hidden (scale ~0) and
  pops them in one by one during the works-anywhere window (test-pinned),
  scrubbing back re-hides them.
- **Nothing floats (test-pinned, R10-3):** the lawn is a sunken disc
  (skirt below y=0).
- **Placement:** in front of the highrises (pulled back toward the world
  center from the skyline row), so the blocks read as a distant green
  twinkle during the far-out works-anywhere moment and are already there
  when the camera reaches the city.
- Deterministic; no RNG.

## Tests

`park.test.ts` — lawn + blocks group, parkour-role coverage in every
palette, sunken lawn (no float), determinism + anchor.
`story-timeline.test.ts` pins the works-anywhere pop-in window.
