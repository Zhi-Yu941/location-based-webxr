# `scene/hero-idle.ts` — hero idle beat (№6)

## Purpose

If the visitor rests at the hero for over 60 s (scroll ≈ 0, tab
visible, scroll mode, motion allowed), a tiny second dot-person peeks
out ONCE from behind a hero-side bush, then ducks back (catalog №6). The
story's dot-person can't star (it waits sky-parked pre-drop), so this is
a separate little character.

## Public API

- `buildHeroPeeker(): { group, peeker }` — the `hero-idle` group (bush +
  the hidden `peeker` sub-group parked below ground) at a hero-side
  anchor.
- `createHeroIdleBeat(group, peeker): HeroIdleBeat` — `update(nowMs,
idleActive)` fed each frame; returns true while the peek animates.
- `HERO_IDLE_MS` (60000). (The group name is module-private.)

## Invariants & assumptions

- **Wall-clock, once per visit:** the idle timer accrues only while
  `idleActive`; scrolling away resets it (test-pinned), and after the
  peek fires once it never re-fires (latch).
- **Self-contained peek:** rise → hold → duck over 2.4 s, ending fully
  parked + `group.visible = false` (test-pinned).
- **Off under reduced motion / non-scroll:** the controller only builds
  the peeker in scroll mode; `idleActive` also requires the intro done,
  the tab visible, and the scrub resting at progress ≈ 0.
- Runs on the render loop's clock; renders only while peeking (dirty).

## Tests

`hero-idle.test.ts` — hidden build, fires only after the full window,
scroll-away resets the wait, fires exactly once and ends hidden.
