# recording-options.ts

## Purpose

User-configurable recording options for controlling high-frequency data streams (depth sampling, image capture). Allows users to disable/tune expensive capture operations to improve performance on lower-end devices.

## Public API

### Types

| Type                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DepthCaptureOptions`     | Config for depth sampling: `enabled`, `intervalMs`, `gridSize`, `rgb`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ImageCaptureOptions`     | Config for image capture: `enabled`, `intervalMs`, `quality`, `resolutionDivisor`, `motionFilter` (nested blurry-frame gate, see `ar/capture-motion-gate.ts`), `qualityFilter` (nested blur/blackness gate, see `ar/image-quality.ts`)                                                                                                                                                                                                                                                                                               |
| `OccupancyOptions`        | Config for the derived occupancy grid: `cellSizeM` (voxel edge length, metres), `minConfidence` (noise filter, min observations to render), `persistentOcclusion` (persistent depth-only mesh occluder, default **false**), `liveOcclusion` (live CPU-depth occluder, live-AR only, default **false**) — these two replaced the former single `occlusionMeshEnabled` boolean (migrated on load) — and `occluderDebugViz` (visible shiny matcap debug render of the persistent occluder mesh, still depth-writing, default **false**) |
| `FrameTileDisplayOptions` | Frame-tile display-texture resolution: `divisor` (1=full…8=eighth, default 2). Display-only, distinct from capture                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `VisualizationOptions`    | Live overlay/map toggles: `frameTiles`, `occupancyCubes`, `gpsAlignmentMarkers`, `compassCubes`, `headingUpMap` (rotate minimap to user heading) — all default ON; live-only, never affect replay                                                                                                                                                                                                                                                                                                                                    |
| `QrCaptureOptions`        | Live QR detection + RAW recording: `enabled` (default **OFF**, opt-in), `intervalMs`, `captureSize`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RecordingOptions`        | Combined config: `depth`, `images`, `arCrashIsolation`, `occupancy`, `frameTileDisplay`, `visualization`, `qr`                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Functions

| Function                                   | Input                              | Output                    | Description                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadRecordingOptions(key?)`               | `key?: string`                     | `RecordingOptions`        | Loads from localStorage, returns defaults if not found                                                                                                                                                                                                                                                                                                                                                      |
| `saveRecordingOptions(options, key?)`      | `RecordingOptions, key?: string`   | `void`                    | Validates and saves to localStorage                                                                                                                                                                                                                                                                                                                                                                         |
| `resetRecordingOptions(key?)`              | `key?: string`                     | `RecordingOptions`        | Clears storage, returns defaults                                                                                                                                                                                                                                                                                                                                                                            |
| `cloneRecordingOptions(options)`           | `RecordingOptions`                 | `RecordingOptions`        | Deep copy. **`images.motionFilter` and `images.qualityFilter` are deep-cloned** (the only nested-in-group objects) so the settings modal's in-place mutation cannot leak back into `DEFAULT_RECORDING_OPTIONS`                                                                                                                                                                                              |
| `validateDepthOptions(partial)`            | `Partial<DepthCaptureOptions>`     | `DepthCaptureOptions`     | Validates and clamps; rounds `gridSize` to an integer (N×N grid) so it applies downstream                                                                                                                                                                                                                                                                                                                   |
| `validateImageOptions(partial)`            | `Partial<ImageCaptureOptions>`     | `ImageCaptureOptions`     | Validates and clamps values; default-fills the `motionFilter` and `qualityFilter` groups via their validators                                                                                                                                                                                                                                                                                               |
| `validateMotionFilterOptions(partial)`     | `Partial<MotionFilterConfig>`      | `MotionFilterConfig`      | `enabled` boolean-or-default (→ ON); clamps the three thresholds to `MOTION_FILTER_CONSTRAINTS`, NaN → default                                                                                                                                                                                                                                                                                              |
| `validateQualityFilterOptions(partial)`    | `Partial<QualityFilterConfig>`     | `QualityFilterConfig`     | `enabled` boolean-or-default (→ **OFF**); clamps `blurRelativeThreshold`/`minMeanLuminance`/`maxWaitMs` to `QUALITY_FILTER_CONSTRAINTS`, NaN → default                                                                                                                                                                                                                                                      |
| `validateOccupancyOptions(partial)`        | `Partial<OccupancyOptions>`        | `OccupancyOptions`        | Clamps `cellSizeM`; rounds + clamps `minConfidence` (1–10); coerces `persistentOcclusion`/`liveOcclusion`/`occluderDebugViz` to boolean (non-boolean → default false); enum-validates `occluderMeshMode` against `OCCLUDER_MESH_MODES` (unknown → default `'greedy'`); **migrates** a legacy `occlusionMeshEnabled` (absent new field → maps `true`→`persistentOcclusion`); rejects NaN/Infinity to default |
| `validateFrameTileDisplayOptions(partial)` | `Partial<FrameTileDisplayOptions>` | `FrameTileDisplayOptions` | Clamps `divisor` to 1–8 + rounds to integer; rejects NaN/Infinity to default                                                                                                                                                                                                                                                                                                                                |
| `validateVisualizationOptions(partial)`    | `Partial<VisualizationOptions>`    | `VisualizationOptions`    | Boolean-or-default per field (missing/corrupted → ON)                                                                                                                                                                                                                                                                                                                                                       |
| `validateQrOptions(partial)`               | `Partial<QrCaptureOptions>`        | `QrCaptureOptions`        | `enabled` boolean-or-default (→ OFF); clamps `intervalMs`/`captureSize`, NaN → default                                                                                                                                                                                                                                                                                                                      |
| `validateRecordingOptions(partial)`        | `Partial<RecordingOptions>`        | `RecordingOptions`        | Validates full options object                                                                                                                                                                                                                                                                                                                                                                               |

