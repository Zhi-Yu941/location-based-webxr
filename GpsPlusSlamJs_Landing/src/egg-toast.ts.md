# `egg-toast.ts` — transient easter-egg feedback pill

## Purpose

The hidden eggs' only feedback channel (no counters, no ledger — E4): a
tiny transient `role="status"` pill naming what just happened ("🎉 Cache
found — GCLANDING, logged."), then fading. The page had no generic toast
before this; it is styled in index.html (`#egg-toast`) to match the
`.qr-caption` voice.

## Public API

- `showEggToast(message, doc = document)` — lazily creates the singleton
  `#egg-toast` element, sets the message, adds `.visible`; auto-removes
  the class after `EGG_TOAST_VISIBLE_MS` (2600 ms). Re-showing resets
  the timer.
- `EGG_TOAST_ID`, `EGG_TOAST_VISIBLE_MS`, `ToastDocument` (the injected
  Document slice — the unit suite runs in node, no jsdom).

## Invariants & assumptions

- CSS owns the fade (`.visible` transition in index.html); the module
  only toggles the class — no JS animation.
- Singleton element, created once; `role="status"` so screen readers
  announce it politely.
- One module-level hide timer: re-shows never race an older hide.

## Examples

```ts
if (result?.egg === "geocache" && result.opened) {
  showEggToast("🎉 Cache found — GCLANDING, logged.");
}
```

## Tests

`egg-toast.test.ts` — create-once + role + message, auto-hide after the
window, re-show resets the timer (fake timers, fake document).
