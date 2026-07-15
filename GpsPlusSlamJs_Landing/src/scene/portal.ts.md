# `scene/portal.ts` — forest magic portal (R14-10)

## Purpose

A glowing cyan gateway that opens between two trees near the tents while
"Works anywhere. Fully offline." is on screen (the copy names "a forest
with a magic portal that only opens at dawn"), then closes as the camera
turns to the city. A vertical disc with two slowly counter-rotating
rings — a gentle swirl, no shader (the clay world is flat-shaded).

## Public API

- `buildForestPortal(anchor, faceToward): Group` — the `forest-portal`
  group (disc + 2 rings, `portal` palette role = a distinct cyan),
  facing `faceToward`, primed CLOSED (`scale ~0`) for the timeline.
- `updatePortalSpin(group, timeMs): void` — swirl the rings; pure in the
  clock.
- `PORTAL_NAME`.

## Invariants & assumptions

- **Open/close is timeline-driven:** the story timeline pops the group
  scale 0→1 (3820) and 1→0 (4480) — open during the far-out
  works-anywhere moment (forest in frame), closed by the time the camera
  reaches the city (test-pinned).
- **Swirl is clock-pure:** ring rotation depends only on `timeMs` (never
  scroll), run by the continuous-render loop next to the
  particles/satellites; counter-rotating rings (test-pinned).
- **A gateway, not a wall:** every mesh is `transparent` + `depthWrite:
false`, so it glows without occluding the world (test-pinned).
- Faces the approaching camera (disc normal toward `faceToward`).
- The copy word "magic portal" reveals in the matching `--hl-portal`
  cyan via the scroll-linked fade.

## Tests

`portal.test.ts` — closed build + portal-role meshes, palette coverage,
translucent/no-depth, faces the camera, clock-pure counter-rotating
swirl. `story-timeline.test.ts` pins the open-far-out / closed-at-city
window.
