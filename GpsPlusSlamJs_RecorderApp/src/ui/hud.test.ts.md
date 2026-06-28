# hud.test.ts

Unit tests for the HUD / UI module (`hud.ts`).

## Purpose

Validates the behavior of the HUD module, including fail-fast initialization, button state management, scenario dropdown logic, and CSS transition handling. Tests use jsdom to simulate a browser environment.

## Test Strategy

- **Fail-fast verification**: Tests confirm that missing required DOM elements throw descriptive errors during `initUI()`.
- **Initialization order enforcement**: Tests use `vi.resetModules()` and dynamic imports to verify that calling any exported function before `initUI()` throws an error.
- **State-driven UI tests**: Tests manipulate DOM state and verify UI updates (button enable/disable, visibility toggles, hint text).
- **Transition edge cases**: Tests mock `matchMedia` and `getComputedStyle` to verify correct behavior with/without CSS transitions and `prefers-reduced-motion`.

## Helper Functions

| Function                 | Description                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `setupMinimalDOM()`      | Creates a minimal DOM structure with all required elements for testing (includes tracking quality elements) |
| `createMockCallbacks()`  | Returns a mock `UICallbacks` object with all callbacks as `vi.fn()` spies                                   |
| `mockTransitionBehavior` | Mocks `window.matchMedia` and `getComputedStyle` to control transition behavior; returns a cleanup function |
| `makeReport(overrides?)` | Creates a test `TrackingQualityReport` with sensible defaults; overrides any field via spread               |

## Test Suites

### initUI

Validates fail-fast behavior for required DOM elements.

| Test                                            | Why It Matters                                            |
| ----------------------------------------------- | --------------------------------------------------------- |
| throws when btn-select-folder is missing        | Catches typos in element IDs early                        |
| throws when btn-enter-ar is missing             | Critical button for starting AR                           |
| throws when scenario-select is missing          | Dropdown is required for scenario selection               |
| throws when recording controls are missing      | btn-start, btn-stop, btn-ref-point are core functionality |
| throws when recording-indicator is missing      | Cached element used during recording; fail early          |
| succeeds when all required elements are present | Confirms happy path works                                 |
| succeeds when optional btn-map is missing       | Verifies graceful degradation for optional elements       |

### validateEnterButton

Tests the Enter AR button enable/disable logic and hint text.

| Test                                                    | Why It Matters                                                |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| throws when called before initUI                        | Enforces initialization order (programming error if violated) |
| shows permission hint when permissions not ready        | Users must grant permissions before entering AR               |
| enables button when a scenario is selected              | Valid scenario selection enables entry                        |
| disables button when **new** is selected without a name | New scenarios require a name                                  |
| enables button when **new** is selected with a name     | Valid new scenario name enables entry                         |
| shows folder hint when scenario dropdown is disabled    | Clarifies next action when no folder selected                 |
| shows scenario name hint when **new** selected          | Guides user to enter scenario name                            |
| hides hint when button is enabled                       | Hint disappears when requirements are met                     |

### populateScenarios

Tests scenario dropdown population and auto-selection behavior.

| Test                                                           | Why It Matters                                  |
| -------------------------------------------------------------- | ----------------------------------------------- |
| adds scenarios to dropdown                                     | Verifies correct dropdown structure             |
| selects first scenario when available                          | UX: auto-select existing scenario               |
| enables session notes                                          | Enables notes textarea after folder selection   |
| shows new-scenario-section when no existing scenarios          | Bug fix: empty folder shows name input          |
| selects **new** option when no existing scenarios              | Correct dropdown state for empty folders        |
| focuses new-scenario-name input when no existing scenarios     | UX: guides user to next action                  |
| hides new-scenario-section when existing scenarios are present | Clean UI when existing scenario is selected     |
| invokes onScenarioChange when auto-selecting first existing    | Bug fix: syncs `currentScenarioName` in main.ts |
| does not invoke onScenarioChange when no existing scenarios    | `__new__` is a placeholder, not a real scenario |

### updateStatus / updateGpsInfo / updateArInfo / showError

Tests status display functions and graceful degradation.

| Test                                       | Why It Matters                             |
| ------------------------------------------ | ------------------------------------------ |
| updates status text when element exists    | Verifies status updates work               |
| does not throw when status-text is missing | Graceful degradation for optional elements |
| shows GPS accuracy with correct formatting | Displays `±X.Xm` format                    |
| uses green/yellow/red color for accuracy   | Color-coded accuracy thresholds            |
| shows AR tracking status                   | Displays tracking state text               |
| shows error with red styling               | Error messages use `text-red-400`          |
| shows webxr warning for WebXR errors       | WebXR-specific errors trigger warning      |

### Scenario Dropdown Change Events

