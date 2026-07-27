# `scene/geocache.ts` — the geocache chest egg (№1)

## Purpose

The most on-brand hidden egg (geocaching = the genre's ancestor): a
palm-sized low-poly chest on the castle vignette's disc. A genuine click
(via the §2 egg plumbing) pops the lid and raises a tiny amber "signal"
pin; clicking again hides it. Fully hidden — no hints, no tracking
(catalog E3/E4).

## Public API

- `buildGeocache(anchor: Vector3): Group` — the closed chest
  (`GEOCACHE_NAME`) with lid hinge (`GEOCACHE_LID_NAME`) and signal pin
  (`GEOCACHE_PIN_NAME`), standing on the ground at `anchor`, front
  facing the world center. Placed by clay-world on the castle disc.
- `toggleGeocache(chest, nowMs): { opened }` — flip found ↔ hidden;
  the caller shows the toast only when `opened`.
- `updateGeocache(chest, nowMs): boolean` — advance a running
  transition; true while animating (controller marks the frame dirty).

## Invariants & assumptions

- **Wall-clock event animation, NOT scroll-driven:** the 300 ms
  transition runs on tick time (ambient-drift precedent) — the story's
  scrub guarantees are untouched.
- **Interrupt-safe:** toggling mid-flight captures the CURRENT pose and
  eases from there (test-pinned — no snap).
- **Palm-sized + grounded (test-pinned):** bounding box ≲ 1 unit; the
  hidden pin sinks INTO the disc (solid geometry hides it) instead of
  using visibility flags.
- Colors: chest = `trunk` role (wood family), pin = `markerRaw` (amber
  GPS family — the color-coding invariant).
- State lives in `chest.userData.geocache`; the module is deterministic.

## Examples

```ts
const chest = buildGeocache(anchor);
const { opened } = toggleGeocache(chest, performance.now());
// per tick: if (updateGeocache(chest, nowMs)) markDirty();
```

## Tests

`geocache.test.ts` — palm-size/grounding/roles/determinism, open/close
state machine, settle detection, interrupt-safe reversal.
`scene-controller.test.ts` pins the click→open→animate integration.
