/**
 * gps-plus-slam-app-framework
 *
 * Reusable AR+GPS app framework layer.
 *
 * RECOMMENDED: Import from subpaths for clarity and to avoid name conflicts:
 *   import { initAR } from 'gps-plus-slam-app-framework/ar';
 *   import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
 *
 * This root barrel re-exports conflict-free names for convenience.
 * Names that collide across submodules (StorageBackend, SessionMetadata,
 * RefPointMark, DepthPoint, DepthSample) should be imported from their
 * specific subpath.
 */

// Modules with no cross-barrel naming conflicts
export * from './ar/index.js';
export * from './sensors/index.js';
export * from './geo/index.js';
export * from './utils/index.js';
export * from './types/index.js';

// Modules with potential name conflicts — selective re-exports
// State: omit types also exported by storage/types (StorageBackend, DepthPoint, etc.)
export {
  type RecordingState,
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
  setZeroPos,
  recordGpsEvent,
  add2dImage,
  calcRelativeCoordsInMeters,
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
  replayRecording,
  recordingReducer,
  type TrackingPhase,
  type TrackingSliceState,
  type PoseReceivedPayload,
  poseReceived,
  poseLost,
  originReset,
  resetTracking,
  clearLastRestartedPayload,
  trackingReducer,
  selectTrackingPhase,
  selectLastValidPose,
  selectLostFrameCount,
  selectLastRestartedPayload,
  selectLastSensorOrientation,
  createSlamAppStore,
  type SlamAppStore,
  type SlamAppStoreOptions,
  type SlamAppRootState,
  type SlamAppCombinedState,
  type SlamAppMiddleware,
  DEFAULT_MAX_DELAY_MS,
  type ReplayState,
  type ProgressCallback,
  type CompleteCallback,
  type ErrorCallback,
  type ReplayAction,
  extractActionTimestamp,
  computeInterActionDelay,
  ReplayEngine,
  type SubscribableStore,
  type StoreSubscriberDeps,
  wireStoreSubscribers,
  // tracking-quality (Phase A — see
  // docs/2026-05-16-tracking-quality-metrics-plan.md).
  trackingQualityReducer,
  createTrackingQualityListenerMiddleware,
  computeTrackingQualityReport,
  computeConvergence,
  computeResidualConsensus,
  computeGpsAccuracy,
  computeCoverage,
  computeGpsVsFusedDivergence,
  matrixDelta,
  snapshotPushed,
  snapshotsTrimmed,
  reportUpdated,
  resetTrackingQuality,
  selectTrackingQuality,
  selectRecentAlignments,
  DEFAULT_TRACKING_QUALITY_OPTIONS,
  type TrackingQualityState,
  type TrackingQualityReport,
  type TrackingQualityOptions,
  type TrackingQualitySliceState,
  type AlignmentSnapshot,
  // onboarding-guidance (coaching seam over tracking-quality)
  computeOnboardingGuidance,
  selectOnboardingGuidance,
  type OnboardingPhase,
  type OnboardingGuidance,
} from './state/index.js';

// Storage: omit names that conflict with state (SessionMetadata)
export {
  type StorageBackend,
  type CreateSessionResult,
  NullStorageBackend,
  OpfsStorageBackend,
  resetOpfsStorage,
  resetSessionHandles,
  initOpfsStorage,
  createSession,
  getSessionHandle,
  getSessionsRootHandle,
  getAppRootHandle,
  listSessions,
  checkStorageQuota,
  formatTimestamp,
  formatActionFilename,
  formatFrameFilename,
  type ZipExportResult,
  type ZipExportContributor,
  type ZipContributorAddFile,
  type ExportSessionAsZipOptions,
  exportSessionAsZip,
  exportSessionHandleAsZip,
  syncToExternalZip,
  downloadZip,
  MAX_ACTION_FILE_SIZE,
  type RecordedAction,
  type ZipActionEntry,
  readZipEntries,
  loadActionsFromZip,
  loadSessionMetadataFromBlob,
  type GpsPathCoord,
  loadGpsPathFromBlob,
} from './storage/index.js';

// Visualization: export from map-overlay (not leaflet-map-overlay) for DEFAULT_ZOOM etc.
export * from './visualization/index.js';

// Licensing: bundled community license key (default for createSlamAppStore)
export * from './licensing/index.js';
