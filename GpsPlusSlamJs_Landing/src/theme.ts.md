# `theme.ts` — persisted palette-cycle controller

## Purpose

Owns the page's color palette (round-2 R19: five curated palettes
cycled by the palette button, not a light/dark toggle): resolves the
initial value (persisted id wins, else OS `prefers-color-scheme` →
light/dark), advances on `cycle()`, persists the choice, and pushes
every change through one `applyTheme` seam that the bootstrap wires to
both the DOM (`data-theme` → CSS custom properties) and the 3D scene
palette.

## Public API

- `THEME_IDS` — the cycle order: `light, dark, neon, dusk, mono`.
- `resolveInitialTheme(stored, prefersLight) → Theme` — pure resolution
  rule: any valid stored id wins; anything else (null, garbage) falls
  back to the OS preference (light/dark).
- `createThemeController(env: ThemeEnvironment) → ThemeController`
  - `env.storage: ThemeStorage | null` — narrowed localStorage seam.
  - `env.prefersLight: () => boolean` — matchMedia seam.
  - `env.applyTheme(theme)` — called once at creation and on every cycle.
  - Controller: `theme` (current value), `cycle() → Theme`.
- `THEME_STORAGE_KEY` (`"gps-landing-theme"`), `Theme`, `ThemeEnvironment`,
  `ThemeController`. (The narrow `ThemeStorage` seam type is module-private —
  `env.storage` is typed structurally.)

## Invariants & assumptions

- **Must stay in sync with the inline FOUC-guard script in `index.html`**,
  which duplicates the resolution rule (same storage key, same
  valid-id list, same prefers-color-scheme fallback) to set
  `data-theme` before first paint — AND with the CSS: every id in
  `THEME_IDS` needs an `html[data-theme="<id>"]` custom-property block in
  index.html and a `ScenePalette` in `scene/palette.ts` (test-pinned via
  the palette completeness test).
- **Storage is best-effort:** `getItem`/`setItem` throwing (Safari private
  mode, blocked storage) or `storage === null` never breaks the cycle —
  persistence is silently skipped.
- `applyTheme` is invoked exactly once at creation (with the resolved
  initial theme) and once per cycle step.
- No browser globals are touched — all environment access is injected, so
  the module tests in plain node.

## Examples

```ts
const controller = createThemeController({
  storage: safeLocalStorage(), // null when access throws
  prefersLight: () =>
    window.matchMedia("(prefers-color-scheme: light)").matches,
  applyTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    scene?.applyPalette(theme);
  },
});
themeToggleButton.addEventListener("click", () => controller.toggle());
```

## Tests

`theme.test.ts` — persisted-over-OS resolution, garbage fallback, initial
apply-once, toggle flip+persist+apply, throwing/absent storage resilience.
