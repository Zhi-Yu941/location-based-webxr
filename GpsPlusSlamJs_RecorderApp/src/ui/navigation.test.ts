/**
 * Navigation Module Tests
 *
 * Tests for browser history-based navigation handling.
 * The navigation module manages back-button behavior for modals
 * and prevents accidental page exits during recording.
 *
 * Why these tests matter:
 * - Back button on mobile must close modals, not exit the AR session
 * - beforeunload prevents data loss during active recordings
 * - History state push/pop must be coordinated to avoid double-navigation
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pushModalState,
  popModalState,
  isModalStatePushed,
  initModalNavigation,
  enableBeforeUnloadWarning,
  disableBeforeUnloadWarning,
  destroyNavigation,
  pushScreenState,
  replaceScreenState,
  getCurrentScreen,
  initNavigation,
  type NavigationCallbacks,
  type NavigationStore,
} from './navigation';
import { routingReducer, type AppScreen } from '../state/routing-slice';

describe('Navigation Module', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushStateSpy = vi.spyOn(history, 'pushState');
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {
      // jsdom doesn't fire popstate from history.back(), so we just mock it
    });
    destroyNavigation();
  });

  afterEach(() => {
    destroyNavigation();
    vi.restoreAllMocks();
  });

  describe('pushModalState', () => {
    it('should push a history state entry with modal identifier', () => {
      // Why: pushing state enables the browser back button to close the modal
      pushModalState();

      expect(pushStateSpy).toHaveBeenCalledExactlyOnceWith(
        { modal: 'ref-point' },
        ''
      );
    });

    it('should mark modal state as pushed', () => {
      // Why: the flag prevents double-pop and coordinates back vs programmatic close
      expect(isModalStatePushed()).toBe(false);
      pushModalState();
      expect(isModalStatePushed()).toBe(true);
    });

    it('should not push duplicate state if already pushed', () => {
      // Why: opening the same modal twice should not create stacked history entries
      pushModalState();
      pushModalState();

      expect(pushStateSpy).toHaveBeenCalledOnce();
    });
  });

  describe('popModalState', () => {
    it('should call history.back() when modal state was pushed', () => {
      // Why: programmatic close (confirm/cancel) needs to clean up the history entry
      pushModalState();
      popModalState();

      expect(backSpy).toHaveBeenCalledOnce();
    });

    it('should reset the pushed flag after pop', () => {
      pushModalState();
      popModalState();

      expect(isModalStatePushed()).toBe(false);
    });

    it('should be a no-op when no state was pushed', () => {
      // Why: back-button close already popped the state; programmatic close must not double-pop
      popModalState();

      expect(backSpy).not.toHaveBeenCalled();
    });

    it('should be a no-op on second call after push', () => {
      // Why: prevents duplicate history.back() calls
      pushModalState();
      popModalState();
      popModalState();

      expect(backSpy).toHaveBeenCalledOnce();
    });
  });

  describe('initModalNavigation (popstate handling)', () => {
    it('should call onCloseModal when popstate fires while modal state is pushed', () => {
      // Why: browser back button should close the modal instead of exiting the page
      const onClose = vi.fn();
      initModalNavigation(onClose);
      pushModalState();

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it('should reset modal pushed flag when popstate fires', () => {
      // Why: prevents popModalState from calling history.back() after back-button already popped
      const onClose = vi.fn();
      initModalNavigation(onClose);
      pushModalState();

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(isModalStatePushed()).toBe(false);
    });

    it('should not call onCloseModal when popstate fires without pushed state', () => {
      // Why: unrelated popstate events (e.g., from history.back() cleanup) should be ignored
      const onClose = vi.fn();
      initModalNavigation(onClose);

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should not call onCloseModal after modal was programmatically closed', () => {
      // Why: confirm/cancel close calls popModalState + history.back();
      // the resulting popstate must be a no-op since the flag is already cleared
      const onClose = vi.fn();
      initModalNavigation(onClose);
      pushModalState();
      popModalState(); // simulates programmatic close

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should replace previous handler when called multiple times', () => {
      // Why: re-initialization should not accumulate duplicate handlers
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();

      initModalNavigation(onClose1);
      initModalNavigation(onClose2);
      pushModalState();

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(onClose1).not.toHaveBeenCalled();
      expect(onClose2).toHaveBeenCalledOnce();
    });
  });

  describe('enableBeforeUnloadWarning', () => {
    it('should prevent page unload when enabled', () => {
      // Why: active recording must not be accidentally lost by closing the tab/navigating away
      enableBeforeUnloadWarning();

      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('should not double-register when called twice', () => {
      // Why: multiple enable calls should be idempotent
      const addSpy = vi.spyOn(window, 'addEventListener');
      enableBeforeUnloadWarning();
      enableBeforeUnloadWarning();

      const beforeUnloadCalls = addSpy.mock.calls.filter(
        ([type]) => type === 'beforeunload'
      );
      expect(beforeUnloadCalls).toHaveLength(1);

      addSpy.mockRestore();
    });
  });

  describe('disableBeforeUnloadWarning', () => {
    it('should allow page unload after disabling', () => {
      // Why: once recording stops, normal navigation should work
      enableBeforeUnloadWarning();
      disableBeforeUnloadWarning();

      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should be a no-op when not enabled', () => {
      // Why: calling disable without enable should not throw
      expect(() => disableBeforeUnloadWarning()).not.toThrow();
    });
  });

  describe('destroyNavigation', () => {
    it('should clean up all handlers and state', () => {
      // Why: full teardown prevents memory leaks and stale handlers
      const onClose = vi.fn();
      initModalNavigation(onClose);
      enableBeforeUnloadWarning();
      pushModalState();

      destroyNavigation();

      // Modal state reset
      expect(isModalStatePushed()).toBe(false);

      // Popstate handler removed — back button should not trigger callback
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      expect(onClose).not.toHaveBeenCalled();

      // Beforeunload handler removed
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

// =============================================================================
// Phase 2: Screen-level navigation (Issue 7 Phase 2)
// =============================================================================

/**
 * Create a minimal store for navigation tests.
 * Uses the real routing reducer to track state, avoiding mocking internals.
 */