### Constants

| Constant                         | Description                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `STORAGE_KEY`                    | localStorage key: `'gps-plus-slam-recorder-options'`                                             |
| `DEFAULT_RECORDING_OPTIONS`      | Default values (all enabled)                                                                     |
| `DEPTH_CONSTRAINTS`              | Min/max/step for depth options                                                                   |
| `IMAGE_CONSTRAINTS`              | Min/max/step for image options                                                                   |
| `MOTION_FILTER_CONSTRAINTS`      | Min/max/step for `motionFilter` thresholds (angular/linear vel, maxWaitMs)                       |
| `QUALITY_FILTER_CONSTRAINTS`     | Min/max/step for `qualityFilter` thresholds (blurRelativeThreshold, minMeanLuminance, maxWaitMs) |
| `OCCUPANCY_CONSTRAINTS`          | Min/max/step for `cellSizeM` (metres) and `minConfidence` (count)                                |
| `FRAME_TILE_DISPLAY_CONSTRAINTS` | Min/max/step for `frameTileDisplay.divisor`                                                      |
| `QR_CONSTRAINTS`                 | Min/max/step for `qr.intervalMs` and `qr.captureSize`                                            |

## Invariants & Assumptions

- Values loaded from localStorage are always validated and clamped
- Invalid JSON in storage returns defaults (no crash)
- Schema evolution: missing fields merge with defaults
- All numeric values respect constraint bounds after validation

## Defaults

```typescript
{
  depth: { enabled: true, intervalMs: 500, gridSize: 32, rgb: true },
  images: { enabled: true, intervalMs: 2000, quality: 0.7, resolutionDivisor: 1,
            motionFilter: { enabled: true, maxAngularVelocity: 0.6, maxLinearVelocity: 0.5, maxWaitMs: 4000 },
            qualityFilter: { enabled: false, blurRelativeThreshold: 0.5, minMeanLuminance: 10, maxWaitMs: 4000 } },
  occupancy: { cellSizeM: 0.15, minConfidence: 3, persistentOcclusion: true, liveOcclusion: false, occluderDebugViz: false, occluderMeshMode: 'smooth' },
  frameTileDisplay: { divisor: 2 },
  visualization: { frameTiles: true, occupancyCubes: true, gpsAlignmentMarkers: true, compassCubes: true, headingUpMap: true },
  qr: { enabled: false, intervalMs: 125, captureSize: 1024 }
}
```

