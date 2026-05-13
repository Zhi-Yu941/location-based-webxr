# GPS+SLAM App Framework

[![npm version](https://img.shields.io/npm/v/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![npm downloads](https://img.shields.io/npm/dm/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/gps-plus-slam-app-framework.svg)](https://nodejs.org/)

Reusable building blocks for AR+GPS web apps built on top of the closed-source [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js) alignment core.

This package gives you the four big concrete capabilities every location-based AR app needs, so your code can stay focused on UI and product logic:

- A **WebXR + Three.js scene** with image and depth capture, replay rendering, and tracking-state monitoring.
- **GPS, orientation, and permission wiring** ready to plug into the store.
- **OPFS + ZIP record & replay** with a `StorageBackend` interface you can swap.
- A **composable Redux store factory** (`createSlamAppStore`) that combines the core library's reducers with your own slices.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  (UI, screen flow, app-specific reducers)        │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework  ← this package     │
│  (WebXR, Three.js, sensors, storage, replay,     │
│   composable store factory)                      │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js  (core algorithms)             │
│  (GPS/AR alignment, outlier rejection, GPS math) │
└──────────────────────────────────────────────────┘
```

The framework never imports from your app. Your app imports from the framework and the core library. The core library never imports from the framework.

## Installation

```bash
pnpm add gps-plus-slam-app-framework gps-plus-slam-js
```

### Runtime Dependencies

These are pulled in automatically — you do not need to install them yourself:

- `@reduxjs/toolkit`
- `gl-matrix`
- `gps-plus-slam-js`

### Peer Dependencies

Required (install in your app):

- `three` (>= 0.170.0)
- `@zip.js/zip.js` (>= 2.7.0)
- `h3-js` (>= 4.0.0)

Optional:

- `leaflet` (>= 1.9.0) — only needed if you use `LeafletMapOverlay`
- `@sentry/browser` (>= 10.0.0) — only needed if you wire Sentry error reporting

## Quick Start

```typescript
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { initAR } from 'gps-plus-slam-app-framework/ar';
import { startGpsWatch } from 'gps-plus-slam-app-framework/sensors';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { recordGpsEvent } from 'gps-plus-slam-app-framework/state';

// 1. Compose the store. NullStorageBackend keeps everything in memory; swap
//    to OpfsStorageBackend when you want durable recording.
const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});

// 2. Start the WebXR AR session.
await initAR(document.getElementById('app')!);

