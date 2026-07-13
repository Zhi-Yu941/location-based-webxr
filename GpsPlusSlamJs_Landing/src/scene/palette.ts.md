# `scene/palette.ts` — dual scene palettes + role-based recoloring

## Purpose

Encodes the plan's visual decision (light = white/matte clay world, dark =
night world with glowing accents) as two palettes, and recolors the whole
scene graph in one traversal via `userData.paletteRole` tags — the
mechanism behind the theme toggle. Also provides the shared mesh/group
factories all scene builders use.

## Public API

- `PALETTE_ROLES` / `PaletteRole` — the closed set of role tags.
- `getPalette(theme: Theme) → ScenePalette` — `background`, `fog`,
  `hemisphere` + `directional` light settings, `sky` (v3 F3: zenith/
  horizon gradient colors + `accents` kind + `accentColor`, consumed by
  `sky-dome.ts` — NOT by the role traversal), and `roles` (per-role
  `{ color, emissive?, emissiveIntensity? }`).
- The accent-set union (`"moon-stars" | "sun" | "star-grid" | "none"`)
  is module-private (`SkyAccents`), same knip rule as `RoleStyle`.
- `applyPaletteToScene(root, palette)` — recolors every role-tagged
  `MeshStandardMaterial` under `root` (color + emissive).
- `clayMesh(geometry, role, name?)` — flat-shaded standard-material mesh
  with its own material instance, role tag, and shadows on.
- `namedGroup(name)` — terse named `Group` factory.
- `ScenePalette` type (the per-role style shape `RoleStyle` is
  module-private).

## Invariants & assumptions

- **Both palettes define every role** (test-pinned) — a missing role would
  leave meshes in the other theme's colors after a toggle.
- **The fused-anchor accent is `#ef4444` in both themes**, matching the
  page chrome's `--accent` (brand continuity, test-pinned).
- Dark theme glows via `emissiveIntensity > 0`; light theme is matte
  (`0`). `applyPaletteToScene` always writes all three channels, so
  toggling back fully restores the previous look (no sticky state).
- Unknown role strings and non-standard materials are skipped silently —
  a bad tag degrades to "keeps previous color", never a crash.
- `clayMesh` gives each mesh its OWN material instance; sharing across
  roles would corrupt palette application.

## Examples

```ts
const world = buildClayWorld("high");
applyPaletteToScene(world, getPalette("dark"));
```

## Tests

`palette.test.ts` — role completeness in both themes, accent pin, glow
vs. matte, recolor + toggle-back traversal, unknown-tag/no-tag skipping.
