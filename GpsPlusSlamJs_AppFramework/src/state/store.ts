/**
 * Redux Store for Recorder App
 *
 * Uses Redux Toolkit's configureStore to combine all reducers (library +
 * app-level) into a single store. Action persistence during recording is
 * handled by the persistence middleware.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * The library's recordGpsEvent action captures paired AR+GPS data
 * that feeds directly into the alignment algorithm.
 *
 * Migration note (§4 — architecture-observations-consolidated.md):
 * Previously the store used a manual wrapper pattern with action.type.startsWith()
 * prefix matching to route actions between a library store and local state
 * variables. This has been replaced with a single configureStore call that
 * combines all 6 reducers declaratively.
 */

import { configureStore } from '@reduxjs/toolkit';
import {
  gpsDataReducer,
  gpsElementsReducer,
  arElementsReducer,
  sanitizeForDevTools,
  validateLicenseKey,
  type RootState as LibraryRootState,
} from 'gps-plus-slam-js';
import type { StorageBackend } from '../storage/storage-backend';
import { recorderReducer, type RecorderState } from './recorder-slice';
import { refPointsReducer, type RefPointsState } from './ref-points-slice';
import { routingReducer, type RoutingState } from './routing-slice';
import type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage';
import { OpfsStorageBackend } from '../storage/opfs-storage-backend';
import { createPersistenceMiddleware } from './persistence-middleware';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';

// Re-export for convenience
export type { RecordingOptions } from './recording-options';

// Re-export recorder-slice types and actions
export {
  type RecorderState,
  type SessionMetadata,
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
  setCurrentScenarioName,
} from './recorder-slice';

// Re-export library actions and types that the app needs
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

// --- Recorder-specific Types ---

// Re-export RefPointMark from ref-point-loader for backwards compatibility
export { type RefPointMark } from '../storage/ref-point-loader';

export type { DepthPoint, DepthSample } from '../types/ar-types';

// Re-export ref-points actions for convenience
export {
  setImportedRefPoints,
  incrementRefPointUsage,
  clearSessionRefPointUsage,
  setPriorRefPointMarks,
  addCurrentRefPointMark,
  clearCurrentRefPointMarks,
  resetRefPointsState,
  selectCachedKnownRefPoints,
} from './ref-points-slice';

export type { RefPointsState } from './ref-points-slice';

// --- Combined Store ---

/**
 * Combined root state: library state + app-level state.
 * All 6 reducers (3 library + 3 app) are managed by a single configureStore.
 */
export interface CombinedRootState extends LibraryRootState {
  recorder: RecorderState;
  refPoints: RefPointsState;
  routing: RoutingState;
}

/**
 * Store interface for the recorder app.
 *
 * Wraps the Redux Toolkit store and adds storage delegation methods
 * (writeFrame, writeSessionMetadata) that route through the injected
 * StorageBackend abstraction.
 */
export interface RecorderStore {
  /** Get combined state (library + app) */
  getState: () => CombinedRootState;
  /** Dispatch actions to the unified store */
  dispatch: ReturnType<typeof configureStore>['dispatch'];
  /** Subscribe to state changes */
  subscribe: (listener: () => void) => () => void;
  /**
   * Persist a captured camera frame via the StorageBackend.
   * A1 fix: routes through the abstraction so NullStorageBackend suppresses
   * writes during replay/testing.
   */
  writeFrame: (blob: Blob, index: number) => Promise<void>;
  /**
   * Persist session metadata (session.json) via the StorageBackend.
   * A1 fix: routes through the abstraction so NullStorageBackend suppresses
   * writes during replay/testing.
   */
  writeSessionMetadata: (metadata: OpfsSessionMetadata) => Promise<void>;
}

/**
 * Options for creating the recorder store.
 */
export interface RecorderStoreOptions {
  /**
   * Callback invoked when a write operation fails during persistence.
   * User Feedback Issue #1 Part B: Used to show toast notifications.
   */
  onWriteFailure?: (error: Error) => void;

  /**
   * StorageBackend to use for action persistence.
   * Defaults to OpfsStorageBackend (production OPFS).
   * Pass NullStorageBackend for tests or replay mode.
   *
   * Finding F2: Decouples the store from the concrete OPFS dependency.
   */
  storageBackend?: StorageBackend;

  /**
   * When false, disables expensive Redux dev-only middleware
   * (SerializableStateInvariantMiddleware, ImmutableStateInvariantMiddleware).
   * Set to false in high-throughput replay scenarios such as investigation tests
   * to avoid excessive per-dispatch overhead.
   * Default: true (dev checks enabled).
   */
  enableDevChecks?: boolean;

  /**
   * License key for the core library.
   * Validated via Ed25519 signature verification and expiry check.
   *
   * Defaults to the bundled `COMMUNITY_LICENSE_KEY` so example apps work out
   * of the box. Pass a paid license to override. The library is never usable
   * without a valid key — invalid, empty, or expired keys throw.
   *
   * @see EULA.md §3 — License Key
   */
  licenseKey?: string;
}

// Re-export for convenience so consumers don't need a separate import
export type { StorageBackend } from '../storage/storage-backend';
export type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage';

/**
 * Create the recorder store using Redux Toolkit's configureStore.
 *
 * Combines all 6 reducers (3 library: gpsData, gpsElements, arElements;
 * 3 app: recorder, refPoints, routing) into a single store with the
 * persistence middleware for action recording.
 *
 * @param options - Optional configuration including callbacks
 */
export function createRecorderStore(
  options: RecorderStoreOptions = {}
): RecorderStore {
  const { onWriteFailure } = options;
  const storageBackend: StorageBackend =
    options.storageBackend ?? new OpfsStorageBackend();
  const enableDevChecks = options.enableDevChecks ?? true;

  // Default to the bundled community key so example apps work without wiring.
  // Apps can override with a paid key. The library is never usable without a
  // valid key — validation always runs and throws on invalid/expired/empty.
  const licenseKey = options.licenseKey ?? COMMUNITY_LICENSE_KEY;
  validateLicenseKey(licenseKey);

  const store = configureStore({
    reducer: {
      gpsData: gpsDataReducer,
      gpsElements: gpsElementsReducer,
      arElements: arElementsReducer,
      recorder: recorderReducer,
      refPoints: refPointsReducer,
      routing: routingReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: enableDevChecks,
        immutableCheck: enableDevChecks,
      }).concat(
        createPersistenceMiddleware({ storageBackend, onWriteFailure })
      ),
    devTools: {
      actionSanitizer: sanitizeForDevTools,
      stateSanitizer: sanitizeForDevTools,
    },
  });

  return {
    getState: () => store.getState(),
    // Redux store methods are already bound — direct assignment is safe
    dispatch: store.dispatch,
    subscribe: (listener: () => void) => store.subscribe(listener),
    writeFrame: (blob: Blob, index: number) =>
      storageBackend.writeFrame(blob, index),
    writeSessionMetadata: (metadata: OpfsSessionMetadata) =>
      storageBackend.writeSessionMetadata(metadata),
  };
}

export type RootState = CombinedRootState;
export type AppDispatch = RecorderStore['dispatch'];
