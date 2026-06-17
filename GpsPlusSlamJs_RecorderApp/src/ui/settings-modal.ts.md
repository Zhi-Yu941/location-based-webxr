# settings-modal.ts

## Purpose

UI component for the settings modal dialog. Allows users to configure recording options (depth sampling, image capture) with visual sliders and checkboxes.

## Public API

### Functions

| Function                       | Input               | Output                     | Description                               |
| ------------------------------ | ------------------- | -------------------------- | ----------------------------------------- |
| `initSettingsModal(callback?)` | `(options) => void` | `void`                     | Initializes modal, wires up events        |
| `showSettingsModal()`          | -                   | `void`                     | Shows modal, loads current options        |
| `hideSettingsModal()`          | -                   | `void`                     | Hides modal, discards unsaved changes     |
| `isSettingsModalVisible()`     | -                   | `boolean`                  | Check if modal is currently shown         |
| `getWorkingOptions()`          | -                   | `RecordingOptions \| null` | Get current unsaved options (for testing) |

> **Note:** HTML markup lives in `index.html`. Tests use `../test-utils/html-fixtures.ts` to load production HTML, ensuring tests always match the actual UI.

### UI Elements Expected

| Element ID                        | Type     | Purpose                                                    |
| --------------------------------- | -------- | ---------------------------------------------------------- |
| `settings-modal`                  | div      | Modal container (should have `hidden` class)               |
| `btn-settings`                    | button   | Opens settings modal                                       |
| `btn-settings-close`              | button   | Closes modal without saving                                |
| `btn-settings-save`               | button   | Saves and closes modal                                     |
| `btn-settings-reset`              | button   | Resets to defaults                                         |
| `depth-enabled`                   | checkbox | Toggle depth sampling                                      |
| `depth-interval`                  | range    | Depth sample interval slider                               |
| `depth-interval-value`            | span     | Display for interval value                                 |
| `depth-grid`                      | range    | Grid size slider                                           |
| `depth-grid-value`                | span     | Display for grid value                                     |
| `depth-rgb`                       | checkbox | Toggle RGB voxel coloring (Iter 8, default on)             |
| `images-enabled`                  | checkbox | Toggle image capture                                       |
| `images-interval`                 | range    | Image capture interval slider                              |
| `images-interval-value`           | span     | Display for interval value                                 |
| `images-quality`                  | range    | JPEG quality slider                                        |
| `images-quality-value`            | span     | Display for quality value                                  |
| `images-resolution-divisor`       | range    | Resolution divisor slider (1=full … 8)                     |
| `images-resolution-divisor-value` | span     | Display: "1× (full)", "÷2 (half)", etc                     |
| `occupancy-cell-size`             | range    | Voxel size slider — **cm** (1–20)                          |
| `occupancy-cell-size-value`       | span     | Display: "15 cm"                                           |
| `viz-frame-tiles`                 | checkbox | Live overlay: captured camera frames (default on)          |
| `viz-occupancy-cubes`             | checkbox | Live overlay: occupancy depth cubes (default on)           |
| `viz-gps-alignment-markers`       | checkbox | Live overlay: GPS+VIO alignment spheres (default on)       |
| `viz-compass-cubes`               | checkbox | Live overlay: compass orientation cubes (default on)       |
| `qr-enabled`                      | checkbox | Toggle live QR detection + RAW recording (default **off**) |
| `qr-interval`                     | range    | QR detection cadence slider — **ms** (50–1000)             |
| `qr-interval-value`               | span     | Display: "125 ms"                                          |
| `qr-capture-size`                 | range    | QR capture long-edge slider — **px** (256–2048)            |
| `qr-capture-size-value`           | span     | Display: "1024 px"                                         |
| `build-version-label`             | span/div | One-line build label for bug reports                       |

## Invariants & Assumptions

- Modal starts with `hidden` class applied
- Changes are only persisted on Save, not on close/backdrop click
- Sliders are disabled when their parent toggle is unchecked
- Working copy is created on show, cleared on hide
- Callback is invoked only after successful save
- The voxel-size slider operates in **centimetres** for readability, but the stored option (`occupancy.cellSizeM`) is **metres** — the input handler divides by 100 and `populateForm` multiplies by 100. A unit mismatch here would feed the grid a 100× wrong cell size, so both directions are unit-tested. Changing it takes effect on the next Enter-AR / replay load (the grid reads it at construction), not mid-session. See [recording-options.ts.md](../../../GpsPlusSlamJs_AppFramework/src/state/recording-options.ts.md).
- Build version label (`#build-version-label`) is populated during `initSettingsModal()` from `getBuildInfo()`. If metadata is unavailable, the modal logs a warning and shows `Build unavailable` instead of throwing.
- The `qr-*` controls write `workingOptions.qr.*` (recorder live-QR WS-2/WS-5). QR is **opt-in** — `qr-enabled` defaults OFF and the interval/capture sliders are disabled until it is checked (mirrors the depth/images gating). `qr-interval` is **ms** and `qr-capture-size` is **px** (both stored as-is, no unit conversion). Read once at the next Enter-AR. See [recording-options.ts.md](../../../GpsPlusSlamJs_AppFramework/src/state/recording-options.ts.md) and [qr/wire-qr-recording.ts.md](../qr/wire-qr-recording.ts.md).
- The four `viz-*` checkboxes write `workingOptions.visualization.*` (all default ON). They gate **only** what is drawn live during recording — they never change capture, and replay is never gated. The recorder reads them once at the next Enter-AR (`handleEnterAR`), so toggling mid-session has no retroactive effect. Section heading **"Show during recording (3D debug overlays)"** with the note that they only change the live view (DB-3). See [recording-options.ts.md](../../../GpsPlusSlamJs_AppFramework/src/state/recording-options.ts.md) and the [2026-06-14 follow-up](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md) (Finding B).

## Examples

```typescript
import { initSettingsModal, showSettingsModal } from './settings-modal';

// Initialize with optional change callback
initSettingsModal((options) => {
  console.log('Options saved:', options);
  // Apply new options to capture systems
});

// Open modal (e.g., from a button click)
document
  .getElementById('btn-settings')
  .addEventListener('click', showSettingsModal);
```

## Tests

- `settings-modal.test.ts` — 40 unit tests
  - Production HTML validation: modal and button markup from `index.html`
  - Modal visibility: show/hide behavior
  - Form population: checkboxes, sliders
  - Slider interactions: value updates on input
  - Checkbox interactions: disables related sliders
  - Save/reset/close behavior
  - Build label population and graceful fallback when metadata is unavailable

> Tests use `html-fixtures.ts` to load the actual production HTML from `index.html`, eliminating duplication and ensuring tests fail if the production markup is broken.