Tests callback invocation and transition handling.

| Test                                                          | Why It Matters                                    |
| ------------------------------------------------------------- | ------------------------------------------------- |
| invokes onScenarioChange when existing scenario is selected   | Callback synchronizes state with main.ts          |
| does not invoke onScenarioChange when **new** is selected     | Placeholder selection doesn't trigger callback    |
| auto-focuses new scenario name input when **new** is selected | UX improvement                                    |
| does not hide new-scenario-section immediately when switching | Waits for CSS transition to complete              |
| hides new-scenario-section after transitionend event          | Transition-based hiding                           |
| does not hide if user switches back to **new** mid-transition | Guard condition prevents premature hiding         |
| hides immediately when prefers-reduced-motion is enabled      | Accessibility: no transitions with reduced motion |
| hides immediately when transitionDuration is 0s               | No transition expected; hide immediately          |
| hides via timeout fallback if transitionend never fires       | Guards against browser bugs / rapid DOM changes   |
| clears timeout fallback when transitionend fires normally     | Prevents duplicate hidden class additions         |

### updateTrackingQuality

Tests the tracking quality badge and detail panel rendering.

| Test                                                  | Why It Matters                                               |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| shows state label for each TrackingQualityState       | Verifies all 4 state labels render correctly                 |
| applies correct color class for each state            | Color-coded state feedback (green/yellow/gray/red)           |
| shows confidence as percentage                        | Converts 0..1 float to "XX%" string                          |
| populates sub-score values in detail panel            | Detail panel shows convergence, residual, GPS, coverage      |
| renders ΣΔrot and ΣΔpos sums from diagnostics         | Finding 6 raw alignment-motion sums next to Conv:            |
| does not render compass, heading, obs, or walked      | Guards the HUD pruning so a careless re-add is caught        |
| no-op when tracking-quality container is missing      | Graceful degradation if HTML element absent                  |
| re-attaches click listener when badge element changes | Ensures tap-to-expand works across DOM rebuilds              |
| resets expanded state when badge element changes      | Clean slate after DOM rebuild prevents stale expansion state |

### Tracking quality badge tap to expand/collapse

Tests the tap-to-toggle detail panel behavior.

| Test                                  | Why It Matters                                              |
| ------------------------------------- | ----------------------------------------------------------- |
| tapping badge toggles details visible | Expand gesture shows sub-scores                             |
| tapping badge again hides details     | Collapse gesture hides sub-scores                           |
| multiple toggle cycles work correctly | State machine toggles cleanly through repeated interactions |

### hideTrackingQuality

Tests hiding the tracking quality indicator.

| Test                                                   | Why It Matters                               |
| ------------------------------------------------------ | -------------------------------------------- |
| hides tracking quality container and collapses details | Clean HUD when recording stops               |
| no-op when tracking quality elements are missing       | Graceful degradation if HTML elements absent |

### hideRecordingControls

Tests the transition from RECORDING to AR_READY state.

| Test                                        | Why It Matters                                     |
| ------------------------------------------- | -------------------------------------------------- |
| hides the recording indicator               | Recording indicator should not show when idle      |
| shows start button and hides stop/ref-point | Correct button visibility after stopping recording |
| throws when called before initUI            | Enforces initialization order                      |

### showArReadyControls

Tests the AR_READY state UI (Issue #2 fix).

| Test                                            | Why It Matters                                        |
| ----------------------------------------------- | ----------------------------------------------------- |
| shows the start button in AR_READY state        | User can explicitly choose when to begin recording    |
| hides the stop button in AR_READY state         | Stop button only appears during active recording      |
| hides the recording indicator in AR_READY state | Indicator would misleadingly suggest active recording |
| hides the reference point button in AR_READY    | Ref points only make sense during recording           |
| throws when called before initUI                | Enforces initialization order                         |

## Invariants Tested

1. **Initialization order**: Functions like `hideRecordingControls`, `showArReadyControls`, `validateEnterButton`, and `populateScenarios` must not be called before `initUI()`. Tests use `vi.resetModules()` + dynamic import to verify a fresh module throws when called prematurely.

2. **Fail-fast for required elements**: `initUI()` throws if any required DOM element is missing, ensuring early failure rather than silent runtime errors.

3. **Transition handling**: The module correctly detects when CSS transitions will/won't run (via `prefers-reduced-motion` and `transitionDuration`) and either waits for `transitionend` or hides immediately.

## Related Files

- [hud.ts](hud.ts) — The implementation under test
- [hud.ts.md](hud.ts.md) — Implementation sidecar with public API documentation
- [test-hooks-verification.spec.md](../../playwright-tests/test-hooks-verification.spec.md) — E2E tests for window.testHooks runtime behavior
