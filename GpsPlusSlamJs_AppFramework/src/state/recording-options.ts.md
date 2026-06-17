# recording-options.ts

## Purpose

User-configurable recording options for controlling high-frequency data streams (depth sampling, image capture). Allows users to disable/tune expensive capture operations to improve performance on lower-end devices.

## Public API

### Types

| Type                   | Description                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DepthCaptureOptions`  | Config for depth sampling: `enabled`, `intervalMs`, `gridSize`, `rgb`                                              |
| `ImageCaptureOptions`  | Config for image capture: `enabled`, `intervalMs`, `quality`, `resolutionDivisor`                                  |
| `OccupancyOptions`     | Config for the derived occupancy grid: `cellSizeM` (voxel edge length, metres)                                     |
| `VisualizationOptions` | Live debug-overlay toggles: `frameTiles`, `occupancyCubes`, `gpsAlignmentMarkers`, `compassCubes` (all default ON) |
| `QrCaptureOptions`     | Live QR detection + RAW recording: `enabled` (default **OFF**, opt-in), `intervalMs`, `captureSize`                |
| `RecordingOptions`     | Combined config with `depth`, `images`, `arCrashIsolation`, `occupancy`, `visualization`, `qr` sections            |

### Functions

| Function                                | Input                            | Output                 | Description                                                                            |
| --------------------------------------- | -------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `loadRecordingOptions(key?)`            | `key?: string`                   | `RecordingOptions`     | Loads from localStorage, returns defaults if not found                                 |
| `saveRecordingOptions(options, key?)`   | `RecordingOptions, key?: string` | `void`                 | Validates and saves to localStorage                                                    |
| `resetRecordingOptions(key?)`           | `key?: string`                   | `RecordingOptions`     | Clears storage, returns defaults                                                       |
| `cloneRecordingOptions(options)`        | `RecordingOptions`               | `RecordingOptions`     | Deep copy                                                                              |
| `validateDepthOptions(partial)`         | `Partial<DepthCaptureOptions>`   | `DepthCaptureOptions`  | Validates and clamps values                                                            |
| `validateImageOptions(partial)`         | `Partial<ImageCaptureOptions>`   | `ImageCaptureOptions`  | Validates and clamps values                                                            |
| `validateOccupancyOptions(partial)`     | `Partial<OccupancyOptions>`      | `OccupancyOptions`     | Clamps `cellSizeM`; rejects NaN/Infinity to default                                    |
| `validateVisualizationOptions(partial)` | `Partial<VisualizationOptions>`  | `VisualizationOptions` | Boolean-or-default per field (missing/corrupted → ON)                                  |
| `validateQrOptions(partial)`            | `Partial<QrCaptureOptions>`      | `QrCaptureOptions`     | `enabled` boolean-or-default (→ OFF); clamps `intervalMs`/`captureSize`, NaN → default |
| `validateRecordingOptions(partial)`     | `Partial<RecordingOptions>`      | `RecordingOptions`     | Validates full options object                                                          |

### Constants

| Constant                    | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `STORAGE_KEY`               | localStorage key: `'gps-plus-slam-recorder-options'`  |
| `DEFAULT_RECORDING_OPTIONS` | Default values (all enabled)                          |
| `DEPTH_CONSTRAINTS`         | Min/max/step for depth options                        |
| `IMAGE_CONSTRAINTS`         | Min/max/step for image options                        |
| `OCCUPANCY_CONSTRAINTS`     | Min/max/step for `cellSizeM` (metres)                 |
| `QR_CONSTRAINTS`            | Min/max/step for `qr.intervalMs` and `qr.captureSize` |

## Invariants & Assumptions

- Values loaded from localStorage are always validated and clamped
- Invalid JSON in storage returns defaults (no crash)
- Schema evolution: missing fields merge with defaults
- All numeric values respect constraint bounds after validation

## Defaults

```typescript
{
  depth: { enabled: true, intervalMs: 1000, gridSize: 16, rgb: true },
  images: { enabled: true, intervalMs: 2000, quality: 0.7, resolutionDivisor: 1 },
  occupancy: { cellSizeM: 0.15 },
  visualization: { frameTiles: true, occupancyCubes: true, gpsAlignmentMarkers: true, compassCubes: true },
  qr: { enabled: false, intervalMs: 125, captureSize: 1024 }
}
```

`qr.*` configure live QR detection + RAW recording (recorder live-QR §0). `enabled` defaults **OFF** — it is opt-in, mirroring how the heavy `depth`/`images` streams are operator-gated, so an existing recording never silently gains the per-frame `BarcodeDetector` cost. When ON, the recorder runs the thin RAW producer (`ar/qr-detection-controller.ts`) and persists one `qrDetected/recordQrDetection` action per accepted decode (size + pose are derived on read, never recorded). `intervalMs` (default 125 ms ≈ 8 Hz, the QR demo's `DETECT_INTERVAL_MS`) is the single capture/detection cadence; `captureSize` (default 1024 px long-edge) trades small-QR decode range against blit+decode cost. All three are surfaced as settings-modal controls. See [2026-06-17-followup-recorder-live-qr-next-steps.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-17-followup-recorder-live-qr-next-steps.md) (§0).

`visualization.*` (all default **ON**) gate the four live AR debug overlays — frame tiles, occupancy cubes, GPS+VIO alignment spheres, and compass cubes. They control **only what is drawn live during recording**: capture (frame blobs, depth samples, occupancy data, GPS events) is never affected, and **replay is never gated** (reviewing the captured overlays is the point there). Like `occupancy.cellSizeM`, they are read once at Enter-AR — toggling mid-session applies on the next Enter-AR, not retroactively. Because all four default ON the group is purely additive: every overlay still renders until the operator opts out. The recorder reads them in `handleEnterAR` (frame tiles / occupancy cubes / compass cubes are skipped by _not_ wiring them; the alignment spheres are hidden via `GpsEventVisualizer.setVisible`). See [2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md) (Finding B) and [gps-event-markers.ts.md](../visualization/gps-event-markers.ts.md).

`occupancy.cellSizeM` (default **0.15 m**, matching `OccupancyGrid`'s own default) is the voxel edge length for the derived occupancy grid. It does **not** change what is recorded — it governs the grid built from the recorded depth points (debug cubes + COLMAP `points3D`), so it applies on replay too, letting the same recording be re-quantized at a different resolution. The recorder surfaces it as a cm slider in the settings modal; it is read once at grid construction (Enter-AR / replay load). See [2026-06-13-occupancy-grid-settings-and-mesh-review.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-grid-settings-and-mesh-review.md) (item 1) and [occupancy-grid.ts.md](../ar/occupancy-grid.ts.md).

`depth.gridSize` default is 16 (16×16 = 256 points per sample) so the AR-space occupancy grid populates fast enough for on-device verification (2026-06-11 port plan §1). The depth options reach the sampler via `startDepthCapture(config)` → `DepthSampler.updateConfig` — before that plumbing existed they were dead knobs. `depth.rgb` (default **true**) toggles the Iter-8 RGB voxel coloring (one small per-sample camera-color blit+readback); non-boolean persisted values fall back to the default, so pre-Iter-8 stored options keep the feature on.

## Validation Constraints

| Setting                    | Min  | Max   |
| -------------------------- | ---- | ----- |
| `depth.intervalMs`         | 500  | 5000  |
| `depth.gridSize`           | 2    | 32    |
| `images.intervalMs`        | 1000 | 10000 |
| `images.quality`           | 0.3  | 1.0   |
| `images.resolutionDivisor` | 1    | 8     |
| `occupancy.cellSizeM` (m)  | 0.01 | 0.20  |
| `qr.intervalMs` (ms)       | 50   | 1000  |
| `qr.captureSize` (px)      | 256  | 2048  |

`occupancy.cellSizeM` is clamped to 1–20 cm: cell count scales as 1/cellSize³, so sub-cm voxels are both a memory/perf cliff and below the depth-sensor noise floor. A non-finite stored value (NaN/Infinity) falls back to the default rather than being clamped, because `OccupancyGrid` throws a `RangeError` on a non-finite cell size.

## Examples

```typescript
import {
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
} from './recording-options';

// Load (returns defaults if nothing saved)
const options = loadRecordingOptions();

// Modify
options.depth.enabled = false;
options.images.quality = 0.5;

// Save
saveRecordingOptions(options);

// Reset to defaults
const defaults = resetRecordingOptions();
```

## Tests

- `recording-options.test.ts` — unit tests
  - Validation: clamps out-of-range, handles invalid types
  - Persistence: load/save/reset with localStorage
  - Schema evolution: partial stored data merges with defaults (incl. pre-`visualization` blobs gaining the all-ON overlay group)
  - Constraints: bounds are valid, defaults within bounds
  - `visualization`: all-ON defaults + boolean-or-default validation per overlay toggle
  - `qr`: OFF-by-default (opt-in), demo-cadence (125 ms) / 1024 px defaults, clamps + NaN→default for `intervalMs`/`captureSize`, schema-evolution merge of a pre-`qr` blob
