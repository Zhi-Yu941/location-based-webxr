# `scene/ghost-restore.ts` — castle ghost-restore egg (№3)

## Purpose

The "make the invisible visible" message as a toy (catalog №3): clicking
the castle vignette (via the §2 plumbing) briefly SOLIDIFIES the
translucent AR-blue ghost of the broken tower while dimming the ruin,
holds ~1.5 s, then melts back.

## Public API

- `initGhostRestore(castle)` — capture the ghost + ruin material
  baselines and stash effect state on the castle group. Call once after
  building the world (scene-controller does this).
- `triggerGhostRestore(castle, nowMs)` — fire the effect; ignored while
  one is already running (no restart/jump).
- `updateGhostRestore(castle, nowMs): boolean` — advance the ramp; true
  while animating, false when idle (restores exact built state on end).

## Invariants & assumptions

- **Runtime-only material ramp, wall-clock (not scroll):** opacity is
  animated at runtime; the story scrub is untouched.
- **Exact restoration (test-pinned):** on completion every ghost/ruin
  material returns to its captured built opacity + transparent flag — so
  the built ghost opacity (0.1–0.6, pinned in `use-case-vignettes.test.ts`)
  and `depthWrite: false` (which stops the ghost occluding the ruin)
  survive the effect untouched. `depthWrite` is never written here.
- **Envelope:** ramp up (320 ms) → hold at peak (1500 ms) → ramp down
  (460 ms). Ghost peaks at 0.9; ruin dims to 0.5 (transparency toggled
  on for the dim, restored opaque afterward).
- Pure in the clock while animating (history-independent poses).
- State lives in `castle.userData.ghostRestore`.

## Examples

```ts
initGhostRestore(castle);
triggerGhostRestore(castle, performance.now()); // on click
// per tick: if (updateGhostRestore(castle, nowMs)) markDirty();
```

## Tests

`ghost-restore.test.ts` — ramp-up + exact restore of the built ghost
state (opacity + depthWrite), ruin dim + opaque restore, clock purity
and mid-effect re-trigger being a no-op. `scene-controller.test.ts` can
extend to the click integration.
