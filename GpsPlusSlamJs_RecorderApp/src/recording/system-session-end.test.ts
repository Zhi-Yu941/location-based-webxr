/**
 * Tests for the system-session-end handler (F3, 2026-07-04 user feedback).
 *
 * Why these tests matter:
 * On Android Chrome the system back gesture ends the immersive XRSession
 * directly — uncancelable, no popstate. The framework now runs full teardown
 * and notifies the app via initAR's `callbacks.onSessionEnd`. This handler is the app's
 * reaction: a single back gesture mid-recording must yield a clean,
 * explained exit (auto-stop + save + summary + toast) instead of the old
 * "haunted scene" (black camera, recording still running, stale history).
 * See docs/2026-07-04-ar-clipping-planes-and-lifecycle-plan.md (F3 app part).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSystemSessionEndHandler,
  SYSTEM_END_SAVED_TOAST,
  SYSTEM_END_INFO_TOAST,
  type SystemSessionEndDeps,
} from './system-session-end';
import type { AppScreen } from '../state/routing-slice';

function createDeps(
  screen: AppScreen,
  overrides: Partial<SystemSessionEndDeps> = {}
): SystemSessionEndDeps {
  return {
    getCurrentScreen: vi.fn(() => screen),
    stopRecording: vi.fn().mockResolvedValue(undefined),
    replaceScreen: vi.fn(),
    showSetupUi: vi.fn(),
    showToast: vi.fn(),
    showError: vi.fn(),
    ...overrides,
  };
}

describe('createSystemSessionEndHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('system end while recording → stop-and-save once + success toast, no extra navigation', async () => {
    // Why: stopRecording (handleStopRecording → performStop) already ends
    // with replaceScreenState('summary') + showSessionSummary — the handler
    // must NOT navigate or touch history a second time on this path, or a
    // follow-up back would misbehave.
    const deps = createDeps('recording');
    const handler = createSystemSessionEndHandler(deps);

    await handler({ requestedByApp: false });

    expect(deps.stopRecording).toHaveBeenCalledOnce();
    expect(deps.showToast).toHaveBeenCalledExactlyOnceWith(
      SYSTEM_END_SAVED_TOAST
    );
    expect(deps.replaceScreen).not.toHaveBeenCalled();
    expect(deps.showSetupUi).not.toHaveBeenCalled();
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('system end while in AR but not recording → back to setup with repaired history + info toast, no stop', async () => {
    // Why: the stale 'ar' history entry must be replaced so a follow-up back
    // does not resurrect a dead AR screen.
    const deps = createDeps('ar');
    const handler = createSystemSessionEndHandler(deps);

    await handler({ requestedByApp: false });

    expect(deps.stopRecording).not.toHaveBeenCalled();
    expect(deps.replaceScreen).toHaveBeenCalledExactlyOnceWith('setup');
    expect(deps.showSetupUi).toHaveBeenCalledOnce();
    expect(deps.showToast).toHaveBeenCalledExactlyOnceWith(
      SYSTEM_END_INFO_TOAST
    );
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('requestedByApp end → complete no-op (explicit-stop flows already handle everything)', async () => {
    const deps = createDeps('recording');
    const handler = createSystemSessionEndHandler(deps);

    await handler({ requestedByApp: true });

    expect(deps.stopRecording).not.toHaveBeenCalled();
    expect(deps.replaceScreen).not.toHaveBeenCalled();
    expect(deps.showSetupUi).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.showError).not.toHaveBeenCalled();
  });

  it('save failure → error surfaces via showError, app still leaves the broken state, no "saved" toast lies', async () => {
    // Why (async-UI-feedback rule): the final state must reflect the durable
    // end state. If the save failed the user must see the error AND still
    // land somewhere sane (setup), never a success toast.
    const deps = createDeps('recording', {
      stopRecording: vi.fn().mockRejectedValue(new Error('OPFS write failed')),
    });
    const handler = createSystemSessionEndHandler(deps);

    await handler({ requestedByApp: false });

    expect(deps.showError).toHaveBeenCalledOnce();
    expect(String(vi.mocked(deps.showError).mock.calls[0]?.[0])).toContain(
      'OPFS write failed'
    );
    expect(deps.showToast).not.toHaveBeenCalled();
    // performStop's tail (replaceScreenState('summary')) never ran — the
    // handler itself must repair history and leave the dead AR state.
    expect(deps.replaceScreen).toHaveBeenCalledExactlyOnceWith('setup');
    expect(deps.showSetupUi).toHaveBeenCalledOnce();
  });

  it('system end on setup/summary screens → no-op (nothing AR-bound left to clean up)', async () => {
    for (const screen of ['setup', 'summary'] as const) {
      const deps = createDeps(screen);
      const handler = createSystemSessionEndHandler(deps);

      await handler({ requestedByApp: false });

      expect(deps.stopRecording).not.toHaveBeenCalled();
      expect(deps.replaceScreen).not.toHaveBeenCalled();
      expect(deps.showSetupUi).not.toHaveBeenCalled();
      expect(deps.showToast).not.toHaveBeenCalled();
      expect(deps.showError).not.toHaveBeenCalled();
    }
  });
});
