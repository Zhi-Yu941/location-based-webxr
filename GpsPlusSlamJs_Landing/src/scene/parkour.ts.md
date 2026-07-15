# `scene/parkour.ts` — dot-person parkour-hop egg (№2)

## Purpose

Clicking the teal dot-person (via the §2 plumbing) makes it do a quick
two-beat hop — crouch → jump with a flip-suggesting yaw spin → settle
bounce (~700 ms) — tying to the "jump-and-run parkour" copy line.

## Public API

- `triggerParkourHop(person, nowMs)` — start a hop; ignored while one is
  already running (no restart).
- `parkourOffset(person, nowMs): { y, spin, active }` — the current
  ADDITIVE offset (pure, no mutation). Advances the state machine and
  self-clears to the idle zero offset when the hop ends.

## Invariants & assumptions

- **Purely additive, never touches `walk.t` or the timeline:** the
  offset is layered by the scene controller on top of the freshly placed
  walk pose (`syncStage` runs each active frame + once at the end), so
  scrub-path independence holds and the offset never accumulates.
- **Pure computation:** `parkourOffset` mutates only its own state
  machine (start time), never the person transform — same time → same
  offset (test-pinned).
- Envelope: crouch 90 ms (dip 0.09) → airborne 420 ms (jump 1.25, full
  360° yaw) → settle 190 ms (bounce 0.14).
- Off under reduced motion: the click glue that calls `clickAt` is only
  wired in scroll mode (main.ts), so eggs never fire under reduced
  motion.
- State lives in `person.userData.parkour`.

## Examples

```ts
triggerParkourHop(person, now); // on click
// per tick, after syncStage places the person:
const off = parkourOffset(person, now);
person.position.y += off.y;
person.rotation.y += off.spin;
```

## Tests

`parkour.test.ts` — rising offset mid-hop + idle zero before/after,
airborne spin, pure/no-mutation, mid-hop re-trigger ignored, re-hop
after finish. `scene-controller.test.ts` pins the click→hop→land
integration.
