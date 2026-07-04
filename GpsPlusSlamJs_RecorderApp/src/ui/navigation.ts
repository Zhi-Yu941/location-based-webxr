/**
 * Navigation Module
 *
 * Manages browser history state for modal navigation, screen-level navigation,
 * and prevents accidental page exits during recording.
 *
 * Phase 1 handles the ref-point picker modal's back-button behavior and the
 * `beforeunload` warning during active recordings.
 *
 * Phase 2 adds screen-level history management so the browser back button
 * navigates between app screens (SETUP ↔ AR_READY ↔ RECORDING → SUMMARY)
 * instead of leaving the page.
 *
 * Purpose:
 * - Push a history entry when a modal opens so the browser back button closes
 *   the modal instead of leaving the page / ending the AR session.
 * - Push a history entry on screen transitions so back navigates between screens.
 * - Delegate back navigation during recording to a callback (confirm dialog).
 * - Warn users when they try to close the tab while recording (beforeunload).
 *
 * Public API:
 * - pushModalState(): push a history entry for the currently open modal
 * - popModalState(): programmatically pop the history entry (confirm/cancel)
 * - isModalStatePushed(): whether a modal history entry is active
 * - pushScreenState(screen): push a history entry for a screen transition
 * - replaceScreenState(screen): replace current history entry (terminal states)
 * - getCurrentScreen(): get the currently tracked screen
 * - initNavigation(callbacks, store): register popstate handler + set Redux store
 * - initModalNavigation(onCloseModal): legacy API (wraps initNavigation)
 * - enableBeforeUnloadWarning(): activate exit warning during recording
 * - disableBeforeUnloadWarning(): deactivate exit warning
 * - destroyNavigation(): tear down all handlers
 *
 * Invariants:
 * - pushModalState is idempotent (won't push twice if already pushed)
 * - popModalState is a no-op when no state was pushed (prevents double-pop on
 *   back-button path, where the browser already popped the entry)
 * - Programmatic history cleanup never re-enters screen-back logic: the
 *   popstate fired by popModalState()'s own history.back() is swallowed by a
 *   one-shot guard (F4, 2026-07-04 user feedback)
 * - popstate handler prioritizes modal close over screen navigation
 * - Back during recording delegates to onBackDuringRecording (fire-and-forget)
 * - Back from AR calls onBackToSetup; back from summary calls onBackFromSummary
 * - Back from setup is ignored (browser handles naturally)
 *
 * Tests: src/ui/navigation.test.ts
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  navigateTo,
  type AppScreen,
  type RoutingState,
} from '../state/routing-slice';

const log = createLogger('Navigation');

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal store interface for navigation — just routing state access.
 * Keeps navigation loosely coupled from the full RecorderStore.
 * Bug 2 fix (SPA audit): screen state lives in Redux, not a module variable.
 */
export interface NavigationStore {
  getState(): { routing: RoutingState };
  dispatch(action: { type: string; payload?: unknown }): void;
}

/**
 * Callbacks for the unified navigation handler.
 * `onCloseModal` handles the ref-point picker modal (Phase 1).
 * Screen callbacks handle back-button from each app screen (Phase 2).
 * `onBackDuringRecording` delegates recording-back handling to outside logic.
 */
export interface NavigationCallbacks {
  /** Close the currently open modal (e.g., ref-point picker). */
  onCloseModal: () => void;
  /** Back from AR_READY — return to SETUP screen (show setup modal). */
  onBackToSetup: () => void;
  /** Back from SUMMARY — trigger soft reset to SETUP. */
  onBackFromSummary: () => void;
  /**
   * Back during RECORDING — fire-and-forget async callback.
   * The callback is responsible for showing a confirmation dialog,
   * stopping the recording if confirmed, or re-pushing history state
   * if cancelled. Navigation does NOT re-push state itself.
   *
   * Issue 5 (2026-02-27 user feedback): Back button during recording
   * should show a confirmation dialog instead of silently consuming.
   */
  onBackDuringRecording: () => void;
}

// =============================================================================
// Module state
// =============================================================================

/** Whether a modal-related history entry is currently pushed */
let modalStatePushed = false;