### Depth/occupancy defaults — tuned for FAST mesh reconstruction (2026-07-01)

The default `depth` + `occupancy` params are tuned so a usable occluder mesh
builds up **as fast as possible** (param-sweep on a real recording — see
[2026-06-30-occluder-tuning-followups.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-30-occluder-tuning-followups.md), Round 6):

- `depth.intervalMs` **500** — the minimum cadence (2 samples/s), so points arrive fastest.
- `depth.gridSize` **32** — the previous slider max (1024 points/sample); more observations per sample confirm cells fastest. **The slider max was raised to 64** (4096 points/sample) for on-device experimentation with even higher densities — measure the per-sample depth-readback cost before adopting a value above 32.
- `occupancy.minConfidence` **3** — the key "time-to-mesh" lever: a cell needs this many observations before it is rendered, so it is ≈ the _dwell time_ before a surface meshes (≈1.5 s at 500 ms sampling, vs 2.5 s at 5). 3 is the **fastest noise floor that still suppresses the behind-surface phantoms** the filter exists for (it was 5 in the 2026-06-30 robustness pass; lowered here for speed).
- `occupancy.cellSizeM` **0.15** — kept; balances detail against area-coverage speed (coarser covers area faster but blockier, and the surface-hugging meshers like the resolution).

Earlier passes: intervalMs/gridSize/minConfidence were first re-tuned in the [2026-06-30 session](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-30-occluder-tuning-and-mesh-smoothness-user-feedback.md) (F1: 1000→500 / 16→24 / 3→5). The 2026-07-01 sweep then reversed the memory/robustness hedges (24→32, 5→3) once the goal became fastest reconstruction.

> **Not synced:** the library-level `DEFAULT_CONFIG` in [`ar/depth-sampler.ts`](../ar/depth-sampler.ts) intentionally keeps `intervalMs: 1000 / gridSize: 16`. That is the fallback for consumers that supply no config (MinimalExample / AnchorStarter); the re-tune is a recorder-specific decision sourced from `DEFAULT_RECORDING_OPTIONS`, so bumping the library default would silently re-tune unrelated apps.

