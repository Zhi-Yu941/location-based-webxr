# `scene/satellites.ts` — roaming GPS satellites (№0)

## Purpose

Tiny low-poly GPS satellites that drift slowly and AUTONOMOUSLY across
the high sky — a permanent ambient scene feature (catalog E2/№0). They
echo the real GNSS constellation the product builds on.

## Public API

- `buildSatellites(): Group` — the `gps-satellites` group (name exported
  as `SATELLITES_NAME`) with two satellites (box body + two solar-panel
  wings, palette role `satellite` — blue family), placed at a fixed,
  pleasant static PARK pose (visible, high).
- `updateSatellites(group, timeMs): void` — advance the roaming passes.
  Pure in `timeMs`: the same timestamp always yields the same poses +
  visibility.

## Invariants & assumptions

- **Roaming passes (round-14 R14-9):** instead of fixed circular orbits,
  each satellite crosses the sky on a long straight track, goes away
  (`visible = false`) between passes, and returns later on a different,
  HASHED track — so you only catch one "wenn man Glück hat" while the
  camera is far out (works-anywhere / journey pull-backs). Two satellites
  are phase-offset (46 s / 58 s periods) so their windows rarely overlap.
- **Clock-pure motion:** position/rotation/visibility depend only on
  `timeMs`, never on scroll or call history (scrub-path independence,
  test-pinned).
- **High + within reach (test-pinned):** visible satellites stay y > 20
  (above the ~15-unit skyline) and within an 80-unit horizontal radius.
- **Parked = built (test-pinned):** `buildSatellites` places them at a
  fixed visible high pose; reduced-motion / low-tier visitors (whose
  controller never runs the continuous loop) see that complete static
  composition. The roaming schedule takes over on the first
  `updateSatellites` with no visible jump (scroll mode overwrites the
  park pose immediately).
- **Gating lives in `scene-controller.ts`:** `updateSatellites` runs next
  to `updateParticles` under the same scroll-mode + high-tier + tab-
  visible gate (v3 F2 continuous render).
- Deterministic; no runtime RNG (a cheap integer hash seeds each pass).

## Examples

```ts
const satellites = buildSatellites();
scene.add(satellites);
// per animation frame (continuous loop only):
updateSatellites(satellites, performance.now());
```

## Tests

`satellites.test.ts` — group/name/role contract, palette-role coverage,
visible-high park pose, deterministic build, clock purity, a pass that
crosses the sky then goes away, a later differing pass, and the
height/reach sweep over visible satellites.
