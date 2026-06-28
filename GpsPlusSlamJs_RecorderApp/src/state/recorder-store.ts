/**
 * Recorder Store — composable store for the recorder app.
 *
 * Wraps the framework's `createSlamAppStore` factory and supplies the
 * recorder-specific extras (routing, refPoints — until refPoints moves
 * out in Iter 3, scenario in Iter 1D). The framework no longer ships a
 * `createRecorderStore`; that wrapper now lives in the consuming app.
 *
 * Re-exports everything the recorder app previously imported from
 * `gps-plus-slam-app-framework/state/store` so consumer call sites only
 * need a path swap, not a per-symbol audit.
 *
 * Iter 1 of the [AppFramework / RecorderApp boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
 *
 * NOTE: This module routes every core-library symbol through
 * `gps-plus-slam-app-framework/state` (which itself re-exports the
 * curated public surface of `gps-plus-slam-js`). The recorder app no
 * longer takes a direct dependency on `gps-plus-slam-js` — see
 * [2026-05-05-recorder-app-drop-direct-core-dep-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-05-recorder-app-drop-direct-core-dep-plan.md).
 * The `RawDeviceOrientation` re-export deliberately uses the `state`
 * subpath rather than the framework root barrel because the root
 * barrel exposes a structurally different (nullable) sensor variant
 * from `sensors/gps.ts`. See §2.2.1 of that plan.
 */

import { type LibraryRootState } from 'gps-plus-slam-app-framework/core';
import {
  createSlamAppStore,
  type SlamAppStore,
} from 'gps-plus-slam-app-framework/state/create-slam-app-store';
import {
  slicePrefixOf,
  qrDetectedReducer,
  recordQrDetection,
  setQrMaxHistory,
  type QrDetectedState,
} from 'gps-plus-slam-app-framework/state';
import {
  addRefPointEntry,
  refPointsReducer,
  type RefPointsState,
} from './ref-points-slice';
import type { RecordingState } from 'gps-plus-slam-app-framework/state/recording-slice';
import type { TrackingSliceState } from 'gps-plus-slam-app-framework/state/tracking-slice';
import type { TrackingQualitySliceState } from 'gps-plus-slam-app-framework';
import type { StorageBackend } from 'gps-plus-slam-app-framework/storage/storage-backend';
import { ScenarioWrappingStorageBackend } from '../storage/scenario-storage';
import type { SessionMetadata as OpfsSessionMetadata } from 'gps-plus-slam-app-framework/storage/opfs-storage';
import { routingReducer, type RoutingState } from './routing-slice';
import { scenarioReducer, type ScenarioState } from './scenario-slice';

// --- Re-exports for backwards compatibility with consumers that previously
// imported these from `gps-plus-slam-app-framework/state/store`. The framework
// still owns the underlying definitions; this module just makes the recorder
// import surface stable while pieces migrate. ---

export {
  type RecordingState,
  type SessionMetadata,
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
} from 'gps-plus-slam-app-framework/state/recording-slice';

export {
  setCurrentScenarioName,
  resetCurrentScenarioName,
  type ScenarioState,
} from './scenario-slice';

// The `qrDetected` slice surface the recorder app (live-QR wiring + tests) needs.
// Re-exported here so consumers import the QR slice from the same store module as
// every other recorder action. The slice itself lives in the framework.
export {
  recordQrDetection,
  setQrMaxHistory,
  selectSolvedQrPose,
  selectLatestQrDetection,
  clearQrMarker,
  clearAllQrMarkers,
  type QrDetectionEntry,
  type QrDetectedState,
} from 'gps-plus-slam-app-framework/state';
export type {
  RawQrObservation,
  DeriveQrPoseDeps,
} from 'gps-plus-slam-app-framework/ar';

export {
  setZeroPos,
  recordGpsEvent,
  add2dImage,
  calcRelativeCoordsInMeters,
} from 'gps-plus-slam-app-framework/state';

export type {
  LatLong,
  GpsPoint,
  RawGpsPoint,
  RawDeviceOrientation,
  RecordGpsEventPayload,
} from 'gps-plus-slam-app-framework/state';

export { type RefPointMark } from '../storage/ref-point-loader';
export type {
  DepthPoint,
  DepthSample,
} from 'gps-plus-slam-app-framework/types/ar-types';

export type { RefPointsState } from './ref-points-slice';

export type { RecordingOptions } from 'gps-plus-slam-app-framework/state/recording-options';
export type { StorageBackend } from 'gps-plus-slam-app-framework/storage/storage-backend';
export type { SessionMetadata as OpfsSessionMetadata } from 'gps-plus-slam-app-framework/storage/opfs-storage';

// --- Recorder-owned types ---

