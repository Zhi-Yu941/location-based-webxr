/**
 * Why this test matters: the secret palette (catalog №4) unlocks on a
 * RAPID cycle burst (≥8 presses within ~4 s). A too-loose window would
 * unlock it by accident during normal browsing (breaking "fully
 * hidden"); a broken persistence would forget the unlock across visits.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createSecretUnlock,
  SECRET_CYCLE_COUNT,
  SECRET_UNLOCK_KEY,
  SECRET_WINDOW_MS,
} from "./secret-palette";

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    store,
  };
}

describe("createSecretUnlock", () => {
  it("unlocks exactly on the Nth rapid press and persists the flag", () => {
    const storage = makeStorage();
    let now = 0;
    const unlock = createSecretUnlock({ storage, now: () => now });
    expect(unlock.isUnlocked()).toBe(false);

    let justUnlocked = false;
    for (let i = 0; i < SECRET_CYCLE_COUNT; i++) {
      now += 200; // well within the window
      justUnlocked = unlock.registerCycle();
    }
    expect(justUnlocked).toBe(true); // fired on the Nth press
    expect(unlock.isUnlocked()).toBe(true);
    expect(storage.store.get(SECRET_UNLOCK_KEY)).toBe("1");
  });

  it("does NOT unlock when presses are spread beyond the window", () => {
    const storage = makeStorage();
    let now = 0;
    const unlock = createSecretUnlock({ storage, now: () => now });
    for (let i = 0; i < SECRET_CYCLE_COUNT * 2; i++) {
      now += SECRET_WINDOW_MS; // each press ages the previous ones out
      expect(unlock.registerCycle()).toBe(false);
    }
    expect(unlock.isUnlocked()).toBe(false);
  });

  it("starts unlocked when the flag was persisted on a prior visit", () => {
    const storage = makeStorage({ [SECRET_UNLOCK_KEY]: "1" });
    const unlock = createSecretUnlock({ storage, now: () => 0 });
    expect(unlock.isUnlocked()).toBe(true);
    // Already unlocked → registerCycle never re-fires.
    expect(unlock.registerCycle()).toBe(false);
  });

  it("still unlocks in-session when storage is unavailable", () => {
    let now = 0;
    const unlock = createSecretUnlock({ storage: null, now: () => now });
    let fired = false;
    for (let i = 0; i < SECRET_CYCLE_COUNT; i++) {
      now += 100;
      fired = unlock.registerCycle();
    }
    expect(fired).toBe(true);
    expect(unlock.isUnlocked()).toBe(true);
  });
});
