# store.ts

## Purpose

Redux store factory for the Recorder App. Uses Redux Toolkit's `configureStore` to combine 6 reducers (3 library + 3 app) into a single store. Action persistence during recording is handled by the extracted [persistence middleware](persistence-middleware.ts.md).

**ARCHITECTURE NOTE:** See `docs/architecture-ar-gps-pose-separation.md` for the critical GPS+AR pairing requirement.

**Migration (§4):** Previously used a manual wrapper with `action.type.startsWith()` prefix matching to route actions between a library store and local state variables. Replaced with declarative `configureStore` (2026-04-07). See [consolidated observations](../../../GpsPlusSlamJs_Docs/docs/2026-04-07-architecture-observations-consolidated.md) §4.

## Public API

### Types

| Type                   | Description                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `CombinedRootState`    | Union of `LibraryRootState` + `RecorderState` + `RefPointsState` + `RoutingState`              |
| `RecorderStore`        | Store interface with `getState`, `dispatch`, `subscribe`, `writeFrame`, `writeSessionMetadata` |
| `RecorderStoreOptions` | Options for store creation (storageBackend, onWriteFailure, enableDevChecks, licenseKey)       |
| `RootState`            | Alias for `CombinedRootState`                                                                  |
| `AppDispatch`          | Dispatch type for the combined store                                                           |

> **Re-exports:** Types and action creators from `recorder-slice.ts`, `ref-points-slice.ts`, `routing-slice.ts`, and `gps-plus-slam-js` are re-exported for consumer convenience. This includes `RawGpsPoint`, `RawDeviceOrientation`, `buildRawGpsPoint`, and `eulerToQuaternion` from the library.

### Functions

| Export                  | Type                                                | Description               |
| ----------------------- | --------------------------------------------------- | ------------------------- |
| `createRecorderStore()` | `(options?: RecorderStoreOptions) => RecorderStore` | Create new store instance |

### Store Instance Methods

| Method                 | Signature                                    | Description                                            |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `writeFrame`           | `(blob: Blob, index: number) => Promise`     | Persist a camera frame via the StorageBackend (A1 fix) |
| `writeSessionMetadata` | `(metadata: OpfsSessionMetadata) => Promise` | Persist session.json via the StorageBackend (A1 fix)   |
| `dispatch`             | `(action) => void`                           | Dispatch to the unified Redux store                    |
| `getState`             | `() => CombinedRootState`                    | Get combined state (all 6 slices)                      |
| `subscribe`            | `(listener) => unsubscribe`                  | Subscribe to state changes                             |

### Options (`RecorderStoreOptions`)

| Option            | Type              | Default                 | Description                                                                                                                                                                              |
| ----------------- | ----------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storageBackend`  | `StorageBackend`  | `OpfsStorageBackend`    | Persistence backend (F2 abstraction)                                                                                                                                                     |
| `onWriteFailure`  | `(Error) => void` | -                       | Callback on write failure (for toast)                                                                                                                                                    |
| `enableDevChecks` | `boolean`         | `true`                  | Enable Redux dev-only checks (disable for replay)                                                                                                                                        |
| `licenseKey`      | `string`          | `COMMUNITY_LICENSE_KEY` | Library license key (Ed25519 verified). Defaults to the bundled community key re-exported from the core lib's `gps-plus-slam-js/community-license-key` sub-path. Validation always runs — invalid, empty, or expired keys throw. |

## Architecture

The store combines 6 reducers from two sources:

**Library reducers** (from `gps-plus-slam-js`): `gpsData`, `gpsElements`, `arElements`
**App reducers**: `recorder` ([recorder-slice.ts](recorder-slice.ts.md)), `refPoints` ([ref-points-slice.ts](ref-points-slice.ts.md)), `routing` ([routing-slice.ts](routing-slice.ts.md))

Persistence is handled by the [persistence middleware](persistence-middleware.ts.md), which writes qualifying actions (`gpsData/*`, `recorder/*`) to the `StorageBackend` during active recording. The `writeFrame()` and `writeSessionMetadata()` methods delegate directly to the same backend so `NullStorageBackend` fully suppresses all I/O.

DevTools sanitizers from the library (`sanitizeForDevTools`) are applied for safe Redux DevTools inspection of large state.

## Invariants & Assumptions

- **GPS triggers recording** — AR and GPS are always paired in `recordGpsEvent`
- Actions are persisted in order with sequential index (1-based, per-instance)
- `writeAction()` is fire-and-forget (errors logged but not blocking)
- State is not persisted — only actions (event sourcing pattern)
- Each `createRecorderStore()` creates its own persistence middleware instance with an independent `actionIndex` counter (Bug 10 fix)
- License key validation happens once at store creation (throws on invalid/expired)

## Examples

```typescript
import {
  createRecorderStore,
  startSession,
  recordGpsEvent,
} from './state/store';

const store = createRecorderStore();

store.dispatch(
  startSession({
    scenarioName: 'Park',
    sessionName: 'run-1',
    startTime: Date.now(),
  })
);

store.dispatch(
  recordGpsEvent({
    arPose: { position: [1.2, 0.5, -3.1], rotation: [0, 0, 0, 1] },
    gpsReading: { lat: 48.1, lon: 11.5, accuracy: 5, heading: 90 },
    timestamp: Date.now(),
  })
);
```

## Tests

- `store.test.ts` — 37 unit tests including state transitions, persistence, write failure tracking, StorageBackend injection, A1 writeFrame/writeSessionMetadata delegation, currentScenarioName management, and DevTools sanitizer integration
- `persistence-middleware.test.ts` — 13 tests for the extracted persistence middleware
- `ref-points-slice.test.ts` — 12 tests for the ref-points Redux slice
- `action-schema.test.ts` — 6 tests validating action structure
