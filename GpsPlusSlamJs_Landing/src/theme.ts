/**
 * Palette controller: persisted color-palette choice with OS default.
 *
 * Round-2 R19 turned the light/dark toggle into a CYCLE over five curated
 * palettes. Resolution rule (must stay in sync with the inline FOUC-guard
 * script in index.html, which applies the same logic before first paint):
 * a validly persisted palette id wins; anything else falls back to
 * `prefers-color-scheme` (light → "light", dark → "dark"). The controller
 * owns the rule after boot and pushes every change through the injected
 * `applyTheme` seam, which the bootstrap wires to BOTH the DOM
 * (`data-theme` attribute → CSS custom properties) and the 3D palette.
 *
 * All browser APIs are injected seams so the module tests in plain node:
 * storage failures (Safari private mode, blocked third-party storage) are
 * swallowed — the visual cycle must keep working without persistence.
 */

/** Cycle order of the palette button. */
export const THEME_IDS = ["light", "dark", "neon", "dusk", "mono"] as const;

export type Theme = (typeof THEME_IDS)[number];

export const THEME_STORAGE_KEY = "gps-landing-theme";

/** Narrow storage seam; null when localStorage is unavailable entirely. */
type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export interface ThemeEnvironment {
  readonly storage: ThemeStorage | null;
  /** Seam over `matchMedia('(prefers-color-scheme: light)').matches`. */
  readonly prefersLight: () => boolean;
  /** Receives every palette change, including the initial resolution. */
  readonly applyTheme: (theme: Theme) => void;
}

export interface ThemeController {
  readonly theme: Theme;
  /** Advances to the next palette, applies + persists it, returns it. */
  cycle(): Theme;
}

function isThemeId(value: unknown): value is Theme {
  return (
    typeof value === "string" &&
    (THEME_IDS as readonly string[]).includes(value)
  );
}

/** Pure resolution rule shared conceptually with the index.html FOUC guard. */
export function resolveInitialTheme(
  stored: string | null,
  prefersLight: boolean,
): Theme {
  if (isThemeId(stored)) {
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
    // Persistence is best-effort; the in-page cycle must keep working.
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
    cycle() {
      const index = THEME_IDS.indexOf(theme);
      theme = THEME_IDS[(index + 1) % THEME_IDS.length] ?? "dark";
      env.applyTheme(theme);
      persistTheme(env.storage, theme);
      return theme;
    },
  };
}
