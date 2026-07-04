# navigation.ts

## Purpose

Manages browser history state for modal and screen-level navigation,
and prevents accidental page exits during recording.

## Public API

| Export                         | Type      | Description                                                                                                      |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `NavigationStore`              | Interface | Minimal store interface: `getState()` + `dispatch()`                                                             |
| `NavigationCallbacks`          | Interface | Callbacks for popstate handling                                                                                  |
| `initNavigation(cbs, store)`   | Function  | Register popstate handler and set Redux store. Accepts `NavigationStore` or `() => NavigationStore` (Bug 9 fix). |
| `initModalNavigation(onClose)` | Function  | Legacy API — modal-only (creates local store)                                                                    |
| `pushScreenState(screen)`      | Function  | Push history + dispatch `navigateTo`                                                                             |
| `replaceScreenState(screen)`   | Function  | Replace history + dispatch `navigateTo`                                                                          |
| `getCurrentScreen()`           | Function  | Read `currentScreen` from Redux store                                                                            |
| `pushModalState()`             | Function  | Push modal history entry (idempotent)                                                                            |
| `popModalState()`              | Function  | Pop modal history entry (no-op if not pushed)                                                                    |
| `isModalStatePushed()`         | Function  | Check if modal entry is active                                                                                   |
| `enableBeforeUnloadWarning()`  | Function  | Warn before page close during recording                                                                          |
| `disableBeforeUnloadWarning()` | Function  | Remove page close warning                                                                                        |
| `destroyNavigation()`          | Function  | Tear down all handlers and reset state                                                                           |

## Invariants

- `pushModalState` is idempotent — duplicate calls are ignored.
- `popModalState` is a no-op when no state was pushed.
- **Programmatic history cleanup never re-enters screen-back logic** (F4,
  [2026-07-04 user feedback](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-04-ar-clipping-planes-and-lifecycle-user-feedback.md)):
  `popModalState()` arms a one-shot `suppressNextPopstate` guard right before
  its `history.back()`; the handler consumes the guard as Priority 0 and
  ignores exactly that self-induced popstate. Accepted edge: a real user back
  landing in the microsecond window between `popModalState()` and its popstate
  delivery is swallowed — one ignored back press, benign. The guard is cleared
  by `destroyNavigation()` so it cannot leak across re-initialization.
- Popstate handler prioritizes modal close over screen navigation.
- Screen state (`currentScreen`) lives in Redux via
  `routing-slice.ts`, not a module-level variable (Bug 2 fix).
- Store reference is resolved via a getter function so navigation
  always uses the current store after soft resets (Bug 9 fix).
- Routing actions are dispatched through the `NavigationStore` interface,
  keeping navigation loosely coupled from the full `RecorderStore`.
- `getCurrentScreen()` returns `'setup'` when no store is available.

## Examples

```typescript
import {
  initNavigation,
  pushScreenState,
  getCurrentScreen,
} from './navigation';

// Initialize with Redux store getter (Bug 9 fix — always resolves current store)
initNavigation(
  {
    onCloseModal: () => closeModal(),
    onBackToSetup: () => showSetup(),
    onBackFromSummary: () => resetApp(),
    onBackDuringRecording: () => showConfirmDialog(),
  },
  () => store
);

// Push screen state (dispatches to Redux + browser history)
pushScreenState('ar');
console.log(getCurrentScreen()); // 'ar'
```

## Tests

- `navigation.test.ts` — 48 tests covering:
  - Modal state push/pop idempotence
  - Screen transitions and popstate handling
  - Priority: modal close > screen back
  - Bug 2 regression: Redux store sync verification
  - Bug 9 regression: store getter resolves current store after replacement
  - F4 regression: the self-induced popstate after `popModalState()` is
    swallowed (one-shot), user-back paths and re-init are unaffected