// 3. Wire GPS into the store.
startGpsWatch(
  (pos) => {
    store.dispatch(
      recordGpsEvent({
        /* build the payload from `pos` */
      })
    );
  },
  (err) => {
    console.error('GPS error', err);
  }
);
```

See [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/) for a complete, runnable smallest-possible consumer (Three.js scene + status panel, no AR, no recording).

> **Imports.** Prefer subpath imports (`gps-plus-slam-app-framework/ar`, `…/state`, `…/sensors`, `…/storage`, `…/geo`, `…/visualization`, `…/utils`, `…/types`, `…/licensing`). The root barrel re-exports conflict-free names for convenience.

## Composing With Your Own Slices

`createSlamAppStore` is the headline composability seam. Your app plugs in its own reducers, middleware, and storage backend without forking the factory:

```typescript
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { OpfsStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { myUiReducer } from './state/ui-slice';
import { myAnalyticsMiddleware } from './state/analytics-middleware';

const store = createSlamAppStore({
  storageBackend: new OpfsStorageBackend(),
  extraReducers: { ui: myUiReducer },
  extraMiddleware: [myAnalyticsMiddleware],
  onWriteFailure: (err) => myErrorReporter(err),
  enableDevChecks: import.meta.env.DEV,
  // licenseKey: 'paid-key-here'  // omit to use the bundled community key
});
```

| Option            | Purpose                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storageBackend`  | **Required.** Bridge from Redux actions to durable storage. Use `NullStorageBackend` for tests/replay, `OpfsStorageBackend` for browser recording. |
| `extraReducers`   | Caller-supplied reducers added alongside the framework's built-ins (`gpsData`, `gpsElements`, `arElements`, `recording`).                          |
| `extraMiddleware` | Caller-supplied middlewares appended after RTK defaults and the persistence middleware.                                                            |
| `onWriteFailure`  | Invoked when the persistence middleware fails to durably write an action.                                                                          |
| `enableDevChecks` | Toggle RTK's expensive dev-only Serializable / Immutable checks. Default `true`; set `false` for high-throughput replay.                           |
| `licenseKey`      | Override the bundled community key with a paid license. Validation always runs.                                                                    |

## Recording & Replay

Out of the box the framework lays out durable storage like this when you use `OpfsStorageBackend`:

```
/gps-plus-slam/
  └── sessions/
        └── recording-{timestamp}/
              ├── actions/   (one JSON file per recorded Redux action)
              ├── frames/    (captured camera/depth frames)
              └── session.json
```

Key APIs:

- `exportSessionAsZip(sessionHandle, { contributors? })` — bundle a recorded session into a ZIP blob.
- `replayRecording(store, blob)` — feed a ZIP recording back into a store.
- `loadActionsFromZip(blob)` / `loadEntriesFromSubdir(blob, subdir)` — read recorded actions or any contributor-defined ZIP subdirectory.

### Adding Your Own ZIP Sections (`ZipExportContributor`)

Apps that need to ship extra data alongside the standard recording (e.g., the recorder app stores `refPoints/` this way) implement a `ZipExportContributor`:

```typescript
import {
  exportSessionAsZip,
  type ZipExportContributor,
} from 'gps-plus-slam-app-framework/storage';

const refPointsContributor: ZipExportContributor = {
  subdir: 'refPoints',
  contribute: async (addFile) => {
    addFile('points.json', JSON.stringify(myRefPoints));
  },
};

const blob = await exportSessionAsZip(sessionHandle, {
  contributors: [refPointsContributor],
});
```

## Scene-Graph Convention

The framework's WebXR scene is laid out so that the **scene root is GPS-aligned (NUE) space**:

```
scene                             ← GPS-aligned (NUE) space, the scene root
├── arWorldGroup                  ← carries the alignment matrix (GPS → AR)
│   ├── camera                    ← WebXR XRViewerPose (raw AR pose)
│   └── ar-content                ← anything fixed in AR space
│                                   (planes, point clouds, hit-test reticles, …)
└── ..objects with gps coords..   ← anything anchored to GPS coordinates
                                    (waypoints, POIs, navigation arrows, …)
```

When the alignment solver produces a new matrix, the framework writes it to `arWorldGroup.matrix`. The camera moves with `arWorldGroup`; objects parented directly to `scene` do not.

**Three options for placing your own `Object3D`:**

1. **Add it to `scene`** (with NUE-meter coordinates from `calcRelativeCoordsInMeters(zeroRef, …)`). The object's world pose stays at the correct latitude/longitude/altitude forever, but every time the alignment matrix is corrected the camera shifts inside `arWorldGroup`, so from the user's AR view the object visually "floats". Cheap and correct, but ugly during corrections — fine for small markers (e.g. ref-point spheres), not great for richer GPS-anchored content.
2. **Add it to `arWorldGroup`** with a fixed local transform. The object is frozen relative to AR-tracked content and never visually moves — but its world / GPS pose drifts every time alignment is corrected. Only useful for content that is logically tied to AR features rather than to a GPS coordinate (e.g. a hit-test reticle, an indicator stuck to a detected plane).
3. **Add it to `arWorldGroup` and re-derive its local pose on every alignment update** so the resulting world pose stays at the target GPS coordinate. This is the visually-best way to keep an object "at its GPS position": the object never floats, and re-snaps to the new local coordinates inside `arWorldGroup` each time alignment changes. The C# Unity stack ships a dedicated `GpsAnchor` component for exactly this pattern; the JS framework has the underlying primitives (`captureGpsAnchorSample`, `calcRelativeCoordsInMeters`, the alignment matrix on `arWorldGroup`) and a generic `GpsAnchor` Three.js port is on the roadmap. Until then, callers can implement the snap themselves in their alignment subscriber.

A pure-function `syncGpsAnchoredMeshes` reconciler (option 1, bulk markers) is shipped by the RecorderApp; the framework only exposes the math primitive `calcRelativeCoordsInMeters` so other consumers can write their own placement helpers.

## Modules

### `ar/` — WebXR & 3D Scene

WebXR session lifecycle, Three.js renderer setup, image/depth capture, replay scene management.

| Export                                       | Description                                      |
| -------------------------------------------- | ------------------------------------------------ |
| `initAR(container)`                          | Start a WebXR AR session with Three.js rendering |
| `endARSession()`                             | End the active XR session                        |
| `startImageCapture()` / `stopImageCapture()` | Toggle camera frame capture                      |
| `ImageCaptureManager`                        | Configurable camera frame capture pipeline       |
| `DepthSampler`                               | Depth buffer sampling with configurable grids    |
| `CameraBlitCapture`                          | GPU blit-based camera capture                    |
| `TrackingStateManager`                       | AR tracking state monitoring                     |
| `initReplayScene(container)`                 | Create a 3D replay scene with orbit/FPS controls |
| `applyChromiumProjectionLayerWorkaround`     | Workaround for Chromium camera-access edge cases |

### `sensors/` — GPS & Permissions

| Export                              | Description                               |
| ----------------------------------- | ----------------------------------------- |
| `startGpsWatch(onPos, onErr)`       | Start watching GPS position               |
| `stopGpsWatch()`                    | Stop GPS watch                            |
| `startOrientationWatch(cb)`         | Start device orientation events           |
| `checkAllPermissions()`             | Probe camera, GPS, XR permissions         |
| `requestAllPermissions()`           | Request all needed permissions            |
| `getGpsErrorMessage(code)`          | Human-readable GPS error messages         |
| `createGpsErrorHandler()`           | GPS error callback with deduplicated logs |
| `requestWebXRWithDepthPermission()` | Combined XR + depth permission prompt     |

### `state/` — Store & Recording

| Export                                              | Description                                                    |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `createSlamAppStore(options)`                       | Composable store factory (see options table above).            |
| `recordingReducer`                                  | Recording lifecycle slice (built into the factory).            |
| `startSession()` / `endSession()`                   | Recording lifecycle actions.                                   |
| `recordGpsEvent(payload)`                           | Record a paired AR+GPS observation.                            |
| `createGpsPositionHandler(config)`                  | Factory that adapts `GeolocationPosition` to a store dispatch. |
| `captureGpsAnchorSample(options)`                   | Sample a paired AR pose + GPS point for anchoring.             |
| `loadRecordingOptions()` / `saveRecordingOptions()` | Persist user-controlled recording settings.                    |
| `replayRecording(store, blob)`                      | Replay a ZIP recording into a store.                           |
| `ReplayEngine`                                      | Lower-level timed action playback with pause/resume/speed.     |
| `createPersistenceMiddleware(options)`              | Middleware factory used internally by `createSlamAppStore`.    |
| `wireStoreSubscribers(store, deps)`                 | Bridge store state → visualization updates.                    |

### `storage/` — OPFS, ZIP, File System

| Export                                         | Description                                             |
| ---------------------------------------------- | ------------------------------------------------------- |
| `StorageBackend`                               | Abstract storage interface (implement your own).        |
| `OpfsStorageBackend`                           | OPFS-based `StorageBackend`.                            |
| `NullStorageBackend`                           | No-op backend for tests and replay.                     |
| `initOpfsStorage()` / `initStorage(backend)`   | Initialize the file-system layer.                       |
| `createSession()` / `listSessions()`           | Session lifecycle on disk.                              |
| `exportSessionAsZip(handle, { contributors })` | Export a recording session as a ZIP blob.               |
| `ZipExportContributor`                         | Hook for adding your own ZIP subdirectories on export.  |
| `loadActionsFromZip(blob)`                     | Parse recorded actions from a ZIP file.                 |
| `loadEntriesFromSubdir(blob, subdir)`          | Read entries written by a contributor on import/replay. |
| `loadSessionMetadataFromBlob(blob)`            | Read `session.json` from a ZIP.                         |
| `loadGpsPathFromBlob(blob)`                    | Read the recorded GPS path.                             |
| `checkStorageQuota()`                          | Check OPFS quota usage.                                 |

### `geo/` — H3 Spatial Indexing

H3-based proximity matching for GPS-anchored points (renamed from `ref-points/` in the boundary migration).

| Export                           | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| `gpsToH3(lat, lon)`              | Convert GPS coordinates to an H3 cell index.                  |
| `findNearbyGeoAnchor(h3, known)` | Find a known geo-anchored point near an H3 cell.              |
| `h3CellsMatch(a, b)`             | Compare two H3 indices.                                       |
| `approxDistanceMetres(a, b)`     | Approximate distance between two `LatLong`s.                  |
| `isH3Index(value)`               | Type guard for H3 index strings.                              |
| `H3_RESOLUTION`                  | The H3 resolution used (default: 12, ~10 m cells).            |
| `KnownGeoAnchor` (type)          | Shape of a known anchor with H3 index, lat/lon, and metadata. |

### `visualization/` — Three.js & Maps

| Export                         | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `LeafletMapOverlay`            | 2D Leaflet map integrated via CSS3D into a 3D scene. |
| `MapOverlay`                   | Tile-based 3D map overlay (no Leaflet dependency).   |
| `GpsEventVisualizer`           | Three.js spheres for GPS event positions.            |
| `createAlignmentLerper()`      | Smooth alignment matrix interpolation.               |
| `createCameraFollower()`       | Camera that tracks a moving target.                  |
| `createCss3dRendererManager()` | CSS3D renderer for HTML-in-3D overlays.              |
| `createGpsCompassCubes()`      | Cardinal direction indicator cubes.                  |
| `VIS_COLORS`                   | Consistent color palette for visualizations.         |
| `disposeObject3D(obj)`         | Safe Three.js object disposal.                       |

### `utils/` — Logging & Helpers

| Export                                      | Description                                       |
| ------------------------------------------- | ------------------------------------------------- |
| `createLogger(channel)`                     | Channeled logger with level control.              |
| `getLogBuffer()` / `subscribeToLogs()`      | Inspect or subscribe to the in-memory log ring.   |
| `computeFusedPath(inputs)`                  | Compute a fused GPS+odometry path.                |
| `createFailureTracker(config)`              | Track failure rates with configurable thresholds. |
| `mapWithConcurrencyLimit(items, fn, limit)` | Async map with bounded concurrency.               |
| `formatFileSize(bytes)`                     | Human-readable file sizes.                        |
| `listFormatter(items)`                      | Human-friendly comma/and list formatting.         |

### `types/` — Shared Type Definitions

AR and geo type definitions (`DepthPoint`, `DepthSample`, `LatLong`, `KnownGeoAnchor`, …) used across modules.

### `licensing/` — Bundled Community Key

Re-exports `COMMUNITY_LICENSE_KEY` from the core library so that consumers can pass it explicitly if they need to. `createSlamAppStore` already uses it as the default.

## Design Principles

1. **No global singletons.** Everything is created via factories and passed explicitly.
2. **Store is the integration point.** Modules communicate through Redux state.
3. **Modules are optional.** Use `initAR` without `LeafletMapOverlay`. No forced coupling.
4. **Swappable implementations.** The `StorageBackend` interface lets you replace OPFS with IndexedDB or anything else.

## Development

```bash
cd GpsPlusSlamJs_AppFramework
pnpm install
pnpm test          # format + lint + typecheck + unit tests
pnpm run build     # build with tsdown
```

### Project Structure

```
src/
├── ar/             # WebXR session, capture, replay scene
├── sensors/        # GPS, orientation, permissions
├── state/          # createSlamAppStore, recording, replay, persistence middleware
├── storage/        # OPFS, ZIP export/import, StorageBackend
├── geo/            # H3 spatial indexing
├── visualization/  # Three.js markers, maps, camera helpers
├── utils/          # Logger, fused-path, concurrency, formatters
├── types/          # Shared type definitions
├── licensing/      # Bundled community license key
└── test-utils/     # Test helpers (browser mocks, ZIP helpers)
```

## License

This framework is licensed under **Apache 2.0** — see [LICENSE](LICENSE).

> **Note:** This package depends on [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js), which is a **closed-source, proprietary** library distributed via npm under a separate license. A community license key is bundled with the framework for frictionless evaluation. See the core library's EULA for usage terms.

## See Also

- [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js) — Core alignment algorithms (closed-source)
- [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/) — Smallest possible consumer of this framework
- [`GpsPlusSlamJs_RecorderApp`](../GpsPlusSlamJs_RecorderApp/) — Full-featured recording app built on this framework
