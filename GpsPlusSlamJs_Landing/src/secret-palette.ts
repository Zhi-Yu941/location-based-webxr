/**
 * Secret palette unlock (easter-egg catalog №4): cycling the palette
 * button ≥8× within ~4 s unlocks the hidden `terminal` palette. The
 * unlock is persisted (localStorage), so once found it stays available
 * across visits — but the palette stays OUT of the normal cycle until
 * unlocked (see `theme.ts` `cycle`).
 *
 * All browser APIs are injected seams so the module tests in plain node;
 * storage failures are swallowed (the unlock must still work in-session
 * without persistence).
 */

export const SECRET_UNLOCK_KEY = "gps-landing-secret";
/** Rapid-cycle threshold + window that unlock the terminal palette. */
export const SECRET_CYCLE_COUNT = 8;
export const SECRET_WINDOW_MS = 4000;

type UnlockStorage = Pick<Storage, "getItem" | "setItem">;

export interface SecretUnlockEnv {
  readonly storage: UnlockStorage | null;
  /** Seam over the clock (real: `performance.now()`). */
  readonly now: () => number;
}

export interface SecretUnlock {
  /** Whether the terminal palette is available. */
  isUnlocked(): boolean;
  /**
   * Record a palette-cycle press at the current time. Returns true on
   * the press that JUST crossed the threshold (so the caller can switch
   * to the terminal palette), false otherwise.
   */
  registerCycle(): boolean;
}

function readUnlocked(storage: UnlockStorage | null): boolean {
  try {
    return storage?.getItem(SECRET_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function persistUnlocked(storage: UnlockStorage | null): void {
  try {
    storage?.setItem(SECRET_UNLOCK_KEY, "1");
  } catch {
    // Best-effort; the in-session unlock still holds in memory.
  }
}

export function createSecretUnlock(env: SecretUnlockEnv): SecretUnlock {
  let unlocked = readUnlocked(env.storage);
  // Timestamps of recent cycle presses within the rolling window.
  let presses: number[] = [];

  return {
    isUnlocked() {
      return unlocked;
    },
    registerCycle() {
      if (unlocked) {
        return false;
      }
      const now = env.now();
      presses.push(now);
      // Drop presses older than the window.
      presses = presses.filter((t) => now - t <= SECRET_WINDOW_MS);
      if (presses.length >= SECRET_CYCLE_COUNT) {
        unlocked = true;
        presses = [];
        persistUnlocked(env.storage);
        return true;
      }
      return false;
    },
  };
}
