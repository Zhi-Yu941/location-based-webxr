/**
 * State module — Combined store factory, recording coordinator, replay engine, store subscribers.
 */

// --- recorder-slice (recorder session state, lives in framework so persistence
//     middleware can read it; the store factory itself is in the recorder app). ---
export {
  type RecorderState,
  type SessionMetadata,
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
  recorderReducer,
} from './recorder-slice.js';

// --- ref-points-slice — moved to recorder app in Iter 3 of the
//     AppFramework / RecorderApp boundary migration. Recorder consumers
//     import these from their own local slice now. ---

// --- library re-exports (kept here for backwards-compat with existing
//     `gps-plus-slam-app-framework/state` imports). ---
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
export type { DepthPoint, DepthSample } from '../types/ar-types.js';
export type { StorageBackend } from '../storage/storage-backend.js';
export type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage.js';

// --- recording-coordinator ---
export {
  type RecordingCoordinatorConfig,
  updateDeviceOrientation,
  getLastDeviceOrientation,
  eulerToQuaternion,
  resetCoordinatorState,
  extractOdomPosition,
  extractOdomRotation,
  buildRawGpsPoint,
  buildRecordGpsEventPayload,
  createGpsPositionHandler,
} from './recording-coordinator.js';

// --- recording-options ---
export {
  type RecordingOptionsInput,
  type DepthCaptureOptions,
  type ImageCaptureOptions,
  STORAGE_KEY,
  DEFAULT_RECORDING_OPTIONS,
  DEPTH_CONSTRAINTS,
  IMAGE_CONSTRAINTS,
  validateDepthOptions,
  validateImageOptions,
  validateRecordingOptions,
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
  cloneRecordingOptions,
} from './recording-options.js';

// --- recording-replayer ---
export { replayRecording } from './recording-replayer.js';
export type { ReplayRecordingOptions } from './recording-replayer.js';

// --- persistence-middleware ---
export {
  createPersistenceMiddleware,
  type PersistenceMiddlewareOptions,
} from './persistence-middleware.js';

// --- create-slam-app-store ---
export {
  createSlamAppStore,
  type SlamAppStore,
  type SlamAppStoreOptions,
  type SlamAppRootState,
  type SlamAppCombinedState,
  type SlamAppMiddleware,
} from './create-slam-app-store.js';

// --- replay-engine ---
export {
  DEFAULT_MAX_DELAY_MS,
  type ReplayState,
  type ProgressCallback,
  type CompleteCallback,
  type ErrorCallback,
  type ReplayAction,
  extractActionTimestamp,
  computeInterActionDelay,
  ReplayEngine,
} from './replay-engine.js';

// --- store-subscribers ---
export {
  type SubscribableStore,
  type StoreSubscriberDeps,
  wireStoreSubscribers,
} from './store-subscribers.js';

// --- subscribe-to-selector ---
export { subscribeToSelector } from './subscribe-to-selector.js';

// --- app-selectors ---
export {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectOdometryRotations,
  selectZeroReference,
  selectReferencePoints,
} from './app-selectors.js';
