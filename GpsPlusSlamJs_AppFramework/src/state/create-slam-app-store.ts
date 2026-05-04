/**
 * `createSlamAppStore` — composable Redux store factory for AR+GPS apps.
 *
 * Introduced in Iter 1 of the AppFramework/RecorderApp boundary migration.
 * Wires the three library reducers (`gpsData`, `gpsElements`, `arElements`),
 * the framework's recording lifecycle slice, and the persistence middleware.
 *
 * Recorder-only state (routing screen, ref-points, scenario) is plugged in
 * by the consumer via `extraReducers` / `extraMiddleware`. The factory itself
 * never references those concepts so apps that don't need them (POI viewers,
 * navigation arrows, …) compose freely.
 *
 * The legacy `createRecorderStore` from `store.ts` is built on top of this
 * factory and will move out of the framework in Iter 1D.
 *
 * @see docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md — Iter 1
 */

import {
  configureStore,
  type Middleware,
  type Reducer,
  type ReducersMapObject,
} from '@reduxjs/toolkit';
import {
  gpsDataReducer,
  gpsElementsReducer,
  arElementsReducer,
  sanitizeForDevTools,
  validateLicenseKey,
  type RootState as LibraryRootState,
} from 'gps-plus-slam-js';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';
import type { StorageBackend } from '../storage/storage-backend';
import type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage';
import { recorderReducer, type RecorderState } from './recorder-slice';
import { createPersistenceMiddleware } from './persistence-middleware';

/**
 * Base shape produced by `createSlamAppStore` with no `extraReducers`.
 *
 * Library state (`gpsData` / `gpsElements` / `arElements`) plus the
 * framework recording slice (`recorder`).
 */
export interface SlamAppRootState extends LibraryRootState {
  recorder: RecorderState;
}

/** A bare-minimum middleware signature compatible with RTK's middleware list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlamAppMiddleware = Middleware<any, any, any>;

/**
 * Options for {@link createSlamAppStore}.
 */
export interface SlamAppStoreOptions<
  ExtraReducers extends ReducersMapObject = Record<string, never>,
> {
  /**
   * Persistence backend used to bridge Redux actions to durable storage.
   * Tests / replay paths should pass `NullStorageBackend`.
   */
  storageBackend: StorageBackend;

  /**
   * Caller-supplied reducers added alongside the framework's built-ins.
   * Use this seam to plug recorder slices (routing, refPoints, scenario)
   * or any app-specific state without forking the factory.
   */
  extraReducers?: ExtraReducers;

  /**
   * Caller-supplied middlewares appended after RTK defaults and the
   * persistence middleware.
   */
  extraMiddleware?: ReadonlyArray<SlamAppMiddleware>;

  /**
   * Invoked when the persistence middleware fails to durably write an action.
   */
  onWriteFailure?: (error: Error) => void;

  /**
   * Disables RTK's expensive dev-only middleware (Serializable / Immutable
   * checks). Default `true`; set `false` for high-throughput replay scenarios.
   */
  enableDevChecks?: boolean;

  /**
   * License key for the core library. Defaults to the bundled community key.
   * Apps with a paid license override here. Validation always runs and throws
   * on invalid / expired / empty keys.
   *
   * @see EULA.md §3 — License Key
   */
  licenseKey?: string;
}

/**
 * Combined root state: the framework's base state plus any caller-supplied
 * extras. Generic so consumers get exact typing for the slices they add.
 */
export type SlamAppCombinedState<
  ExtraReducers extends ReducersMapObject = Record<never, never>,
> = SlamAppRootState & {
  [K in keyof ExtraReducers]: ExtraReducers[K] extends Reducer<infer S>
    ? S
    : never;
};

/**
 * The store object returned by {@link createSlamAppStore}.
 *
 * Wraps RTK's store and adds storage-delegation helpers so consumers can
 * issue frame / metadata writes without holding a separate handle to the
 * `StorageBackend`.
 */
export interface SlamAppStore<
  ExtraReducers extends ReducersMapObject = Record<string, never>,
> {
  getState: () => SlamAppCombinedState<ExtraReducers>;
  dispatch: ReturnType<typeof configureStore>['dispatch'];
  subscribe: (listener: () => void) => () => void;
  /** Persist a captured camera frame via the configured backend. */
  writeFrame: (blob: Blob, index: number) => Promise<void>;
  /** Persist session metadata (`session.json`) via the configured backend. */
  writeSessionMetadata: (metadata: OpfsSessionMetadata) => Promise<void>;
}

/**
 * Build a Redux store wired with library + recording slices, persistence
 * middleware, and any caller-supplied extras. See module docstring for the
 * design rationale.
 */
export function createSlamAppStore<
  ExtraReducers extends ReducersMapObject = Record<string, never>,
>(options: SlamAppStoreOptions<ExtraReducers>): SlamAppStore<ExtraReducers> {
  const {
    storageBackend,
    extraReducers,
    extraMiddleware,
    onWriteFailure,
    enableDevChecks = true,
    licenseKey = COMMUNITY_LICENSE_KEY,
  } = options;

  validateLicenseKey(licenseKey);

  const reducer = {
    gpsData: gpsDataReducer,
    gpsElements: gpsElementsReducer,
    arElements: arElementsReducer,
    recorder: recorderReducer,
    ...(extraReducers ?? ({} as ExtraReducers)),
  };

  const store = configureStore({
    reducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: enableDevChecks,
        immutableCheck: enableDevChecks,
      }).concat(
        createPersistenceMiddleware({ storageBackend, onWriteFailure }),
        ...(extraMiddleware ?? [])
      ),
    devTools: {
      actionSanitizer: sanitizeForDevTools,
      stateSanitizer: sanitizeForDevTools,
    },
  });

  return {
    getState: () => store.getState() as SlamAppCombinedState<ExtraReducers>,
    dispatch: store.dispatch,
    subscribe: (listener: () => void) => store.subscribe(listener),
    writeFrame: (blob: Blob, index: number) =>
      storageBackend.writeFrame(blob, index),
    writeSessionMetadata: (metadata: OpfsSessionMetadata) =>
      storageBackend.writeSessionMetadata(metadata),
  };
}