function createTestStore(): NavigationStore {
  let state = routingReducer(undefined, { type: '@@INIT' });
  return {
    getState: () => ({ routing: state }),
    dispatch: (action: { type: string; payload?: unknown }) => {
      state = routingReducer(state, action);
    },
  };
}

describe('Screen Navigation (Phase 2)', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;
  let store: NavigationStore;

  beforeEach(() => {
    pushStateSpy = vi.spyOn(history, 'pushState');
    replaceStateSpy = vi.spyOn(history, 'replaceState');
    vi.spyOn(history, 'back').mockImplementation(() => {
      // jsdom doesn't fire popstate from history.back()
    });
    destroyNavigation();
    store = createTestStore();
    // Initialize with no-op callbacks so pushScreenState/replaceScreenState
    // have a store reference. Tests that need specific callbacks override via
    // a second initNavigation call.
    initNavigation(
      {
        onCloseModal: () => {},
        onBackToSetup: () => {},
        onBackFromSummary: () => {},
        onBackDuringRecording: () => {},
      },
      store
    );
  });

  afterEach(() => {
    destroyNavigation();
    vi.restoreAllMocks();
  });

  describe('pushScreenState', () => {
    // Why: entering AR and starting recording must create history entries
    // so the browser back button can navigate between screens.
    it('should push a history state entry with the screen identifier', () => {
      pushScreenState('ar');

      expect(pushStateSpy).toHaveBeenCalledWith({ screen: 'ar' }, '');
    });

    it('should update getCurrentScreen to the pushed screen', () => {
      expect(getCurrentScreen()).toBe('setup');
      pushScreenState('ar');
      expect(getCurrentScreen()).toBe('ar');
    });

    it('should allow pushing successive screens', () => {
      pushScreenState('ar');
      pushScreenState('recording');

      expect(getCurrentScreen()).toBe('recording');
      expect(pushStateSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('replaceScreenState', () => {
    // Why: summary is a terminal state — it should replace the recording
    // entry so back from summary doesn't go to recording (which is over).
    it('should replace history state instead of pushing', () => {
      pushScreenState('recording');
      replaceScreenState('summary');

      expect(replaceStateSpy).toHaveBeenCalledWith({ screen: 'summary' }, '');
    });

    it('should update getCurrentScreen to the replaced screen', () => {
      pushScreenState('recording');
      replaceScreenState('summary');

      expect(getCurrentScreen()).toBe('summary');
    });
  });

  describe('getCurrentScreen', () => {
    // Why: the popstate handler uses this to determine what screen the user
    // is leaving (not where they're going) to decide the correct action.
    it('should default to setup', () => {
      expect(getCurrentScreen()).toBe('setup');
    });

    it('should reflect the most recently set screen', () => {
      pushScreenState('ar');
      expect(getCurrentScreen()).toBe('ar');
      pushScreenState('recording');
      expect(getCurrentScreen()).toBe('recording');
      replaceScreenState('summary');
      expect(getCurrentScreen()).toBe('summary');
    });
  });

  describe('initNavigation (screen-level popstate handling)', () => {
    function createCallbacks(): NavigationCallbacks {
      return {
        onCloseModal: vi.fn(),
        onBackToSetup: vi.fn(),
        onBackFromSummary: vi.fn(),
        onBackDuringRecording: vi.fn(),
      };
    }

    // Why: pressing back from AR_READY should return to the setup screen
    // so the user can adjust settings, not exit the page.
    it('should call onBackToSetup when back is pressed from AR screen', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('ar');

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onBackToSetup).toHaveBeenCalledOnce();
      expect(getCurrentScreen()).toBe('setup');
    });

    // Why: back during recording must delegate to the callback so the app
    // can show a confirmation dialog. Navigation no longer silently re-pushes.
    // Issue 5 (2026-02-27 user feedback).
    it('should call onBackDuringRecording when back is pressed during recording', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('ar');
      pushScreenState('recording');

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      // Callback is called (fire-and-forget)
      expect(cbs.onBackDuringRecording).toHaveBeenCalledOnce();
      // Screen stays recording (callback manages transitions)
      expect(getCurrentScreen()).toBe('recording');
      // No other callbacks should fire
      expect(cbs.onBackToSetup).not.toHaveBeenCalled();
      expect(cbs.onBackFromSummary).not.toHaveBeenCalled();
    });

    // Why: navigation no longer re-pushes state itself for recording.
    // The callback is responsible for re-pushing if the user cancels.
    it('should NOT re-push recording state (callback is responsible)', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('ar');
      pushScreenState('recording');

      (pushStateSpy as unknown as { mockClear(): void }).mockClear();
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      // Navigation does NOT re-push — that's the callback's job
      expect(pushStateSpy).not.toHaveBeenCalled();
    });

    // Why: from the summary screen, back should trigger the soft reset
    // flow that returns to setup while preserving read folder handles.
    it('should call onBackFromSummary when back is pressed from summary', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('ar');
      pushScreenState('recording');
      replaceScreenState('summary');

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onBackFromSummary).toHaveBeenCalledOnce();
      expect(getCurrentScreen()).toBe('setup');
    });

    // Why: modal close (Phase 1) must take priority over screen back
    // when the ref point picker is open during recording.
    it('should prioritize modal close over screen back', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('recording');
      pushModalState();

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      // Modal was closed, not the screen
      expect(cbs.onCloseModal).toHaveBeenCalledOnce();
      expect(isModalStatePushed()).toBe(false);
      // Screen should still be recording
      expect(getCurrentScreen()).toBe('recording');
    });

    // Why: after modal is closed via back, the next back press during
    // recording should delegate to onBackDuringRecording.
    it('should delegate recording back after modal was closed via back', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('recording');
      pushModalState();

      // First back — closes modal
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      expect(cbs.onCloseModal).toHaveBeenCalledOnce();

      // Second back — should delegate to onBackDuringRecording
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      expect(cbs.onBackDuringRecording).toHaveBeenCalledOnce();
      expect(getCurrentScreen()).toBe('recording');
    });

    // Why: popstate from setup screen (initial state) should be ignored —
    // the browser handles the navigation naturally.
    it('should not call any callback when back is pressed from setup', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      // currentScreen is 'setup' (default)

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onBackToSetup).not.toHaveBeenCalled();
      expect(cbs.onBackFromSummary).not.toHaveBeenCalled();
      expect(cbs.onCloseModal).not.toHaveBeenCalled();
    });

    // Why: summary back should clean up the AR history entry so the
    // history stack is clean after returning to setup.
    it('should replaceState with setup when going back from summary', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('ar');
      pushScreenState('recording');
      replaceScreenState('summary');

      (replaceStateSpy as unknown as { mockClear(): void }).mockClear();
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(replaceStateSpy).toHaveBeenCalledWith({ screen: 'setup' }, '');
    });
  });

  describe('initNavigation backward compatibility', () => {
    // Why: initNavigation replaces initModalNavigation. Ensure modal-only
    // callers still work correctly.
    it('should still support modal close callback from initNavigation', () => {
      const cbs: NavigationCallbacks = {
        onCloseModal: vi.fn(),
        onBackToSetup: vi.fn(),
        onBackFromSummary: vi.fn(),
        onBackDuringRecording: vi.fn(),
      };
      initNavigation(cbs, store);
      pushModalState();

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onCloseModal).toHaveBeenCalledOnce();
    });
  });

  describe('destroyNavigation (Phase 2 cleanup)', () => {
    // Why: full teardown must also reset screen state to prevent stale
    // screen references in subsequent tests or app re-initialization.
    it('should reset screen state to setup on destroy', () => {
      pushScreenState('recording');
      expect(getCurrentScreen()).toBe('recording');

      destroyNavigation();

      expect(getCurrentScreen()).toBe('setup');
    });

    it('should remove screen-level popstate handler', () => {
      const cbs: NavigationCallbacks = {
        onCloseModal: vi.fn(),
        onBackToSetup: vi.fn(),
        onBackFromSummary: vi.fn(),
        onBackDuringRecording: vi.fn(),
      };
      initNavigation(cbs, store);
      pushScreenState('ar');
      destroyNavigation();

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onBackToSetup).not.toHaveBeenCalled();
    });
  });

  describe('Bug 2 regression: Redux is the source of truth for currentScreen', () => {
    // Why: Bug 2 (SPA audit) — currentScreen was a module-level variable
    // disconnected from Redux, causing desync on rapid transitions and
    // preventing time-travel debugging. After the fix, the Redux store
    // must be the single source of truth.

    it('should reflect screen state in the store after pushScreenState', () => {
      pushScreenState('ar');
      expect(store.getState().routing.currentScreen).toBe('ar');
    });

    it('should reflect screen state in the store after replaceScreenState', () => {
      pushScreenState('recording');
      replaceScreenState('summary');
      expect(store.getState().routing.currentScreen).toBe('summary');
    });

    it('should read getCurrentScreen from the store, not a closure variable', () => {
      // Why: if getCurrentScreen reads from a closure, a stale reference
      // could desync from the Redux store during rapid transitions.
      pushScreenState('ar');
      pushScreenState('recording');
      replaceScreenState('summary');
      replaceScreenState('setup');

      // Verify store and getCurrentScreen agree
      expect(getCurrentScreen()).toBe(store.getState().routing.currentScreen);
      expect(getCurrentScreen()).toBe('setup');
    });

    it('should keep store and getCurrentScreen in sync after rapid transitions', () => {
      // Why: the original Bug 2 — rapid back-button presses during
      // recording→summary→setup could cause desync between the module
      // variable and the actual app state.
      const screens: AppScreen[] = ['ar', 'recording', 'summary', 'setup'];
      for (const screen of screens) {
        pushScreenState(screen);
        expect(getCurrentScreen()).toBe(screen);
        expect(store.getState().routing.currentScreen).toBe(screen);
      }
    });

    it('should reset store to setup on destroyNavigation', () => {
      pushScreenState('recording');
      destroyNavigation();
      // After destroy, getCurrentScreen defaults to 'setup'
      expect(getCurrentScreen()).toBe('setup');
    });
  });

  describe('F4 regression: programmatic popModalState must not trigger screen-back', () => {
    // Why these tests matter: confirming the ref-point name dialog calls
    // popModalState(), whose history.back() fires an ASYNC popstate. By the
    // time it arrives, modalStatePushed is already false, so the handler used
    // to fall through to the screen branch and open the "Stop recording?"
    // confirm on every ref-point confirm (F4 in
    // docs/2026-07-04-ar-clipping-planes-and-lifecycle-user-feedback.md).
    // popModalState() must arm a one-shot guard that swallows exactly that
    // self-induced popstate — and nothing else.

    function createCallbacks(): NavigationCallbacks {
      return {
        onCloseModal: vi.fn(),
        onBackToSetup: vi.fn(),
        onBackFromSummary: vi.fn(),
        onBackDuringRecording: vi.fn(),
      };
    }

    it('swallows the self-induced popstate after popModalState during recording (bug repro)', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('ar');
      pushScreenState('recording');
      pushModalState(); // picker opens
      popModalState(); // picker Confirm/Cancel button → programmatic close

      // The async popstate that history.back() triggers arrives later:
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      // Neither the screen branch (the bug) nor the modal branch (the caller
      // already closed the modal) may fire.
      expect(cbs.onBackDuringRecording).not.toHaveBeenCalled();
      expect(cbs.onCloseModal).not.toHaveBeenCalled();
      expect(getCurrentScreen()).toBe('recording');
    });

    it('guard is one-shot: a subsequent user back during recording still delegates', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('recording');
      pushModalState();
      popModalState();

      // Self-induced popstate — swallowed.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      // Real user back gesture afterwards — must reach the screen branch.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onBackDuringRecording).toHaveBeenCalledOnce();
    });

    it('user back gesture with modal open (no popModalState) still closes the modal', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('recording');
      pushModalState();

      // Browser back — the guard must NOT be armed on this path.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onCloseModal).toHaveBeenCalledOnce();
      expect(cbs.onBackDuringRecording).not.toHaveBeenCalled();
    });

    it('popModalState with nothing pushed arms no guard: next back still delegates', () => {
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('recording');
      popModalState(); // no-op — nothing was pushed

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs.onBackDuringRecording).toHaveBeenCalledOnce();
    });

    it('destroyNavigation clears a pending guard so a re-init does not swallow a real back', () => {
      // Why: if the one-shot guard survived teardown (e.g. popModalState's
      // popstate never arrived before destroy), the first genuine back press
      // after re-initialization would be silently ignored.
      const cbs = createCallbacks();
      initNavigation(cbs, store);
      pushScreenState('recording');
      pushModalState();
      popModalState(); // guard armed, popstate never delivered

      destroyNavigation();
      const store2 = createTestStore();
      const cbs2 = createCallbacks();
      initNavigation(cbs2, store2);
      pushScreenState('recording');

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(cbs2.onBackDuringRecording).toHaveBeenCalledOnce();
    });
  });

  describe('Bug 9 regression: navigation must follow store replacement', () => {
    // Why: navigation.ts stored a direct store reference from initNavigation.
    // When main.ts replaced the store on soft reset (store = createNewStore()),
    // navigation kept dispatching to the OLD store, causing routing state to
    // diverge. The fix is to accept a getter function so navigation always
    // reads/writes the current store.

    it('should dispatch to the current store when initialized with a getter', () => {
      // Why: after a soft reset, the store is replaced. Navigation must dispatch
      // to the new store, not the original one.
      let currentStore = createTestStore();
      const storeGetter = () => currentStore;

      initNavigation(
        {
          onCloseModal: () => {},
          onBackToSetup: () => {},
          onBackFromSummary: () => {},
          onBackDuringRecording: () => {},
        },
        storeGetter
      );

      pushScreenState('ar');
      expect(currentStore.getState().routing.currentScreen).toBe('ar');

      // Simulate soft reset: replace the store
      const storeA = currentStore;
      currentStore = createTestStore();
      expect(currentStore.getState().routing.currentScreen).toBe('setup');

      // Navigation should now dispatch to the NEW store
      pushScreenState('recording');
      expect(currentStore.getState().routing.currentScreen).toBe('recording');

      // Old store should still show 'ar' — it was NOT touched by the second push
      expect(storeA.getState().routing.currentScreen).toBe('ar');
    });

    it('should read getCurrentScreen from the current store via getter', () => {
      // Why: getCurrentScreen must return the state from whichever store is
      // currently active, not from a stale captured reference.
      let currentStore = createTestStore();
      const storeGetter = () => currentStore;

      initNavigation(
        {
          onCloseModal: () => {},
          onBackToSetup: () => {},
          onBackFromSummary: () => {},
          onBackDuringRecording: () => {},
        },
        storeGetter
      );

      pushScreenState('recording');
      expect(getCurrentScreen()).toBe('recording');

      // Replace the store — simulates soft reset
      currentStore = createTestStore();
      // New store defaults to 'setup'
      expect(getCurrentScreen()).toBe('setup');
    });

    it('should still accept a direct store reference for backward compat', () => {
      // Why: existing callers (tests, initModalNavigation) pass a store directly.
      // The overloaded signature must handle both cases.
      const directStore = createTestStore();
      initNavigation(
        {
          onCloseModal: () => {},
          onBackToSetup: () => {},
          onBackFromSummary: () => {},
          onBackDuringRecording: () => {},
        },
        directStore
      );

      pushScreenState('ar');
      expect(directStore.getState().routing.currentScreen).toBe('ar');
      expect(getCurrentScreen()).toBe('ar');
    });
  });
});
