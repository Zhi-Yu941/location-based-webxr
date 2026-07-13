# `scene/sky-dome.ts` — per-palette gradient sky + celestial accents (v3 F3)

## Purpose

Replaces the flat background color above the horizon with one
vertex-colored gradient dome plus palette-specific celestial accents:
dark = moon + deterministic star sprinkle, dusk = low sun + warm horizon
band, neon = synthwave star grid, light/mono = the soft gradient alone.

## Public API

- `buildSkyDome(): Group` — the `sky-dome` group; all accents start
  hidden until a palette applies.
- `applySkyPalette(sky, palette): void` — repaints the dome gradient
  from `palette.sky` (zenith/horizon), toggles exactly that palette's
  accent set, recolors accents with `palette.sky.accentColor`. Missing
  nodes are no-ops.
- `domeGradientColorAt(elevation01, palette): Color` — the analytic
  gradient (smoothstep horizon→zenith); exported so tests can pin it.
- `SKY_NODE` — names of all addressable nodes (root, shell, moon,
  stars, sun, horizonBand, starGrid).

## Invariants & assumptions

- **Fog exclusion:** every sky material has `fog: false`. The dome sits
  at radius 150 while the scene fog ends at ~90 — with fog on it would
  render as a flat fog-colored shell and hide all accents.
- **Draw order:** shell `renderOrder: -10`, accents `-9`, `depthWrite:
false`, `frustumCulled: false` — the sky renders first and the world
  always draws on top.
- **Color-coding invariant untouched:** amber/red/blue roles are not
  used in the sky; all sky colors live in `palette.sky` only.
- **Determinism:** the star sprinkle uses a seeded LCG — two builds are
  identical (test-pinned).
- The dome is unlit (`MeshBasicMaterial`) and NOT part of the
  `paletteRole` traversal; `scene-controller.applyThemeInternal` calls
  `applySkyPalette` right after `applyPaletteToScene`.

## Examples

```ts
const sky = buildSkyDome();
scene.add(sky);
applySkyPalette(sky, getPalette("dusk")); // sun + horizon band visible
```

## Tests

`sky-dome.test.ts` — palette sky-block completeness across all five
themes, node-name contract, fog exclusion, depth/render order, star
determinism, per-palette accent visibility matrix, analytic gradient
endpoints. Visual truth: `pnpm run shoot` across all palettes.
