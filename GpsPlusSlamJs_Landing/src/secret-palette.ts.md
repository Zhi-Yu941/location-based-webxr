# `secret-palette.ts` — hidden terminal-palette unlock (№4)

## Purpose

Detects the rapid palette-cycle burst (≥8 presses within ~4 s) that
unlocks the hidden `terminal` palette (catalog №4), and persists the
unlock so it stays available across visits. Fully hidden — no hint (E3).

## Public API

- `createSecretUnlock({ storage, now }): SecretUnlock`
  - `isUnlocked()` — whether the terminal palette is available.
  - `registerCycle()` — record a palette-cycle press; returns true on
    the press that JUST crossed the threshold (caller then jumps to the
    terminal palette).
- `SECRET_UNLOCK_KEY`, `SECRET_CYCLE_COUNT` (8), `SECRET_WINDOW_MS` (4000).

## Invariants & assumptions

- **Rolling window:** only presses within the last `SECRET_WINDOW_MS`
  count; spread-out browsing never unlocks (test-pinned).
- **Persisted, best-effort:** unlock flag stored under
  `SECRET_UNLOCK_KEY`; storage failures are swallowed — the unlock still
  holds in-session (test-pinned).
- **Injected seams** (`storage`, `now`) → tests run in node.
- Once unlocked, `registerCycle` never re-fires.
- Paired with `theme.ts`: `terminal` is a valid `Theme` (in
  `ALL_THEME_IDS`, accepted by the FOUC guard) but stays out of the
  cycle order until `isSecretUnlocked()` is true.

## Tests

`secret-palette.test.ts` — unlock on the Nth rapid press + persistence,
no unlock when spread beyond the window, starts unlocked from a
persisted flag, in-session unlock without storage.
