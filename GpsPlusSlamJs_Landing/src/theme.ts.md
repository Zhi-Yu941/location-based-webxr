# `theme.ts` — persisted light/dark theme controller

## Purpose

Owns the page's light/dark theme: resolves the initial value (persisted
choice wins, else OS `prefers-color-scheme`), flips it on toggle, persists
it, and pushes every change through one `applyTheme` seam that the
bootstrap wires to both the DOM (`data-theme` → CSS custom properties)
and the 3D scene palette.

## Public API

- `resolveInitialTheme(stored, prefersLight) → Theme` — pure resolution
  rule: `'light'`/`'dark'` stored values win; anything else (null,
  garbage) falls back to the OS preference.
- `createThemeController(env: ThemeEnvironment) → ThemeController`
  - `env.storage: ThemeStorage | null` — narrowed localStorage seam.
  - `env.prefersLight: () => boolean` — matchMedia seam.
  - `env.applyTheme(theme)` — called once at creation and on every toggle.
  - Controller: `theme` (current value), `toggle() → Theme`.
- `THEME_STORAGE_KEY` (`"gps-landing-theme"`), `Theme`, `ThemeEnvironment`,
  `ThemeController`. (The narrow `ThemeStorage` seam type is module-private —
  `env.storage` is typed structurally.)

## Invariants & assumptions

- **Must stay in sync with the inline FOUC-guard script in `index.html`**,
  which duplicates the resolution rule (same storage key, same
  valid-values check, same prefers-color-scheme fallback) to set
  `data-theme` before first paint. If the rules diverge, the page flashes
  the wrong theme on load. `theme.test.ts` documents this coupling.
- **Storage is best-effort:** `getItem`/`setItem` throwing (Safari private
  mode, blocked storage) or `storage === null` never breaks the toggle —
  persistence is silently skipped.
- `applyTheme` is invoked exactly once at creation (with the resolved
  initial theme) and once per toggle.
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