`qr.*` configure live QR detection + RAW recording (recorder live-QR §0). `enabled` defaults **OFF** — it is opt-in, mirroring how the heavy `depth`/`images` streams are operator-gated, so an existing recording never silently gains the per-frame `BarcodeDetector` cost. When ON, the recorder runs the thin RAW producer (`ar/qr-detection-controller.ts`) and persists one `qrDetected/recordQrDetection` action per accepted decode (size + pose are derived on read, never recorded). `intervalMs` (default 125 ms ≈ 8 Hz, the QR demo's `DETECT_INTERVAL_MS`) is the single capture/detection cadence; `captureSize` (default 1024 px long-edge) trades small-QR decode range against blit+decode cost. All three are surfaced as settings-modal controls. See [2026-06-17-followup-recorder-live-qr-next-steps.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-17-followup-recorder-live-qr-next-steps.md) (§0).

`visualization.*` (all default **ON**) gate live overlays/map behaviour. Four of the five are AR debug overlays — frame tiles, occupancy cubes, GPS+VIO alignment spheres, and compass cubes — and `headingUpMap` is the fifth (it rotates the live minimap to the user heading, see below for its distinct lifecycle). They control **only what is drawn live during recording**: capture (frame blobs, depth samples, occupancy data, GPS events) is never affected, and **replay is never gated** (reviewing the captured overlays is the point there; the minimap stays north-up on replay). Because all five default ON the group is purely additive: every overlay still renders until the operator opts out. The **four AR debug overlays** are read once at Enter-AR — toggling mid-session applies on the next Enter-AR, not retroactively. The recorder reads them in `handleEnterAR` (frame tiles / occupancy cubes / compass cubes are skipped by _not_ wiring them; the alignment spheres are hidden via `GpsEventVisualizer.setVisible`). `headingUpMap`, by contrast, is **not** read at Enter-AR: the recorder consumes it in `handleToggleMap`, where the `LeafletMapOverlay` is lazily created on the first map toggle (`headingUp: recordingOptions.visualization.headingUpMap`), so its value takes effect when the map overlay is first created rather than at session start. See [2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md) (Finding B), [2026-06-29-heading-up-minimap-rotation-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-heading-up-minimap-rotation-plan.md), and [gps-event-markers.ts.md](../visualization/gps-event-markers.ts.md).

`occupancy.cellSizeM` (default **0.15 m**, matching `OccupancyGrid`'s own default) is the voxel edge length for the derived occupancy grid. It does **not** change what is recorded — it governs the grid built from the recorded depth points (debug cubes + COLMAP `points3D`), so it applies on replay too, letting the same recording be re-quantized at a different resolution. The recorder surfaces it as a cm slider in the settings modal; it is read once at grid construction (Enter-AR / replay load). See [2026-06-13-occupancy-grid-settings-and-mesh-review.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-grid-settings-and-mesh-review.md) (item 1) and [occupancy-grid.ts.md](../ar/occupancy-grid.ts.md).

`occupancy.persistentOcclusion` + `occupancy.liveOcclusion` (both default **false**) are the **two composable occlusion toggles** that replaced the former single `occlusionMeshEnabled` boolean (2026-06-29). `persistentOcclusion` turns on the persistent depth-only **mesh** occluder: the grid's occupied cells are meshed (`ar/occupancy-mesher.ts` → `visualization/occlusion-mesh.ts` `OcclusionMesh`) and drawn invisible-but-depth-writing under `arWorldGroup`, so real geometry hides virtual objects placed behind it — including out-of-view surfaces. `liveOcclusion` turns on the **live CPU-depth** occluder (`ar/depth-occluder.ts`), which hides content behind the surface the camera sees this frame (sharp, registration-free, no memory); it requires the `requestDepthOcclusion` session feature and is **live-AR only** (replay has no live depth stream, so the flag is a no-op there). The two **compose** — both on is the best end state (live wins where it has this-frame depth, the mesh fills out-of-view / depth holes; `2026-06-14-webxr-depth-occlusion-plan.md` §5). Both default OFF because each adds GPU/CPU cost and their on-device behaviour (mesh registration drift; live occlusion quality) is still device-gated. **Migration:** a persisted pre-split object carries only `occlusionMeshEnabled`; `validateOccupancyOptions` maps `true → persistentOcclusion` and never auto-enables `liveOcclusion`. Read once when the session is wired (Enter-AR / replay load), like `cellSizeM`/`minConfidence`. See [2026-06-13-occupancy-mesh-options-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-mesh-options-plan.md), [2026-06-29-occupancy-mesh-followups.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-occupancy-mesh-followups.md), [occlusion-mesh.ts.md](../visualization/occlusion-mesh.ts.md), and [depth-occluder.ts.md](../ar/depth-occluder.ts.md).

`occupancy.occluderDebugViz` (default **false**) is a debug-only render flag that swaps the **persistent** occluder mesh's invisible depth-only material for a **visible, shiny, semi-transparent matcap** that still writes depth — so the operator can judge the meshed surface's shape/quality on-device while it keeps occluding. It is an independent boolean (brand-new field, no migration) but only has a visible effect when `persistentOcclusion` is on (it is that occluder's mesh); ticking it alone is a harmless no-op. `OcclusionMesh.setDebugVisualization(enabled)` performs the swap and computes vertex normals (the mesher emits none) only when enabling, so the default occluder path stays cheap. Read once when the mesh is wired (Enter-AR / replay load). See [2026-06-29-occlusion-debug-viz-and-live-occluder-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-occlusion-debug-viz-and-live-occluder-user-feedback.md) and [occlusion-mesh.ts.md](../visualization/occlusion-mesh.ts.md).

`frameTileDisplay.divisor` (default **2** = half) controls the **display** resolution of the captured frame tiles shown in AR/replay — it downscales the decoded texture to `1/divisor` of each dimension (decode path: `frame-texture-decoder.ts` `decodeFrameTexture(blob, divisor)`), cutting per-tile GPU texture memory. It is **distinct from** the capture `images.resolutionDivisor` (the saved JPEG is untouched). Like `occupancy.cellSizeM` it does not change what is recorded, so it applies to **both live and replay**, read at Enter-AR (`main.ts`) and replay start (`replay/replay-mode.ts`). It is a **partial** memory mitigation for the OOM/crash track (D7-resolution, 2026-06-16 user feedback) — the tile _count_ still grows unbounded, so a cap/recycle remains the separate Track-S fix. Surfaced as the "Display resolution (AR tiles)" slider in the settings modal.

`images.qualityFilter` (default **OFF**) is the blur/blackness image-content gate layered on top of `motionFilter`. When enabled, a motion-calm captured frame is judged off-thread (a Web Worker in the recorder, via the manager's `analyzeFrame` callback); a frame below the recent sharpness median (`blurRelativeThreshold`) or below the absolute black cutoff (`minMeanLuminance`, 0–255 luma) is dropped and the next acceptable frame is grabbed, bounded by `maxWaitMs`. It defaults OFF because a mis-tuned relative blur threshold silently dropping good frames is worse than the motion gate's low-risk default-on — flip to ON once field-tuned. The metrics + verdict policy live in `ar/image-quality.ts`; the gate runs in `ImageCaptureManager`. See [2026-06-24-image-quality-gate-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md).

`depth.gridSize` default is 16 (16×16 = 256 points per sample) so the AR-space occupancy grid populates fast enough for on-device verification (2026-06-11 port plan §1). The depth options reach the sampler via `startDepthCapture(config)` → `DepthSampler.updateConfig` — before that plumbing existed they were dead knobs. `depth.rgb` (default **true**) toggles the Iter-8 RGB voxel coloring (one small per-sample camera-color blit+readback); non-boolean persisted values fall back to the default, so pre-Iter-8 stored options keep the feature on.

## Validation Constraints

| Setting                                       | Min  | Max   |
| --------------------------------------------- | ---- | ----- |
| `depth.intervalMs`                            | 500  | 5000  |
| `depth.gridSize`                              | 2    | 32    |
| `images.intervalMs`                           | 1000 | 10000 |
| `images.quality`                              | 0.3  | 1.0   |
| `images.resolutionDivisor`                    | 1    | 8     |
| `qualityFilter.blurRelativeThreshold`         | 0.05 | 0.95  |
| `qualityFilter.minMeanLuminance` (0–255 luma) | 0    | 128   |
| `qualityFilter.maxWaitMs` (ms)                | 500  | 20000 |
| `occupancy.cellSizeM` (m)                     | 0.01 | 0.20  |
| `occupancy.minConfidence`                     | 1    | 10    |
| `frameTileDisplay.divisor`                    | 1    | 8     |
| `qr.intervalMs` (ms)                          | 50   | 1000  |
| `qr.captureSize` (px)                         | 256  | 2048  |

`occupancy.cellSizeM` is clamped to 1–20 cm: cell count scales as 1/cellSize³, so sub-cm voxels are both a memory/perf cliff and below the depth-sensor noise floor. A non-finite stored value (NaN/Infinity) falls back to the default rather than being clamped, because `OccupancyGrid` throws a `RangeError` on a non-finite cell size.

`occupancy.minConfidence` (default **3**) is the voxel noise filter: the minimum observation `count` before a cell is rendered/used, forwarded to `getOccupiedCells(minObservations)`. It is rounded to an integer and clamped to 1–10 (1 = unfiltered/legacy); NaN/non-number falls back to the default. Raising it suppresses single-frame depth noise — notably the **behind-surface** phantoms (e.g. below the floor) that free-space carving can never clear. See `GpsPlusSlamJs_Docs/docs/2026-06-22-occupancy-grid-behind-surface-noise-plan.md`.

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
  - `qualityFilter`: OFF-by-default, default-fills a missing group, preserves/clamps the three thresholds (NaN→default), and `cloneRecordingOptions` deep-clones it (the second nested-in-group object)