/**
 * Combined root state: library state + recorder slices (recording, refPoints,
 * routing, scenario). Composed by `createRecorderStore`.
 */
export interface CombinedRootState extends LibraryRootState {
  recording: RecordingState;
  tracking: TrackingSliceState;
  trackingQuality: TrackingQualitySliceState;
  refPoints: RefPointsState;
  routing: RoutingState;
  scenario: ScenarioState;
  qrDetected: QrDetectedState;
}

/**
 * Per-marker live-history cap the recorder opts into (D-B refinement): a longer
 * debug trail than the framework default (32) WITHOUT moving that shared default
 * for one consumer. The action LOG still captures every detection regardless of
 * the cap; this only bounds the live reduced state the debug viz reads.
 */
export const RECORDER_QR_MAX_HISTORY = 100;

/**
 * Recorder store handle. Same shape as before the Iter 1 split — the
 * framework's `SlamAppStore` already provides this surface; we just narrow
 * the state type to `CombinedRootState` for recorder consumers.
 */
export interface RecorderStore {
  getState: () => CombinedRootState;
  dispatch: SlamAppStore['dispatch'];
  subscribe: (listener: () => void) => () => void;
  writeFrame: (blob: Blob, index: number) => Promise<void>;
  writeSessionMetadata: (metadata: OpfsSessionMetadata) => Promise<void>;
}

export interface RecorderStoreOptions {
  /** Show toast / surface errors on persistence failures. */
  onWriteFailure?: (error: Error) => void;
  /** Override default OPFS backend (tests / replay → NullStorageBackend). */
  storageBackend?: StorageBackend;
  /** Disable RTK dev-only middleware in high-throughput replay scenarios. */
  enableDevChecks?: boolean;
  /** Override the bundled community license key. */
  licenseKey?: string;
  /**
   * Compass alignment opt-ins (Phase-4). Each is forwarded to `createSlamAppStore`,
   * which enables it on the `gpsData` slice once that slice exists (after the
   * first `setZeroPos`). Sourced from `RecordingOptions.compassDebug` so the
   * operator toggles them in the recorder settings. Defaults follow the framework:
   * **Stage 0 (`enableCompassColdStartOverride`) defaults ON** (field-validated),
   * Stage C + the consistency gate default OFF (field-gated). NB: the resulting
   * `gpsData` actions persist into the recording (replay re-enables them) — turn
   * Stage 0 OFF for §6a calibration captures so the compass behaviour is unmodified.
   */
  enableCompassColdStartOverride?: boolean;
  enableCompassRotationPrior?: boolean;
  enableCompassWebXRConsistency?: boolean;
}

/**
 * Construct the recorder store. Delegates to the framework factory and
 * supplies recorder-only slices via `extraReducers`.
 */
export function createRecorderStore(
  options: RecorderStoreOptions = {}
): RecorderStore {
  const storageBackend: StorageBackend =
    options.storageBackend ?? new ScenarioWrappingStorageBackend();

  const store = createSlamAppStore({
    storageBackend,
    onWriteFailure: options.onWriteFailure,
    enableDevChecks: options.enableDevChecks,
    licenseKey: options.licenseKey,
    enableCompassColdStartOverride: options.enableCompassColdStartOverride,
    enableCompassRotationPrior: options.enableCompassRotationPrior,
    enableCompassWebXRConsistency: options.enableCompassWebXRConsistency,
    // Persist the recorder-owned refPoints slice and the framework qrDetected
    // slice. Derived from each slice's own action type (never a literal) so a
    // rename can't silently drop data from recordings — see the 2026-05-28
    // refPointsV2/ regression. `slicePrefixOf(recordQrDetection.type)` is
    // `qrDetected`, so every `qrDetected/*` action is whitelisted (matching the
    // refPoints pattern); only `recordQrDetection` is dispatched during recording.
    persistedExtraPrefixes: [
      slicePrefixOf(addRefPointEntry.type),
      slicePrefixOf(recordQrDetection.type),
    ],
    extraReducers: {
      refPoints: refPointsReducer,
      routing: routingReducer,
      scenario: scenarioReducer,
      qrDetected: qrDetectedReducer,
    },
  });

  // Opt into a longer live QR history than the shared framework default (D-B).
  // Dispatched at setup, BEFORE any recording starts, so it is never persisted;
  // the replay store (also built here) gets the same cap so live == replay.
  store.dispatch(setQrMaxHistory(RECORDER_QR_MAX_HISTORY));

  return {
    getState: () => store.getState(),
    dispatch: store.dispatch,
    subscribe: store.subscribe,
    writeFrame: store.writeFrame,
    writeSessionMetadata: store.writeSessionMetadata,
  };
}

export type RootState = CombinedRootState;
export type AppDispatch = RecorderStore['dispatch'];
