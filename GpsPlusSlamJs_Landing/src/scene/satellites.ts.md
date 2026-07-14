# `scene/satellites.ts` — permanent orbiting GPS satellites (№0)

## Purpose

Tiny low-poly GPS satellites on slow, tilted circular orbits far above
the little world — a PERMANENT ambient scene feature (easter-egg catalog
E2/№0, the maintainer's twist on the dropped Konami satellite show). They
echo the real GNSS constellation the product builds on.

## Public API

- `buildSatellites(): Group` — the `gps-satellites` group (name exported
  as `SATELLITES_NAME`) with two satellites (box body + two solar-panel
  wings, palette role `satellite` — blue family per the color coding),
  PARKED at the deterministic clock-zero orbit pose.
- `updateSatellites(group, timeMs): void` — advance the orbits. Pure in
  `timeMs`: the same timestamp always yields the same poses.

## Invariants & assumptions

- **Clock-pure motion:** position/rotation depend only on `timeMs`, never
  on scroll progress or call history — the story's scrub-path-independence
  is untouched (same contract as `particles.ts`).
- **Orbit envelope (test-pinned):** y stays within 28–36, horizontal
  radius ≤ 20 — over the disc, far above all world content (skyline tops
  out ~15). The catalog's 35–45 band was consciously lowered at
  implementation: the screenshot pass (the decision mechanism the
  catalog itself prescribed) showed 35–45 orbits ABOVE every story
  framing's frustum — invisible in practice. At 28–36 they cross the
  visible sky of the pull-back framings (works-anywhere, journey).
- **Parked = built (test-pinned):** `buildSatellites` places satellites
  at the t=0 pose, so reduced-motion and low-tier visitors (whose
  controller never runs the continuous loop) see a complete, static
  composition — the satellites are never hidden, only frozen.
- **Gating lives in `scene-controller.ts`:** `updateSatellites` is called
  next to `updateParticles` under the same scroll-mode + high-tier + tab-
  visible gate (v3 F2 continuous render).
- Orbit line consciously omitted (screenshot pass judged the bare
  satellites sufficient; "keep simple").
- Deterministic; no RNG.

## Examples

```ts
const satellites = buildSatellites();
scene.add(satellites);
// per animation frame (continuous loop only):
updateSatellites(satellites, performance.now());
```

## Tests

`satellites.test.ts` — group/name/role contract, palette-role coverage in
all palettes, deterministic build parked at t=0, clock purity (history-
independent poses), orbit envelope sweep (height band + radius bound).