/**
 * One-shot guard armed by `popModalState()` just before its `history.back()`.
 * That back() fires an ASYNC popstate; by the time it arrives,
 * `modalStatePushed` is already false, so without the guard the handler
 * misclassified the programmatic cleanup as a user back gesture and (during
 * recording) opened the "Stop recording?" confirm on every ref-point confirm.
 * F4 in docs/2026-07-04-ar-clipping-planes-and-lifecycle-user-feedback.md.
 *
 * Invariant: programmatic history cleanup never re-enters screen-back logic.
 * Known accepted edge: a real user back landing in the microsecond window
 * between popModalState() and its popstate delivery is swallowed (one ignored
 * back press — benign).
 */
let suppressNextPopstate = false;

/**
 * Store getter for reading/writing screen state via Redux.
 * Bug 2 fix: replaces the module-level `currentScreen` variable.
 * Bug 9 fix: changed from direct reference to getter to support store replacement.
 * Set by `initNavigation`, cleared by `destroyNavigation`.
 */
let navigationStoreGetter: (() => NavigationStore) | null = null;

/** Resolve the current store from the getter. */
function getNavigationStore(): NavigationStore | null {
  return navigationStoreGetter?.() ?? null;
}

/** Stored popstate handler for cleanup */
let popstateHandler: ((event: PopStateEvent) => void) | null = null;

/** Stored beforeunload handler for cleanup */
let beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;

/**
 * Push a history state entry for the currently open modal.
 * Idempotent — does nothing if already pushed.
 */
export function pushModalState(): void {
  if (modalStatePushed) {
    log.warn('Modal state already pushed, skipping duplicate push');
    return;
  }
  history.pushState({ modal: 'ref-point' }, '');
  modalStatePushed = true;
  log.info('Pushed modal history state');
}

/**
 * Pop the modal history entry by navigating back.
 * No-op if no modal state was pushed (e.g., back button already handled it).
 */
export function popModalState(): void {
  if (!modalStatePushed) {
    return;
  }
  modalStatePushed = false;
  suppressNextPopstate = true;
  history.back();
  log.info('Popped modal history state via history.back()');
}

/**
 * Check whether a modal history entry is currently active.
 */
export function isModalStatePushed(): boolean {
  return modalStatePushed;
}

/**
 * Register the popstate handler that fires `onCloseModal` when the user
 * presses the browser back button while a modal is open.
 *
 * Legacy API — wraps `initNavigation` with only the modal callback.
 * Prefer `initNavigation()` for new code.
 *
 * @param onCloseModal - callback invoked to close/cancel the modal
 */
export function initModalNavigation(onCloseModal: () => void): void {
  // Legacy API — creates a local routing store for modal-only use.
  // Screen navigation functions are no-ops in this mode.
  const localState: RoutingState = { currentScreen: 'setup' };
  const localStore: NavigationStore = {
    getState: () => ({ routing: localState }),
    dispatch: (action: { type: string; payload?: unknown }) => {
      if (action.type === 'routing/navigateTo') {
        localState.currentScreen = action.payload as AppScreen;
      }
    },
  };
  initNavigation(
    {
      onCloseModal,
      onBackToSetup: () => {},
      onBackFromSummary: () => {},
      onBackDuringRecording: () => {},
    },
    localStore
  );
}

// =============================================================================
// Phase 2: Screen-level navigation
// =============================================================================

/**
 * Push a history state entry for a screen transition.
 * Used when navigating forward (SETUP → AR, AR → RECORDING).
 * Dispatches to Redux store and pushes browser history state.
 */
export function pushScreenState(screen: AppScreen): void {
  const store = getNavigationStore();
  if (store) {
    store.dispatch(navigateTo(screen));
  }
  history.pushState({ screen }, '');
  log.info(`Pushed screen state: ${screen}`);
}

/**
 * Replace the current history entry with a new screen state.
 * Used for terminal states (RECORDING → SUMMARY) where back should not
 * return to the previous screen that no longer makes sense.
 * Dispatches to Redux store and replaces browser history state.
 */
export function replaceScreenState(screen: AppScreen): void {
  const store = getNavigationStore();
  if (store) {
    store.dispatch(navigateTo(screen));
  }
  history.replaceState({ screen }, '');
  log.info(`Replaced screen state: ${screen}`);
}

