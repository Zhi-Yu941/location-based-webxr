import { describe, expect, it, vi } from "vitest";
import {
  createThemeController,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
} from "./theme";

// Why this test matters: the theme is a first-paint-visible product decision
// (default follows the OS, the toggle persists across visits) and it drives
// BOTH the CSS custom properties and the 3D palette. These tests pin the
// resolution rules the inline FOUC-guard script in index.html duplicates —
// if the two ever disagree, the page flashes the wrong theme on load.

describe("resolveInitialTheme", () => {
  it("uses a validly persisted theme over the OS preference", () => {
    expect(resolveInitialTheme("light", false)).toBe("light");
    expect(resolveInitialTheme("dark", true)).toBe("dark");
  });

  it("falls back to the OS preference for missing or garbage stored values", () => {
    expect(resolveInitialTheme(null, true)).toBe("light");
    expect(resolveInitialTheme(null, false)).toBe("dark");
    expect(resolveInitialTheme("solarized", true)).toBe("light");
    expect(resolveInitialTheme("", false)).toBe("dark");
  });
});

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    store,
  };
}

describe("createThemeController", () => {
  it("applies the resolved initial theme once on creation", () => {
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "light" }),
      prefersLight: () => false,
      applyTheme,
    });
    expect(controller.theme).toBe("light");
    expect(applyTheme).toHaveBeenCalledExactlyOnceWith("light");
  });

  it("toggle flips the theme, applies it, and persists it", () => {
    const storage = makeStorage();
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage,
      prefersLight: () => false, // initial: dark
      applyTheme,
    });

    expect(controller.toggle()).toBe("light");
    expect(controller.theme).toBe("light");
    expect(applyTheme).toHaveBeenLastCalledWith("light");
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");

    expect(controller.toggle()).toBe("dark");
    expect(storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, "dark");
  });

  it("keeps toggling even when storage is unavailable or throws", () => {
    // Safari private mode throws on setItem; storage can be null when
    // localStorage access itself throws. The visual toggle must still work.
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const applyTheme = vi.fn();
    const withThrowing = createThemeController({
      storage: throwingStorage,
      prefersLight: () => true,
      applyTheme,
    });
    expect(withThrowing.toggle()).toBe("dark");
    expect(applyTheme).toHaveBeenLastCalledWith("dark");

    const withoutStorage = createThemeController({
      storage: null,
      prefersLight: () => false,
      applyTheme,
    });
    expect(withoutStorage.toggle()).toBe("light");
  });

  it("survives a getItem that throws by falling back to the OS preference", () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    const controller = createThemeController({
      storage: brokenStorage,
      prefersLight: () => true,
      applyTheme: () => {},
    });
    expect(controller.theme).toBe("light");
  });
});
