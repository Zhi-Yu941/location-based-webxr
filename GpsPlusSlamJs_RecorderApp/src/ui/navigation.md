# Navigation Module

**Purpose:** Manages browser history state for modal back-button handling, screen-level back navigation, and prevents accidental page exits during active recordings. Phase 1 covers the ref-point picker modal and the `beforeunload` warning. Phase 2 adds screen-level navigation (SETUP ↔ AR ↔ RECORDING → SUMMARY) so the browser back button navigates between app screens instead of leaving the page.

## Public API

### Types

| Type                  | Description                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AppScreen`           | `'setup' \| 'ar' \| 'recording' \| 'summary'` — the app's screen states.                                      |
| `NavigationCallbacks` | `{ onCloseModal, onBackToSetup, onBackFromSummary, onBackDuringRecording }` — callbacks for popstate routing. |

### Functions

| Function                     | Signature                                  | Description                                                                           |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `pushModalState`             | `() => void`                               | Push a history entry for the open modal. Idempotent.                                  |
| `popModalState`              | `() => void`                               | Pop the modal history entry via `history.back()`. No-op if not pushed.                |
| `isModalStatePushed`         | `() => boolean`                            | Whether a modal history entry is currently active.                                    |
| `pushScreenState`            | `(screen: AppScreen) => void`              | Push a history entry for a screen transition (e.g., entering AR, starting recording). |
| `replaceScreenState`         | `(screen: AppScreen) => void`              | Replace current history entry (e.g., recording → summary terminal transition).        |
| `getCurrentScreen`           | `() => AppScreen`                          | Get the currently tracked app screen (defaults to `'setup'`).                         |
| `initNavigation`             | `(callbacks: NavigationCallbacks) => void` | Register unified popstate handler for modals + screens.                               |
| `initModalNavigation`        | `(onCloseModal: () => void) => void`       | Legacy API — wraps `initNavigation` with only the modal callback.                     |
| `enableBeforeUnloadWarning`  | `() => void`                               | Show browser confirmation when the user tries to close the tab.                       |
| `disableBeforeUnloadWarning` | `() => void`                               | Remove the `beforeunload` handler.                                                    |
| `destroyNavigation`          | `() => void`                               | Full teardown — remove all handlers and reset state (including screen).               |

## Invariants & Assumptions

- **Modal priority:** The popstate handler always checks for an open modal first. If a modal history entry is pushed, `onCloseModal` fires before any screen-level handling.
- **Idempotent push:** `pushModalState()` won't push if already pushed, preventing stacked history entries.
- **No-op pop:** `popModalState()` is a no-op when the flag is `false`. This is critical for the back-button path where the browser already popped the entry before `onCloseModal` runs.
- **Double-fire safety:** When the user presses back, `popstate` fires → flag is cleared → `onCloseModal()` → `resolveWith(null)` → `popModalState()` is a no-op. When the user clicks confirm/cancel, `resolveWith(result)` → `popModalState()` arms a one-shot `suppressNextPopstate` guard → `history.back()` fires `popstate` → the handler consumes the guard and returns without touching modal OR screen logic. (Before F4, 2026-07-04, the handler only skipped the modal branch and fell through to the screen branch — during recording that opened the "Stop recording?" confirm on every ref-point confirm. Accepted edge: a real user back landing between `popModalState()` and its popstate delivery is swallowed — one ignored press, benign.)
- **Recording delegation:** Back during recording delegates to `onBackDuringRecording` (fire-and-forget). The callback is responsible for showing a confirmation dialog, stopping recording if confirmed, or re-pushing the history state if cancelled. Navigation does NOT re-push state itself.
- **Summary cleanup:** Back from summary replaces the history entry with `setup` to keep the history stack clean after soft reset.
- **Default screen:** `getCurrentScreen()` returns `'setup'` until explicitly changed.

## Screen Transition Map

```
User Action            | Navigation Call                  | History Effect
-----------------------|----------------------------------|----------------------------
Enter AR               | pushScreenState('ar')            | Push {screen: 'ar'}
Start Recording        | pushScreenState('recording')     | Push {screen: 'recording'}
Stop Recording         | replaceScreenState('summary')    | Replace with {screen: 'summary'}
Soft Reset (New Rec.)  | replaceScreenState('setup')      | Replace with {screen: 'setup'}
Back from AR           | (popstate handler)               | → onBackToSetup → showSetupModal()
Back during Recording  | (popstate handler)               | → onBackDuringRecording (confirm dialog)
Back from Summary      | (popstate handler)               | → onBackFromSummary → soft reset
Open ref-point picker  | pushModalState()                 | Push {modal: 'ref-point'}
Close picker (confirm) | popModalState()                  | Pop via history.back()
Back while picker open | (popstate handler)               | → onCloseModal → cancelPicker
```

## Example Usage

```typescript
import {
  initNavigation,
  pushScreenState,
  replaceScreenState,
  enableBeforeUnloadWarning,
  disableBeforeUnloadWarning,
} from './navigation';
import {
  cancelRefPointPicker,
  isRefPointPickerVisible,
} from './ref-point-picker';
import { showSetupModal } from './hud';

