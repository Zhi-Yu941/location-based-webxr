/**
 * Recorder Store â€” composable store for the recorder app.
 *
 * Wraps the framework's `createSlamAppStore` factory and supplies the
 * recorder-specific extras (routing, refPoints â€” until refPoints moves
 * out in Iter 3, scenario in Iter 1D). The framework no longer ships a
 * `createRecorderStore`; that wrapper now lives in the consuming app.
 *
 * Re-exports everything the recorder app previously imported from
 * `gps-plus-slam-app-framework/state/store` so consumer call sites only
 * need a path swap, not a per-symbol audit.
 *
 * Iter 1 of the [AppFramework / RecorderApp boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
 *
 * NOTE: This module intentionally re-exports symbols from `gps-plus-slam-js`
 * directly so consumers have a single recorder-app import surface for both
 * library and framework symbols. The repo-wide `no-restricted-imports` rule
 * funnels app code through `gps-plus-slam-app-framework/core`; this file is
 * the recorder-app analogue of that curated barrel and is exempted below.
 */
/* eslint-disable no-restricted-imports -- recorder-app curated re-export surface; see file header */

import { type RootState as LibraryRootState } from 'gps-plus-slam-js';
import {
  createSlamAppStore,
  type SlamAppStore,
} from 'gps-plus-slam-app-framework/state/create-slam-app-store';
import {
  refPointsReducer,
  type RefPointsState,
} from './ref-points-slice';
import type { RecordingState } from 'gps-plus-slam-app-framework/state/recording-slice';
import type { StorageBackend } from 'gps-plus-slam-app-framework/storage/storage-backend';
import { OpfsStorageBackend } from 'gps-plus-slam-app-framework/storage/opfs-storage-backend';
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

export {
  setZeroPos,
  recordGpsEvent,
  add2dImage,
  markReferencePoint,
  calcRelativeCoordsInMeters,
} from 'gps-plus-slam-js';

export type {
  LatLong,
  GpsPoint,
  RawGpsPoint,
  RawDeviceOrientation,
  RecordGpsEventPayload,
  MarkReferencePointPayload,
} from 'gps-plus-slam-js';

export { type RefPointMark } from '../storage/ref-point-loader';
export type {
  DepthPoint,
  DepthSample,
} from 'gps-plus-slam-app-framework/types/ar-types';

export {
  setImportedRefPoints,
  incrementRefPointUsage,
  clearSessionRefPointUsage,
  setPriorRefPointMarks,
  addCurrentRefPointMark,
  clearCurrentRefPointMarks,
  resetRefPointsState,
  selectCachedKnownRefPoints,
  type RefPointsState,
} from './ref-points-slice';

export type { RecordingOptions } from 'gps-plus-slam-app-framework/state/recording-options';
export type { StorageBackend } from 'gps-plus-slam-app-framework/storage/storage-backend';
export type { SessionMetadata as OpfsSessionMetadata } from 'gps-plus-slam-app-framework/storage/opfs-storage';

// --- Recorder-owned types ---

/**
 * Combined root state: library state + recorder slices (recorder, refPoints,
 * routing). Composed by `createRecorderStore`.
 */
export interface CombinedRootState extends LibraryRootState {
  recorder: RecordingState;
  refPoints: RefPointsState;
  routing: RoutingState;
  scenario: ScenarioState;
}

/**
 * Recorder store handle. Same shape as before the Iter 1 split â€” the
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
  /** Override default OPFS backend (tests / replay â†’ NullStorageBackend). */
  storageBackend?: StorageBackend;
  /** Disable RTK dev-only middleware in high-throughput replay scenarios. */
  enableDevChecks?: boolean;
  /** Override the bundled community license key. */
  licenseKey?: string;
}

/**
 * Construct the recorder store. Delegates to the framework factory and
 * supplies recorder-only slices via `extraReducers`.
 */
export function createRecorderStore(
  options: RecorderStoreOptions = {}
): RecorderStore {
  const storageBackend: StorageBackend =
    options.storageBackend ?? new OpfsStorageBackend();

  const store = createSlamAppStore({
    storageBackend,
    onWriteFailure: options.onWriteFailure,
    enableDevChecks: options.enableDevChecks,
    licenseKey: options.licenseKey,
    extraReducers: {
      refPoints: refPointsReducer,
      routing: routingReducer,
      scenario: scenarioReducer,
    },
  });

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
