import { describe, expect, it, vi } from "vitest";
import {
  createThemeController,
  resolveInitialTheme,
  THEME_IDS,
  THEME_STORAGE_KEY,
} from "./theme";

// Why this test matters: the palette is a first-paint-visible product
// decision (default follows the OS, the choice persists across visits) and
// it drives BOTH the CSS custom properties and the 3D palette. Round-2
// turned the light/dark toggle into a CYCLE over five curated palettes —
// these tests pin the cycle order, the persistence of every id, and the
// resolution rules the inline FOUC-guard script in index.html duplicates.

describe("resolveInitialTheme", () => {
  it("uses any validly persisted palette id over the OS preference", () => {
    expect(resolveInitialTheme("light", false)).toBe("light");
    expect(resolveInitialTheme("dark", true)).toBe("dark");
    expect(resolveInitialTheme("neon", true)).toBe("neon");
    expect(resolveInitialTheme("dusk", false)).toBe("dusk");
    expect(resolveInitialTheme("mono", false)).toBe("mono");
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
  it("applies the resolved initial palette once on creation", () => {
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "dusk" }),
      prefersLight: () => false,
      applyTheme,
    });
    expect(controller.theme).toBe("dusk");
    expect(applyTheme).toHaveBeenCalledExactlyOnceWith("dusk");
  });

  it("cycle walks through every palette in order and persists each step", () => {
    const storage = makeStorage();
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage,
      prefersLight: () => false, // initial: dark
      applyTheme,
    });

    // From dark the cycle continues with the ids after it, wrapping.
    const darkIndex = THEME_IDS.indexOf("dark");
    const expected = [
      ...THEME_IDS.slice(darkIndex + 1),
      ...THEME_IDS.slice(0, darkIndex + 1),
    ];
    for (const id of expected) {
      expect(controller.cycle()).toBe(id);
      expect(applyTheme).toHaveBeenLastCalledWith(id);
      expect(storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, id);
    }
    // Full loop: back at the start.
    expect(controller.theme).toBe("dark");
  });

  it("keeps cycling even when storage is unavailable or throws", () => {
    // Safari private mode throws on setItem; storage can be null when
    // localStorage access itself throws. The visual cycle must still work.
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
    expect(withThrowing.cycle()).toBe("dark");
    expect(applyTheme).toHaveBeenLastCalledWith("dark");

    const withoutStorage = createThemeController({
      storage: null,
      prefersLight: () => false,
      applyTheme: () => {},
    });
    expect(withoutStorage.cycle()).toBe("neon");
  });

  it("keeps the hidden terminal palette OUT of the cycle until unlocked (catalog №4)", () => {
    const applyTheme = vi.fn();
    let unlocked = false;
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "mono" }),
      prefersLight: () => false,
      applyTheme,
      isSecretUnlocked: () => unlocked,
    });
    // Locked: mono wraps back to light, never terminal.
    expect(controller.cycle()).toBe("light");

    // Unlocked: terminal joins the cycle after mono.
    unlocked = true;
    controller.set("mono");
    expect(controller.cycle()).toBe("terminal");
    expect(controller.cycle()).toBe("light"); // wraps past terminal
  });

  it("set() jumps straight to a valid palette and persists it", () => {
    const storage = makeStorage();
    const applyTheme = vi.fn();
    const controller = createThemeController({
      storage,
      prefersLight: () => false,
      applyTheme,
    });
    expect(controller.set("terminal")).toBe("terminal");
    expect(controller.theme).toBe("terminal");
    expect(applyTheme).toHaveBeenLastCalledWith("terminal");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "terminal",
    );
  });

  it("resolves a persisted terminal palette on boot (FOUC-guard parity)", () => {
    const controller = createThemeController({
      storage: makeStorage({ [THEME_STORAGE_KEY]: "terminal" }),
      prefersLight: () => true,
      applyTheme: () => {},
    });
    expect(controller.theme).toBe("terminal");
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
