# status-panel.ts

## Purpose

Controller for the minimal example's `<pre id="status">` element: renders the
formatted status text with a write-skipping cache and flashes transient hints
("waiting for GPS…") that auto-restore the status after a delay. Extracted
from the `main()` closure during the PR #177 review so the cache/hint
interaction is unit-testable.

## Public API

- `createStatusPanel(deps: StatusPanelDeps): StatusPanel`
  - `deps.statusEl: StatusElementLike` — the element to write to (anything
    with a mutable `textContent`); the panel is its **only** writer.
  - `deps.getStatusText: () => string` — returns the current formatted status
    (the app passes a `formatStatus(...)` closure over the store state).
  - `deps.hintDurationMs?: number` — hint display time, default `1500`.
- `StatusPanel.refreshStatus(): void` — re-renders; skips the DOM write when
  the text is unchanged (quality-review F-12 — the store subscriber calls
  this per action).
- `StatusPanel.showHint(message: string): void` — writes the hint immediately,
  cancels any pending restore timer, and schedules `refreshStatus` after the
  hint duration.

No error modes: inputs are plain values/closures; `getStatusText` exceptions
propagate to the caller (`formatStatus` validates its own inputs).

## Invariants & assumptions

- **Hint always yields to status:** `showHint` invalidates the equality cache
  before scheduling the restore, so the restore re-writes the status even when
  the formatted text is unchanged since before the hint (the PR #177
  coderabbit finding: without the invalidation, the common "user taps before
  the first GPS fix, store idle" case left the hint on screen forever).
- Rapid re-hints cancel the previous restore timer — only the newest hint's
  timer fires.
- The cache sentinel is `''`; `formatStatus` never returns an empty string.
- Timers use the global `setTimeout`/`clearTimeout` (fake-timer friendly).

## Examples

```ts
const panel = createStatusPanel({
  statusEl: document.getElementById('status')!,
  getStatusText: () => formatStatus(currentStatusInput()),
});
store.subscribe(panel.refreshStatus);
panel.refreshStatus();
// On a tap before the first GPS fix:
panel.showHint('waiting for GPS…'); // restores the status 1.5 s later
```

## Tests

`status-panel.test.ts` — render + cache skip, hint show/restore with changed
AND unchanged status text (the stuck-hint regression), re-hint timer
cancellation, custom duration. Uses vitest fake timers; no DOM environment
needed (a plain `{ textContent }` object suffices).
