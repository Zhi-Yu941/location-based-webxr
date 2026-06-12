# hud.ts

## Purpose

Manages the HTML overlay elements: status display, buttons, modals. Provides a callback-based interface for the main module.

## Public API

| Export                                     | Type                              | Description                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UICallbacks`                              | interface                         | Callback functions for UI events                                                                                                                                                                                                                                                                                                                         |
| `initUI(callbacks)`                        | `(UICallbacks) => void`           | Wire up event listeners                                                                                                                                                                                                                                                                                                                                  |
| `updateStatus(text)`                       | `(string) => void`                | Update status text (green)                                                                                                                                                                                                                                                                                                                               |
| `updateFolderStatus(text)`                 | `(string) => void`                | Update the `#folder-status` element text                                                                                                                                                                                                                                                                                                                 |
| `updateSaveStatus(text)`                   | `(string) => void`                | Update the `#save-status` element text                                                                                                                                                                                                                                                                                                                   |
| `showError(message)`                       | `(string) => void`                | Show error (red)                                                                                                                                                                                                                                                                                                                                         |
| `updateGpsInfo(accuracy)`                  | `(number) => void`                | Update GPS accuracy display                                                                                                                                                                                                                                                                                                                              |
| `updateArInfo(tracking)`                   | `(string) => void`                | Update AR tracking status                                                                                                                                                                                                                                                                                                                                |
| `showArReadyControls()`                    | `() => void`                      | Show Start button for AR_READY state                                                                                                                                                                                                                                                                                                                     |
| `showRecordingControls()`                  | `() => void`                      | Show Stop button for RECORDING state; resets the Stop button to its idle state (clears any leftover busy state from a prior stop)                                                                                                                                                                                                                        |
| `hideRecordingControls()`                  | `() => void`                      | Hide recording UI controls                                                                                                                                                                                                                                                                                                                               |
| `setStopButtonBusy(busy)`                  | `(boolean) => void`               | Toggle the Stop button's in-progress state. `true` disables it, sets `aria-busy`, and relabels to "⏹ Stopping…" for the multi-second final sync (prevents the double-tap behind Sentry 7319627943); `false` restores "⏹ Stop" and re-enables. Throws if called before `initUI()`.                                                                        |
| `validateEnterButton()`                    | `() => void`                      | Enable/disable Enter AR button and update hint. Gated on **save location + permissions + scenario** only; the read folder is NOT required (D5, 2026-06-05 setup-UX decision).                                                                                                                                                                            |
| `populateScenarios(names)`                 | `(string[]) => void`              | Fill scenario dropdown                                                                                                                                                                                                                                                                                                                                   |
| `showSetupModal()`                         | `() => void`                      | Show the setup modal overlay (Issue 4 soft reset)                                                                                                                                                                                                                                                                                                        |
| `resetUIForNewRecording(options)`          | `(ResetUIOptions) => void`        | Reset UI state for a new recording: shows setup modal, hides recording controls, clears save-location-selected, optionally clears folder-selected based on `options.keepFolder`, clears save status text, and re-validates the Enter AR button.                                                                                                          |
| `updateFrameCount(count)`                  | `(number) => void`                | Update the frame counter display during recording. Shows the `frame-count-info` container. Color is yellow when 0, green when > 0.                                                                                                                                                                                                                       |
| `hideFrameCount()`                         | `() => void`                      | Hide the frame counter display (called when recording stops).                                                                                                                                                                                                                                                                                            |
| `updateRefPointButtonLabel(name?)`         | `(string?) => void`               | Update ref point button text for proximity detection. Pass a name to show `"📍 Capture '<name>'"`, or undefined to reset to `"📍 Mark Point"`. No-op before `initUI()`.                                                                                                                                                                                  |
| `updateTrackingQuality(report)`            | `(TrackingQualityReport) => void` | Show/update the tracking quality badge during recording. Unhides `#tracking-quality`, sets state label + confidence %, applies color class, populates sub-scores and diagnostics in the details panel. Re-attaches the tap-to-expand listener when the badge DOM element changes (e.g. DOM rebuild). Does not require `initUI()` — reads elements by ID. |
| `hideTrackingQuality()`                    | `() => void`                      | Hide the tracking quality container and collapse the details panel. Called when recording stops.                                                                                                                                                                                                                                                         |
| `setFolderImportExpanded(expanded, hint?)` | `(boolean, string?) => void`      | Expand/collapse the optional `#folder-import-section` `<details>` and show/clear a one-line hint above the folder button. D5: collapsed by default; auto-expanded by `folder-manager` when the chosen scenario has no OPFS ref points, and by `main.ts` in replay mode. Degrades gracefully when the elements are absent.                                |

### Types (Issue 4)

```typescript
interface ResetUIOptions {
  /** When true, keep the folder-selected state (read permission still valid). */
  keepFolder: boolean;
}
```

## UICallbacks Interface

```typescript
interface UICallbacks {
  onOpenFolder: () => Promise<void>;
  onChooseSaveLocation: () => Promise<void>;
  onEnterAR: () => Promise<void>;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => void | Promise<void>;
  onMarkRefPoint: () => Promise<void>;
  onToggleMap: () => void;
  onMapZoomIn: () => void;
  onMapZoomOut: () => void;
  onScenarioChange: (scenarioName: string) => void;
  onRequestPermissions: () => Promise<void>;
}
```

