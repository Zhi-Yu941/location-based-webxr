/**
 * Status-panel controller for the minimal example: owns the single `<pre>`
 * status element, skipping redundant DOM writes and flashing transient hints.
 *
 * Extracted from the `main()` closure (PR #177 review) so the interaction
 * between the write-skipping cache and the transient hint is unit-testable:
 * `showHint` overwrites the DOM directly, so it must also invalidate the
 * cache — otherwise the scheduled restore short-circuits on unchanged status
 * text and the hint sticks forever.
 */

/** Minimal element surface the panel writes to (a `<pre>` in the real app). */
export interface StatusElementLike {
  textContent: string | null;
}

export interface StatusPanelDeps {
  /** The status element; the panel is its only writer. */
  readonly statusEl: StatusElementLike;
  /** Returns the current formatted status text (e.g. via `formatStatus`). */
  readonly getStatusText: () => string;
  /** How long a hint stays before the status is restored. Default 1500 ms. */
  readonly hintDurationMs?: number;
}

export interface StatusPanel {
  /** Re-render the status text; skips the DOM write when unchanged. */
  refreshStatus(): void;
  /** Flash a transient hint, then restore the status after the delay. */
  showHint(message: string): void;
}

export function createStatusPanel(deps: StatusPanelDeps): StatusPanel {
  const hintDurationMs = deps.hintDurationMs ?? 1500;

  // Skip the DOM write when the rendered text is unchanged (quality-review
  // F-12) — the store subscriber fires per action.
  let lastStatusText = '';
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function refreshStatus(): void {
    const text = deps.getStatusText();
    if (text === lastStatusText) return;
    lastStatusText = text;
    deps.statusEl.textContent = text;
  }

  function showHint(message: string): void {
    deps.statusEl.textContent = message;
    // The DOM no longer shows the last formatted status, so invalidate the
    // cache — otherwise the scheduled restore short-circuits on unchanged
    // status text and the hint sticks forever (PR #177 review).
    lastStatusText = '';
    if (hintTimer !== undefined) {
      clearTimeout(hintTimer);
    }
    hintTimer = setTimeout(refreshStatus, hintDurationMs);
  }

  return { refreshStatus, showHint };
}