// On app init — register back-button handler for modals + screens
initNavigation({
  onCloseModal: () => {
    if (isRefPointPickerVisible()) cancelRefPointPicker();
  },
  onBackToSetup: () => showSetupModal(),
  onBackFromSummary: () => resetForNewRecording(),
  onBackDuringRecording: () => handleBackDuringRecording(),
});

// On entering AR
pushScreenState('ar');

// On starting recording
pushScreenState('recording');
enableBeforeUnloadWarning();

// On stopping recording
disableBeforeUnloadWarning();
replaceScreenState('summary');

// On soft reset (new recording)
replaceScreenState('setup');
```

## Tests

Unit tests in `navigation.test.ts` (35 tests) cover:

**Phase 1 (17 tests):**

- Push state: calls `history.pushState`, sets flag, idempotent
- Pop state: calls `history.back`, resets flag, no-op when not pushed, no-op on second call
- Popstate handling: fires `onCloseModal` when flag is true, ignores when false, doesn't fire after programmatic close, replaces previous handler
- `beforeunload`: prevents default when enabled, idempotent enable, allows after disable, no-op disable when not enabled
- `destroyNavigation`: cleans up all handlers and state

**Phase 2 (17 tests):**

- `pushScreenState`: pushes history, updates `getCurrentScreen`, allows successive pushes
- `replaceScreenState`: replaces history, updates `getCurrentScreen`
- `getCurrentScreen`: defaults to `setup`, reflects latest state
- Screen popstate: back from AR calls `onBackToSetup`; back during recording delegates to `onBackDuringRecording` (does NOT re-push state); back from summary calls `onBackFromSummary` + `replaceState(setup)`; modal takes priority over screen back; recording back delegates after modal close; back from setup is a no-op
- `initNavigation` backward compat: still supports modal close callback
- `destroyNavigation`: resets screen to `setup`, removes screen popstate handler

Integration tests in `ref-point-picker.test.ts` (5 tests) cover:

- Picker pushes history state on show
- Picker pops history state on confirm, cancel, and suggestion click
- Popstate cancels picker and resolves with null (simulated back button)

## Related Files

- [ref-point-picker.ts](./ref-point-picker.ts) — Calls `pushModalState`/`popModalState` during show/resolve
- [main.ts](../main.ts) — Calls `initNavigation`, `pushScreenState`, `replaceScreenState`, `enableBeforeUnloadWarning`, `disableBeforeUnloadWarning`, and wires `handleBackDuringRecording` as the `onBackDuringRecording` callback
- [confirm-dialog.ts](./confirm-dialog.ts) — The styled confirm dialog shown by `handleBackDuringRecording`