**Callback Details:**

- `onOpenFolder` — User clicked "Open Folder", expects async folder picker
- `onChooseSaveLocation` — User clicked "Save Location", expects async picker
- `onEnterAR` — User clicked "Enter AR", expects async XR session start
- `onStartRecording` — User clicked "Start Recording"
- `onStopRecording` — User clicked "Stop Recording"
- `onMarkRefPoint` — User clicked "Mark Ref Point"
- `onToggleMap` — User clicked "Map" toggle
- `onMapZoomIn` — User clicked "+" zoom button next to map toggle
- `onMapZoomOut` — User clicked "−" zoom button next to map toggle
- `onScenarioChange` — User selected existing scenario from dropdown, or auto-selection by `populateScenarios` (NOT called for "**new**")
- `onRequestPermissions` — User clicked "Request Permissions"

## DOM Elements

Expects these IDs in `index.html`:

**Required (throws if missing):**

- `btn-select-folder` - Folder picker button
- `btn-enter-ar` - Enter AR session button
- `scenario-select` - Dropdown for scenarios
- `btn-start`, `btn-stop`, `btn-ref-point` - Recording controls

**Optional (graceful degradation):**

- `btn-map` - Map toggle button
- `setup-modal` - Initial configuration modal
- `new-scenario-section` - Section for new scenario name
- `new-scenario-name` - Input for new scenario name (auto-focused when "**new**" selected)
- `enter-ar-hint` - Hint text explaining why Enter AR button is disabled
- `status-text` - Status display
- `gps-info`, `ar-info` - Sensor status displays
- `frame-count-info` - Container for frame counter (hidden by default)
- `frame-count` - Span showing the current frame count number
- `tracking-quality` - Container for tracking quality indicator (hidden by default)
- `tracking-quality-badge` - Compact badge with state label + confidence (tap to expand)
- `tq-state`, `tq-confidence` - State label and confidence percentage spans
- `tracking-quality-details` - Expandable detail panel (hidden by default)
- `tq-convergence`, `tq-sum-rot`, `tq-sum-pos`, `tq-residual`, `tq-gps-accuracy`, `tq-coverage` - Detail-panel divs. `tq-sum-rot` / `tq-sum-pos` were added per Finding 6 (2026-05-23) and render `diagnostics.recentSumRotationDeltaDeg` / `recentSumTranslationDeltaM` as `ΣΔrot: …°` / `ΣΔpos: …m`. Compass / Heading Δ / drift, Obs and Walked were removed from the HUD (Findings 2/3/5) — the underlying fields remain on the `TrackingQualityReport` for background metrics + tests.

## Invariants & Assumptions

- `initUI()` must be called before any other exported functions
- DOM elements must exist before `initUI()` is called
- Critical elements throw an error if missing (fail-fast pattern)
- Required elements are cached after `initUI()` to avoid redundant DOM queries
- Functions called before `initUI()` throw an error indicating the initialization order violation
- Callbacks provided by main module
- Uses Tailwind CSS classes for styling
- `populateScenarios()` shows the new scenario section and auto-focuses the name input when called with an empty array (no existing scenarios)
- `populateScenarios()` calls `onScenarioChange` when auto-selecting the first existing scenario, ensuring `currentScenarioName` in main.ts is synchronized
- **Transition handling**: When hiding `new-scenario-section`, the code:
  - Checks `prefers-reduced-motion` and `transitionDuration` to detect if CSS transitions will run
  - If no transition expected (reduced motion or 0s duration): adds `hidden` class immediately
  - If transition expected: waits for `transitionend` event with a 350ms timeout fallback
  - This ensures the element is properly hidden from assistive tech even when `transitionend` doesn't fire

## Tests

- Unit tests in `hud.test.ts` using jsdom environment
- Tests cover:
  - Fail-fast behavior for missing required elements
  - Initialization order enforcement (throws if functions called before `initUI()`)
  - Validation logic for Enter AR button
  - Scenario dropdown population (including empty scenario list edge case)
  - Status/GPS/AR info display functions
  - `updateRefPointButtonLabel`: sets capture label, resets to default, no-op before initUI
  - `showArReadyControls` resets ref point button label to default
  - Graceful degradation for optional elements
  - Transition handling edge cases:
    - `prefers-reduced-motion` detection and immediate hiding
    - Zero-duration transition detection and immediate hiding
    - Timeout fallback when `transitionend` never fires
    - Timeout cleanup when `transitionend` fires normally
  - `updateTrackingQuality`: state labels, color classes, confidence %, sub-scores, diagnostics, compass drift, null sub-score handling, no-op on missing container, DOM rebuild listener re-attach
  - Tracking quality badge tap to expand/collapse: toggle details visibility, multiple toggle cycles
  - `hideTrackingQuality`: hides container, collapses details, no-op on missing elements
- E2E tests in `playwright-tests/enter-ar-flow.spec.js` cover:
  - Enter AR button hint display when disabled
  - New scenario creation flow
  - Bug fix verification: new scenario section visible when no existing scenarios
- See also `playwright-tests/smoke.spec.js`, `playwright-tests/setup-modal.spec.js`
