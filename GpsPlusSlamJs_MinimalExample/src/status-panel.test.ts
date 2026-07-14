import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusPanel, type StatusElementLike } from './status-panel.js';

// Why these tests matter: the status panel combines a DOM-write-skipping
// equality cache (quality-review F-12) with a transient hint that overwrites
// the same element. PR #177 review (coderabbit) found the interaction bug:
// `showHint` bypassed the cache, so the scheduled restore short-circuited on
// unchanged status text and the hint stuck forever. These tests pin both the
// cache behavior and the hint restore for the changed AND unchanged cases.

describe('createStatusPanel', () => {
  let statusEl: StatusElementLike;
  let statusText: string;

  beforeEach(() => {
    vi.useFakeTimers();
    statusEl = { textContent: null };
    statusText = 'recording: no\nGPS fixes: 0';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePanel(hintDurationMs?: number) {
    return createStatusPanel({
      statusEl,
      getStatusText: () => statusText,
      ...(hintDurationMs === undefined ? {} : { hintDurationMs }),
    });
  }

  it('renders the status text on refresh', () => {
    const panel = makePanel();
    panel.refreshStatus();
    expect(statusEl.textContent).toBe(statusText);
  });

  it('skips the DOM write when the status text is unchanged (F-12 cache)', () => {
    const panel = makePanel();
    panel.refreshStatus();
    // Simulate an out-of-band DOM change to observe whether refresh writes.
    statusEl.textContent = 'sentinel';
    panel.refreshStatus();
    expect(statusEl.textContent).toBe('sentinel');
  });

  it('shows a hint immediately and restores an UPDATED status after the delay', () => {
    const panel = makePanel();
    panel.refreshStatus();
    panel.showHint('waiting for GPS…');
    expect(statusEl.textContent).toBe('waiting for GPS…');

    statusText = 'recording: yes\nGPS fixes: 1';
    vi.advanceTimersByTime(1500);
    expect(statusEl.textContent).toBe(statusText);
  });

  it('restores an UNCHANGED status after the hint delay (the PR #177 stuck-hint bug)', () => {
    // The common real-world case: the user taps before the first GPS fix, the
    // "waiting for GPS…" hint shows, and nothing updates the store meanwhile —
    // the restore must still replace the hint even though the formatted status
    // text is identical to what was rendered before the hint.
    const panel = makePanel();
    panel.refreshStatus();
    panel.showHint('waiting for GPS…');

    vi.advanceTimersByTime(1500);
    expect(statusEl.textContent).toBe(statusText);
  });

  it('a rapid re-hint cancels the earlier restore timer', () => {
    const panel = makePanel();
    panel.refreshStatus();
    panel.showHint('first hint');
    vi.advanceTimersByTime(1000);
    panel.showHint('second hint');

    // 1000 + 600 passes the first timer's 1500 ms mark; only the second
    // hint's timer may restore, so the hint must still be visible here.
    vi.advanceTimersByTime(600);
    expect(statusEl.textContent).toBe('second hint');

    vi.advanceTimersByTime(900);
    expect(statusEl.textContent).toBe(statusText);
  });

  it('honours a custom hint duration', () => {
    const panel = makePanel(100);
    panel.refreshStatus();
    panel.showHint('hint');
    vi.advanceTimersByTime(99);
    expect(statusEl.textContent).toBe('hint');
    vi.advanceTimersByTime(1);
    expect(statusEl.textContent).toBe(statusText);
  });
});
