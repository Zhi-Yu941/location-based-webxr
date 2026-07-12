/**
 * Theme controller: persisted light/dark choice with OS-preference default.
 *
 * Resolution rule (must stay in sync with the inline FOUC-guard script in
 * index.html, which applies the same logic before first paint): a validly
 * persisted 'light'/'dark' wins; anything else falls back to
 * `prefers-color-scheme`. The controller owns the rule after boot and
 * pushes every change through the injected `applyTheme` seam, which the
 * bootstrap wires to BOTH the DOM (`data-theme` attribute → CSS custom
 * properties) and the 3D scene palette.
 *
 * All browser APIs are injected seams so the module tests in plain node:
 * storage failures (Safari private mode, blocked third-party storage) are
 * swallowed — the visual toggle must keep working without persistence.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "gps-landing-theme";

/** Narrow storage seam; null when localStorage is unavailable entirely. */
type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export interface ThemeEnvironment {
  readonly storage: ThemeStorage | null;
  /** Seam over `matchMedia('(prefers-color-scheme: light)').matches`. */
  readonly prefersLight: () => boolean;
  /** Receives every theme change, including the initial resolution. */
  readonly applyTheme: (theme: Theme) => void;
}

export interface ThemeController {
  readonly theme: Theme;
  /** Flips the theme, applies + persists it, and returns the new value. */
  toggle(): Theme;
}

/** Pure resolution rule shared conceptually with the index.html FOUC guard. */
export function resolveInitialTheme(
  stored: string | null,
  prefersLight: boolean,
): Theme {
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return prefersLight ? "light" : "dark";
}

function readStoredTheme(storage: ThemeStorage | null): string | null {
  try {
    return storage ? storage.getItem(THEME_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function persistTheme(storage: ThemeStorage | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; the in-page toggle must keep working.
  }
}

export function createThemeController(env: ThemeEnvironment): ThemeController {
  let theme = resolveInitialTheme(
    readStoredTheme(env.storage),
    env.prefersLight(),
  );
  env.applyTheme(theme);

  return {
    get theme() {
      return theme;
    },
    toggle() {
      theme = theme === "dark" ? "light" : "dark";
      env.applyTheme(theme);
      persistTheme(env.storage, theme);
      return theme;
    },
  };
}
