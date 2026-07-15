# `scene/particles.ts` — ambient palette-specific particle field (v3 F2)

## Purpose

One deterministic `Points` cloud (single draw call) that gives every
chapter subtle living atmosphere: fireflies in dark/dusk, techno dust in
neon, sunlit motes in light/mono.

## Public API

- `buildParticleField(): Points` — 130 deterministic particles over the
  walkable world (seeded LCG); per-particle phase + base positions live
  in `userData.particleBasis`.
- `applyParticlePalette(field, palette): void` — recolors from
  `palette.particles.color` and switches the style tuning (size,
  opacity, drift speed, bob) from `palette.particles.style`.
- `updateParticles(field, timeMs): void` — advances the sinusoidal
  drift. **Pure in `timeMs`** — same clock value, same positions.
- `PARTICLE_FIELD_NAME` — scene-graph name of the field.

## Invariants & assumptions

- **Time-driven, never scrub-driven:** motion is a pure function of the
  clock, so the story's scrub-path-independence suites stay untouched
  (test-pinned: same timestamp → identical positions).
- **Bounded drift:** base positions keep `DRIFT_AMPLITUDE` clearance
  from the area/height bounds, so animated particles can never leave
  the world disc or dip under the floor (test-pinned at arbitrary
  times).
- **Determinism:** seeded LCG — two builds are identical (test-pinned).
- The continuous-render loop that animates this lives in
  `scene-controller.ts` and is gated by tab visibility + tier (scroll
  mode + high geometry detail only) — this module has no timers of its
  own. Malformed `userData` degrades to a silent no-op.

## Examples

```ts
const field = buildParticleField();
scene.add(field);
applyParticlePalette(field, getPalette("dark")); // fireflies
updateParticles(field, performance.now());
```

## Tests

`particles.test.ts` — palette particle-block completeness (all five
themes), build determinism, material contract (transparent, no depth
write), motion over time, clock-purity, bounds at arbitrary times,
palette recolor + style tuning.
