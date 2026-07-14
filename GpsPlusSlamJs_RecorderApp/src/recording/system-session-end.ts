/**
 * System-Session-End Handler (F3, 2026-07-04 user feedback)
 *
 * The app's reaction to the framework's session-end callback
 * (initAR `callbacks.onSessionEnd` in gps-plus-slam-app-framework). On Android
 * Chrome the system back gesture ends an immersive XRSession directly —
 * uncancelable, no popstate, no beforeunload — so no dialog can be shown
 * beforehand. The framework tears the AR view down; this handler makes the
 * app land somewhere sane:
 *
 * - System end while RECORDING → auto-stop + save via the injected
 *   `stopRecording` (the regular stop flow — it already repairs history via
 *   `replaceScreenState('summary')` and shows the summary), then a toast
 *   naming what happened. On save failure: error surfaces via `showError`,
 *   the app still leaves the dead AR state (→ setup).
 * - System end while in AR but NOT recording → back to setup with the stale
 *   `ar` history entry replaced, plus an informational toast.
 * - App-initiated end (`requestedByApp: true`) → complete no-op; the
 *   explicit-stop flows already handle everything.
 *
 * Dependencies are injected so the module is unit-testable without the DOM
 * heavy main.ts wiring. See
 * docs/2026-07-04-1626-ar-clipping-planes-and-lifecycle-plan.md (F3 app part).
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { SessionEndInfo } from 'gps-plus-slam-app-framework/ar/webxr-session';
import type { AppScreen } from '../state/routing-slice';

const log = createLogger('SystemSessionEnd');

/** Toast after a successful auto-stop (decided in the F3 interview). */
export const SYSTEM_END_SAVED_TOAST =
  'AR session ended by the system — recording saved';

/** Toast when the session ended while no recording was running. */
export const SYSTEM_END_INFO_TOAST = 'AR session ended by the system';

/** Injected collaborators — all thin wrappers over existing app functions. */
export interface SystemSessionEndDeps {
  /** Current app screen (routing slice via navigation). */
  getCurrentScreen(): AppScreen;
  /**
   * The regular stop flow (`recordingSessionHandlers.handleStopRecording`).
   * On success it already persists the data, replaces the `recording`
   * history entry with `summary`, and shows the summary screen.
   */
  stopRecording(): Promise<void>;
  /** `replaceScreenState` — repair the history stack without pushing. */
  replaceScreen(screen: AppScreen): void;
  /** Show the setup UI (`showSetupModal`). */
  showSetupUi(): void;
  /** Success/info toast channel. */
  showToast(message: string): void;
  /** Error channel (`showError`). */
  showError(message: string): void;
}

/**
 * Create the callback to pass to the framework via initAR's
 * `callbacks.onSessionEnd`. Returns a promise so tests can await the async
 * work; the framework treats the callback as fire-and-forget and all
 * rejections are handled internally.
 */
export function createSystemSessionEndHandler(
  deps: SystemSessionEndDeps
): (info: SessionEndInfo) => Promise<void> {
  return async (info: SessionEndInfo): Promise<void> => {
    if (info.requestedByApp) {
      // Explicit endARSession() flows (stop recording, init-failure cleanup)
      // own their own UI/navigation — nothing to do here.
      return;
    }

    const screen = deps.getCurrentScreen();
    log.warn(`XR session ended by the system while on screen '${screen}'`);

    if (screen === 'recording') {
      try {
        // The regular stop flow: persists data, replaces the stale
        // `recording` history entry with `summary`, shows the summary.
        // No extra navigation here — doing it twice would corrupt history.
        await deps.stopRecording();
        deps.showToast(SYSTEM_END_SAVED_TOAST);
      } catch (err) {
        // Durable end state failed — never show a "saved" toast. Surface the
        // error and still leave the dead AR state so the user is not stuck
        // on a recording screen whose session no longer exists.
        log.error('Auto-stop after system session end failed:', err);
        deps.showError(
          `AR session ended by the system, but saving the recording failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        deps.replaceScreen('setup');
        deps.showSetupUi();
      }
      return;
    }

    if (screen === 'ar') {
      // AR_READY, nothing recorded: repair the stale `ar` history entry and
      // return to setup.
      deps.replaceScreen('setup');
      deps.showSetupUi();
      deps.showToast(SYSTEM_END_INFO_TOAST);
      return;
    }

    // setup/summary: no AR-bound UI state left to clean up. The framework
    // already tore the session down; a toast here would only confuse.
  };
}