/**
 * Get the currently tracked app screen from the Redux store.
 * Returns 'setup' if no store is available (before initNavigation or after destroy).
 */
export function getCurrentScreen(): AppScreen {
  const store = getNavigationStore();
  if (!store) return 'setup';
  return store.getState().routing.currentScreen;
}

/**
 * Register the unified popstate handler that handles both modal close
 * (Phase 1) and screen-level back navigation (Phase 2).
 *
 * Priority order:
 * 1. Modal close (if a modal history entry is pushed)
 * 2. Screen-level back (based on currentScreen)
 *
 * Screen behaviors:
 * - `recording`: back delegates to `onBackDuringRecording` (fire-and-forget)
 * - `ar`: calls `onBackToSetup` and resets screen to `setup`
 * - `summary`: calls `onBackFromSummary`, cleans up history, resets to `setup`
 * - `setup`: ignored (browser handles naturally)
 */
export function initNavigation(
  callbacks: NavigationCallbacks,
  store: NavigationStore | (() => NavigationStore)
): void {
  // Remove previous handler to avoid accumulation
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
  }

  // Bug 9 fix: normalize to a getter so navigation always resolves the current store
  navigationStoreGetter = typeof store === 'function' ? store : () => store;

  popstateHandler = (_event: PopStateEvent) => {
    // Priority 0: swallow the self-induced popstate from popModalState()'s
    // history.back() — one-shot, see suppressNextPopstate above (F4).
    if (suppressNextPopstate) {
      suppressNextPopstate = false;
      log.info('Ignoring self-induced popstate from popModalState()');
      return;
    }

    // Priority 1: Modal close (Phase 1)
    if (modalStatePushed) {
      modalStatePushed = false;
      log.info('Back button detected — closing modal');
      callbacks.onCloseModal();
      return;
    }

    // Priority 2: Screen-level back (Phase 2)
    // Bug 2 fix: read from Redux store, not a module variable
    const currentStore = getNavigationStore();
    const leavingScreen =
      currentStore?.getState().routing.currentScreen ?? 'setup';

    if (leavingScreen === 'recording') {
      // Issue 5: Delegate to callback — it handles confirmation dialog,
      // stopping recording on confirm, or re-pushing state on cancel.
      // Fire-and-forget: the callback owns the async flow.
      log.info('Back during recording — delegating to onBackDuringRecording');
      callbacks.onBackDuringRecording();
      return;
    }

    if (leavingScreen === 'ar') {
      currentStore?.dispatch(navigateTo('setup'));
      log.info('Back from AR — returning to setup');
      callbacks.onBackToSetup();
      return;
    }

    if (leavingScreen === 'summary') {
      currentStore?.dispatch(navigateTo('setup'));
      // Clean up the AR history entry so the history stack is clean
      history.replaceState({ screen: 'setup' }, '');
      log.info('Back from summary — returning to setup');
      callbacks.onBackFromSummary();
      return;
    }

    // leavingScreen === 'setup' — nothing to do
  };

  window.addEventListener('popstate', popstateHandler);
  log.info('Navigation handler registered (modal + screen)');
}

/**
 * Enable `beforeunload` warning so the browser prompts the user before
 * leaving the page during an active recording.
 * Idempotent — safe to call multiple times.
 */
export function enableBeforeUnloadWarning(): void {
  if (beforeUnloadHandler) {
    return; // already enabled
  }

  beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Modern browsers ignore custom messages but require returnValue to be set
    event.returnValue =
      'Recording in progress. Are you sure you want to leave?';
  };

  window.addEventListener('beforeunload', beforeUnloadHandler);
  log.info('beforeunload warning enabled');
}

/**
 * Disable `beforeunload` warning (e.g., when recording stops).
 */
export function disableBeforeUnloadWarning(): void {
  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
    log.info('beforeunload warning disabled');
  }
}

/**
 * Full teardown — remove all navigation handlers and reset state.
 */
export function destroyNavigation(): void {
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
    popstateHandler = null;
  }
  disableBeforeUnloadWarning();
  modalStatePushed = false;
  suppressNextPopstate = false;
  // Reset screen state to setup before clearing store reference
  const store = getNavigationStore();
  if (store) {
    store.dispatch(navigateTo('setup'));
    navigationStoreGetter = null;
  }
}
