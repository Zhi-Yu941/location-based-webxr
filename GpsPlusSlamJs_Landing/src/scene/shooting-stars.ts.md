# `scene/shooting-stars.ts` — rare meteor streak (№7)

## Purpose

A rare shooting star (easter-egg catalog №7): every 30–60 s a bright
head + short fading trail crosses the upper sky in ~1.2 s. Dark palettes
only (dark/neon/dusk/terminal) — invisible against a bright sky, so
light/mono skip it.

## Public API

- `buildShootingStar(): Group` — the `shooting-star` group (head sphere +
  stretched trail), initially hidden.
- `updateShootingStar(group, t, enabled): boolean` — advance to clock
  time `t`; shows + positions the streak while an event is active and
  `enabled`, else hides it. Returns whether a streak is currently
  visible.
- `SHOOTING_STAR_NAME`, `STREAK_DURATION_MS` (1200).

## Invariants & assumptions

- **Deterministic schedule, clock-pure:** event start times and
  trajectories derive from `hash01(k)` — NO runtime `Math.random`, so
  the effect is history-independent (test-pinned) and never perturbs
  scrub-path independence.
- **Gaps 30–60 s** between events, INCLUDING the first: `eventStart(0)`
  is one full gap (≥30 s), not `0`. The caller feeds the page-load-
  relative clock, so a `t=0` event 0 would greet a fast load with an
  immediate meteor (test-pinned: first streak ≥30 s).
- **Dark-sky gate:** `enabled` is passed by the scene controller
  (`theme !== light && theme !== mono`); false → always hidden.
- **Continuous-render gate:** driven next to the particles/satellites,
  so a hidden tab or a non-particle tier never animates it. The head +
  trail use a fixed white `MeshBasicMaterial` (a sky effect, not
  role-tagged — untouched by palette traversal); opacity fades over the
  streak's last third.

## Tests

`shooting-stars.test.ts` — named + hidden build, always-hidden when
disabled, fires within 2 min + crosses the sky + hides after, clock
purity, 30–60 s spacing.
