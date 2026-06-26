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
  setZeroPos,
  setColdStartOverrideEnabled,
  type RootState as LibraryRootState,
} from 'gps-plus-slam-js';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';
import type { StorageBackend } from '../storage/storage-backend';
import type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage';
import {
  recordingReducer,
  recordWriteFailure,
  type RecordingState,
} from './recording-slice';
import { trackingReducer, type TrackingSliceState } from './tracking-slice';
import {
  trackingQualityReducer,
  createTrackingQualityListenerMiddleware,
  type TrackingQualitySliceState,
  type TrackingQualityOptions,
} from './tracking-quality';
import {
  createPersistenceMiddleware,
  slicePrefixOf,
} from './persistence-middleware';

/**
 * Slice prefixes the framework always persists, derived from the actual
 * library / framework action creators (never hand-typed). A rename of the
 * `gpsData` or `recording` slice therefore propagates here automatically
 * instead of silently dropping that slice's actions from recordings.
 */
const BUILTIN_PERSISTED_PREFIXES: readonly string[] = [
  slicePrefixOf(setZeroPos.type), // library `gpsData` slice
  slicePrefixOf(recordWriteFailure.type), // framework `recording` slice
];

/**
 * Base shape produced by `createSlamAppStore` with no `extraReducers`.
 *
 * Library state (`gpsData` / `gpsElements` / `arElements`) plus the
 * framework recording slice (`recording`).
 */
export interface SlamAppRootState extends LibraryRootState {
  recording: RecordingState;
  tracking: TrackingSliceState;
  trackingQuality: TrackingQualitySliceState;
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
   * Additional slice prefixes to persist beyond the framework built-ins
   * (`gpsData`, `recording`). Pass caller-owned slice names derived from
   * the slice itself — e.g. `slicePrefixOf(addRefPointEntry.type)` or
   * `refPointsSlice.name` — never a hand-typed literal, so a rename can
   * never silently drop the slice's actions from recordings.
   */
  persistedExtraPrefixes?: readonly string[];

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

  /**
   * Optional overrides for the tracking-quality reporter
   * (matrix-history size, residual window, thresholds, etc.).
   *
   * @see docs/2026-05-16-tracking-quality-metrics-plan.md
   */
  trackingQualityOptions?: Partial<TrackingQualityOptions>;

  /**
   * **Debug/experiment flag** — enable the library's Phase-4 Stage-0 cold-start
   * compass yaw override. When `true`, the factory dispatches
   * `setColdStartOverrideEnabled(true)` the first time `gpsData` becomes
   * non-null (i.e. right after the first `setZeroPos`, since the flag lives on
   * that slice and cannot be set before it exists). Default `false` ⇒ the core
   * solve is byte-identical to today. Keep OFF until the override's thresholds
   * are re-tuned on field data.
   *
   * Note: the resulting `setColdStartOverrideEnabled` action is a `gpsData`
   * action and is therefore persisted into recordings, so a replay re-enables
   * the override. Collect field-calibration recordings with this OFF.
   *
   * @see GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md
   */
  enableCompassColdStartOverride?: boolean;
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
    persistedExtraPrefixes,
    onWriteFailure,
    enableDevChecks = true,
    licenseKey = COMMUNITY_LICENSE_KEY,
    trackingQualityOptions,
    enableCompassColdStartOverride = false,
  } = options;

  validateLicenseKey(licenseKey);

  const reducer = {
    gpsData: gpsDataReducer,
    gpsElements: gpsElementsReducer,
    arElements: arElementsReducer,
    recording: recordingReducer,
    tracking: trackingReducer,
    trackingQuality: trackingQualityReducer,
    ...(extraReducers ?? ({} as ExtraReducers)),
  };

  const trackingQualityMiddleware = createTrackingQualityListenerMiddleware(
    trackingQualityOptions
  );

  const store = configureStore({
    reducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: enableDevChecks,
        immutableCheck: enableDevChecks,
      })
        .prepend(trackingQualityMiddleware)
        .concat(
          createPersistenceMiddleware({
            storageBackend,
            onWriteFailure,
            persistedPrefixes: [
              ...BUILTIN_PERSISTED_PREFIXES,
              ...(persistedExtraPrefixes ?? []),
            ],
          }),
          ...(extraMiddleware ?? [])
        ),
    devTools: {
      actionSanitizer: sanitizeForDevTools,
      stateSanitizer: sanitizeForDevTools,
    },
  });

  // Debug/experiment opt-in for the Stage-0 cold-start override. The flag lives
  // on the `gpsData` slice, which is `null` until the first `setZeroPos`, so we
  // enable it once that slice exists. A self-removing subscription keeps this a
  // one-shot with no lingering listener.
  if (enableCompassColdStartOverride) {
    let enabled = false;
    const tryEnable = (): void => {
      if (enabled) return;
      if ((store.getState() as LibraryRootState).gpsData !== null) {
        // Set the guard BEFORE dispatching: the dispatch notifies subscribers
        // synchronously and would otherwise re-enter this and recurse.
        enabled = true;
        store.dispatch(setColdStartOverrideEnabled(true));
      }
    };
    tryEnable();
    if (!enabled) {
      const unsubscribe = store.subscribe(() => {
        tryEnable();
        if (enabled) unsubscribe();
      });
    }
  }

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
