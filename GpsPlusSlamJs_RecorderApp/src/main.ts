/**
 * GpsPlusSlamJs Recorder App - Main Entry Point
 *
 * This module initializes the WebXR AR session, Three.js renderer,
 * and wires up the UI controls for recording sessions.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * and docs/issue-library-integration.md
 * - Uses the GpsPlusSlamJs library for GPS/AR alignment
 * - GPS events trigger combined GPS+AR recordings
 * - AR pose is read at GPS moment (not recorded independently)
 */

// Initialize Sentry as early as possible for error tracking.
// Guard with PROD check to avoid sending test/dev data to Sentry.
// NOTE: We use PROD rather than a dedicated VITE_SENTRY_ENABLED env var because:
// 1. Cloudflare preview deployments are dev builds where we don't want Sentry noise
// 2. If staging with separate Sentry is needed later, we'd use VITE_SENTRY_DSN anyway
// 3. PROD is idiomatic Vite and requires zero configuration
import { initSentry } from './utils/sentry';
if (import.meta.env.PROD) {
  initSentry();
}

import {
  initUI,
  showError,
  updateStatus,
  updateArInfo,
  updateGpsInfo,
  updateFrameCount,
  populateScenarios,
  showRecordingControls,
  hideRecordingControls,
  validateEnterButton,
  updatePermissionStatus,
  setPermissionsReady,
  setFolderSelected,
  setSaveLocationSelected,
  updateFolderStatus,
  updateSaveStatus,
  resetUIForNewRecording,
  showSetupModal,
  updateRefPointButtonLabel,
  setNewRefPointButtonVisible,
} from './ui/hud';
import {
  initSessionSummary,
  showSessionSummary,
  hideSessionSummary,
} from './ui/session-summary';
import {
  initLogPanel,
  showLogPanel,
  hideLogPanel,
  toggleLogPanel,
} from './ui/log-panel';
import { initToast, showToast, TOAST_DURATION_ERROR } from './ui/toast';
import { destroyConfirmDialog } from './ui/confirm-dialog';
import {
  initAR,
  endARSession,
  setImageCaptureCallback,
  setDepthCaptureCallback,
  setFrameCallback,
  setTrackingLostCallback,
  setTrackingCallbacks,
  setTrackingRecoveredCallback,
  getScene,
  getCamera,
  getArWorldGroup,
  type CapturedImage,
  type DepthSample,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import { getXrErrorMessage } from 'gps-plus-slam-app-framework/ar/xr-error-handler';
import { applyChromiumProjectionLayerWorkaround } from 'gps-plus-slam-app-framework/ar/chromium-camera-access-workaround';
import {
  initStorage,
  resetForNewSession,
} from 'gps-plus-slam-app-framework/storage/file-system';
import {
  getReadFolderHandle,
  resetForNewRecording as resetExternalForNewRecording,
  hasReadFolderPermission,
} from './storage/external-file-storage';
import { createRecordingSessionHandlers } from './recording/recording-session-handlers';
import { createFolderManager } from './storage/folder-manager';

import { type ImportedRefPoint } from './storage/ref-point-importer';

import {
  showRefPointPicker,
  createRefPointPickerHtml,
  isRefPointPickerVisible,
  cancelRefPointPicker,
} from './ui/ref-point-picker';
import {
  initNavigation,
  pushScreenState,
  replaceScreenState,
} from './ui/navigation';
import {
  createRecorderStore,
  add2dImage,
  recordDepthSample,
} from './state/recorder-store';
import {
  startGpsWatch,
  stopGpsWatch,
  requestOrientationPermission,
} from 'gps-plus-slam-app-framework/sensors/gps';
import {
  checkAllPermissions,
  requestAllPermissions,
} from 'gps-plus-slam-app-framework/sensors/permission-checker';

import type { LatLong } from 'gps-plus-slam-app-framework/core';
import { odometryTrackingRestarted } from 'gps-plus-slam-app-framework/core';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { LeafletMapOverlay } from 'gps-plus-slam-app-framework/visualization/leaflet-map-overlay';
import {
  createCameraFollower,
  type CameraFollower,
} from 'gps-plus-slam-app-framework/visualization/camera-follower';
import {
  createAlignmentLerper,
  type AlignmentLerper,
} from 'gps-plus-slam-app-framework/visualization/alignment-lerper';
import { createGpsCompassCubes } from 'gps-plus-slam-app-framework/visualization/gps-compass-cubes';

import {
  initReplayUI,
  switchToReplayMode,
  populateReplayScenarios,
} from './ui/replay-ui';
import {
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
} from './ui/session-browser';
import type { SessionEntry } from './ui/session-browser';
import { createReplayHandlers } from './replay/replay-handlers';
import { createRefPointHandlers } from './ref-points/ref-point-handlers';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  loadRecordingOptions,
  type RecordingOptions,
} from 'gps-plus-slam-app-framework/state/recording-options';
import { initSettingsModal } from './ui/settings-modal';

import { listFormatter } from 'gps-plus-slam-app-framework/utils/list-formatter';

const log = createLogger('Recorder');

/**
 * Handle write failure by showing toast notification.
 * User Feedback Issue #1 Part B: Real-time feedback on write failures.
 */
function handleWriteFailure(error: Error): void {
  log.warn('Write failure detected:', error.message);
  showToast('⚠️ Save failed - check folder permissions', {
    severity: 'error',
    duration: TOAST_DURATION_ERROR,
  });
}

/**
 * Factory function for creating the recorder store with standard configuration.
 * Centralizes store creation to ensure consistent options (DRY principle).
 */
function createNewStore() {
  return createRecorderStore({
    onWriteFailure: handleWriteFailure,
  });
}

// Global store instance with write failure callback
let store = createNewStore();

// Current recording options (loaded at startup)
let recordingOptions: RecordingOptions;

// Map overlay instance (created when AR session starts)
let mapOverlay: LeafletMapOverlay | null = null;

// Issue 8: Camera follower — GPS-aligned anchor for map and compass cubes
let cameraFollower: CameraFollower | null = null;

// Issue 4: Alignment lerper — smooths alignment-matrix transitions
let alignmentLerper: AlignmentLerper | null = null;

// Replay mode handlers — encapsulates all replay state and event handlers
// (Finding #7 decomposition: extracted from main.ts to replay/replay-handlers.ts)
const replayHandlers = createReplayHandlers({
  setStore: (newStore) => {
    store = newStore;
  },
});

// Recording session handlers — encapsulates start/stop recording lifecycle
// (Finding #7 decomposition Step 3: extracted from main.ts to recording/recording-session-handlers.ts)
const recordingSessionHandlers = createRecordingSessionHandlers({
  getStore: () => store,
  setStore: (newStore) => {
    store = newStore;
  },
  createNewStore,
  getRecordingOptions: () => recordingOptions,
  getMapOverlay: () => mapOverlay,
  clearRefPointUsage: () => refPointHandlers.clearSessionRefPointUsage(),
  getSessionNotes,
  waitForZeroReference,
  loadAndDisplayRefPoints: (handle) =>
    folderManager.loadAndDisplayRefPoints(handle),
  collectTrackerErrors,
  applyAlignmentMatrix: (matrix: readonly number[]) =>
    alignmentLerper?.setTarget(matrix),
  onNewGpsLatLng: (lat: number, lng: number) => {
    const nearby = refPointHandlers.checkNearbyRefPoint(lat, lng);
    updateRefPointButtonLabel(nearby?.displayName);
    setNewRefPointButtonVisible(nearby?.isNeighborCell ?? false);
  },
});

// Ref-point handlers — encapsulates all ref-point state and event handlers
// (Finding #7 decomposition Step 2: extracted from main.ts to ref-points/ref-point-handlers.ts)
const refPointHandlers = createRefPointHandlers({
  getStore: () => store,
  getCurrentSessionName: () => recordingSessionHandlers.getCurrentSessionName(),
});

// Folder manager — encapsulates folder selection, save location, scenario management
// (Finding #7 decomposition Step 4: extracted from main.ts to storage/folder-manager.ts)
const folderManager = createFolderManager({
  getStore: () => store,
  getIsReplayMode: () => replayHandlers.getIsReplayMode(),
  setReplayZipScenariosCache: (cache) =>
    replayHandlers.setReplayZipScenariosCache(cache),
  setImportedRefPoints: (refPoints) =>
    refPointHandlers.setImportedRefPoints(refPoints),
  showError,
  updateStatus,
  populateScenarios,
  setFolderSelected,
  setSaveLocationSelected,
  validateEnterButton,
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
  populateReplayScenarios,
  updateFolderStatus,
  updateSaveStatus,
  get mapOverlay() {
    return mapOverlay ?? undefined;
  },
});

// --- Exported for testing ---

/**
 * Get imported reference points from previous session ZIPs.
 * Used by the ref point picker to suggest existing ref points.
 * Exported for testing purposes.
 */
export function getImportedRefPoints(): ImportedRefPoint[] {
  return refPointHandlers.getImportedRefPoints();
}

/**
 * Set imported reference points (for testing purposes).
 * Delegates to refPointHandlers.
 */
export function setImportedRefPointsForTesting(
  refPoints: ImportedRefPoint[]
): void {
  refPointHandlers.setImportedRefPoints(refPoints);
}

/**
 * Get the current scenario name.
 * Exported for testing purposes.
 */
export function getCurrentScenarioName(): string {
  return folderManager.getCurrentScenarioName();
}

/**
 * Set the current scenario name.
 * Called when user selects a scenario from the dropdown.
 */
export function setCurrentScenarioName(name: string): void {
  folderManager.setCurrentScenarioName(name);
}

/**
 * Reset main module state.
 * Exported for testing purposes to ensure test isolation.
 */
export function resetMainState(): void {
  if (mapOverlay) {
    mapOverlay.dispose();
    mapOverlay = null;
  }
  if (cameraFollower) {
    cameraFollower.dispose();
    cameraFollower = null;
  }
  if (alignmentLerper) {
    alignmentLerper.dispose();
    alignmentLerper = null;
  }
  recordingSessionHandlers.reset();
  refPointHandlers.reset();
  destroyConfirmDialog();
  folderManager.reset();
  replayHandlers.reset();
  setFolderSelected(false);
  setSaveLocationSelected(false);
}

/**
 * Set cached OPFS scenarios (for testing purposes).
 * Allows tests to simulate OPFS scenarios without re-initializing storage.
 */
export function setCachedOpfsScenariosForTesting(scenarios: string[]): void {
  folderManager.setCachedOpfsScenarios(scenarios);
}

/**
 * Load and display reference points (for testing purposes).
 * Delegates to folderManager.loadAndDisplayRefPoints.
 */
export function loadAndDisplayRefPoints(
  handle: FileSystemDirectoryHandle
): Promise<{ refPointCount: number; observationCount: number }> {
  return folderManager.loadAndDisplayRefPoints(handle);
}

/**
 * Get current replay session entries (for testing purposes).
 * Allows tests to verify scenario change populates the session list.
 */
export function getReplaySessionEntriesForTesting(): SessionEntry[] {
  return replayHandlers.getSessionEntries();
}

/**
 * Soft reset for starting a new recording without a page reload.
 *
 * Preserves:
 * - Read folder handle (so user doesn't re-select the folder)
 * - Imported reference points (loaded from the read folder)
 * - AR/WebXR session (stays alive, user returns to AR_READY)
 * - Recording options (user settings from localStorage)
 * - OPFS root/scenarios directory handles (storage stays initialized)
 * - Logger subscribers and buffer
 *
 * Resets:
 * - Store (fresh Redux store for new session)
 * - Session/scenario names
 * - Sync manager, trackers, map overlay
 * - OPFS session-level handles (actions/frames dirs)
 * - External save file handle (new ZIP per session)
 * - HUD state (shows setup modal, clears save location status)
 * - Session summary panel (hidden)
 *
 * Issue 4 (2026-02-06 user feedback): Retain read permission on new recording.
 */
export async function resetForNewRecording(): Promise<void> {
  log.info('Soft reset: starting new recording...');

  // --- Clean up recording-level state ---
  recordingSessionHandlers.cleanupForNewRecording();

  // Clean up map overlay
  if (mapOverlay) {
    mapOverlay.dispose();
    mapOverlay = null;
  }

  // Reset recording-level counters
  gpsEventVisualizer.clearAll();

  // Fresh store for next session
  store = createNewStore();

  // --- Reset storage (preserve OPFS root, clear session handles) ---
  resetForNewSession();
  resetExternalForNewRecording(); // clears save file handle, keeps read folder handle

  // --- Check if read folder permission is still valid ---
  const folderStillGranted = await hasReadFolderPermission();

  // --- Reset UI ---
  hideSessionSummary();
  resetUIForNewRecording({ keepFolder: folderStillGranted });

  // Issue 7 Phase 2: Reset navigation state to setup screen
  replaceScreenState('setup');

  // If folder permission is still valid, update folder status display
  if (folderStillGranted) {
    // Defensive: getReadFolderHandle() should be non-null when folderStillGranted
    // is true, but we guard to satisfy TypeScript and tolerate future refactors.
    const folderHandle = getReadFolderHandle();
    if (folderHandle) {
      const refPointCount = refPointHandlers.getImportedRefPoints().length;
      updateFolderStatus(`✅ ${folderHandle.name} (${refPointCount} ref pts)`);
    }
  } else {
    // Permission lost — clear imported ref points too since they came from that folder
    refPointHandlers.setImportedRefPoints([]);
  }

  log.info(
    `Soft reset complete. Folder permission ${folderStillGranted ? 'retained' : 'lost'}.`
  );
}

/**
 * Get the map overlay instance.
 * Exported for testing purposes.
 */
export function getMapOverlay(): LeafletMapOverlay | null {
  return mapOverlay;
}

/**
 * Read session notes from the UI textarea.
 * Returns trimmed value, or empty string if not found or empty.
 */
export function getSessionNotes(): string {
  const textarea = document.getElementById(
    'session-notes'
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    return '';
  }
  return textarea.value.trim();
}

/**
 * Wait for zero reference to be set in the store.
 * Returns when gpsData.zero is available, or null if timeout.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds (default 30s)
 * @returns The zero reference if set, or null if timeout
 */
export async function waitForZeroReference(
  timeoutMs: number = 30000
): Promise<LatLong | null> {
  // Check if already set
  const currentState = store.getState();
  if (currentState.gpsData?.zero) {
    return currentState.gpsData.zero;
  }

  return new Promise((resolve) => {
    let resolved = false;

    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (state.gpsData?.zero && !resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(state.gpsData.zero);
      }
    });

    // Timeout fallback
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribe();
        resolve(null);
      }
    }, timeoutMs);
  });
}

/**
 * Collect error messages from a failure tracker and reset it.
 * Extracts the duplicated tracker-cleanup pattern from handleStopRecording.
 *
 * @param tracker - The tracker instance (or null if not initialized)
 * @param label - Human-readable label for the error message (e.g. "image write failures")
 * @param errors - Array to push error messages into
 */
export function collectTrackerErrors(
  tracker: { getFailureCount(): number; reset(): void } | null,
  label: string,
  errors: string[]
): void {
  if (!tracker) {
    return;
  }
  const failureCount = tracker.getFailureCount();
  if (failureCount > 0) {
    errors.push(`${failureCount} ${label}`);
  }
  tracker.reset();
}

// --- End testing exports ---

async function main(): Promise<void> {
  log.info('Initializing...');

  // Load recording options from localStorage (before any other init)
  recordingOptions = loadRecordingOptions();
  log.info('Recording options loaded:', recordingOptions);

  // Apply Chromium camera-access tab-crash workaround if opted in. Must run
  // before any WebXR session is created. Three.js reads the relevant
  // prototype members lazily when the first session starts, so doing this at
  // bootstrap (before initAR) is sufficient.
  if (
    recordingOptions.arCrashIsolation.applyChromiumProjectionLayerWorkaround
  ) {
    const workaroundResult = applyChromiumProjectionLayerWorkaround();
    log.info('Applied Chromium projection-layer workaround:', workaroundResult);
  }

  // Initialize settings modal with callback to update options
  // This must happen early so settings button works even if WebXR fails
  initSettingsModal((newOptions) => {
    recordingOptions = newOptions;
    log.info('Recording options updated:', recordingOptions);
  });

  // Initialize ref point picker modal content BEFORE WebXR check
  // This allows E2E tests to work even without WebXR support
  const pickerModal = document.getElementById('ref-point-picker-modal');
  if (pickerModal) {
    pickerModal.innerHTML = createRefPointPickerHtml();
  }

  // Register browser back-button handler for modals + screens (Issue 7 Phase 1+2)
  // - Modal: back while ref-point picker is open → cancel picker
  // - AR: back from AR_READY → return to setup
  // - Recording: back is consumed (prevented) to avoid data loss
  // - Summary: back → soft reset to setup
  initNavigation(
    {
      onCloseModal: () => {
        if (isRefPointPickerVisible()) {
          cancelRefPointPicker();
        }
      },
      onBackToSetup: () => {
        showSetupModal();
        log.info('Back from AR — returned to setup');
      },
      onBackFromSummary: () => {
        log.info('Back from summary — triggering soft reset');
        void resetForNewRecording();
      },
      onBackDuringRecording: () => {
        void recordingSessionHandlers.handleBackDuringRecording();
      },
    },
    // Bug 9 fix: pass a getter so navigation always resolves the current store
    // (store is replaced on each soft reset via createNewStore())
    () => store
  );

  // Expose ref point picker API on window for E2E testing
  // This allows Playwright tests to trigger the real application behavior
  window.refPointPickerApi = {
    showRefPointPicker,
  };

  // Initialize UI event handlers BEFORE WebXR check
  // This ensures change handlers work in E2E tests even without WebXR
  initUI({
    onOpenFolder: () => folderManager.handleOpenFolder(),
    onChooseSaveLocation: () => folderManager.handleChooseSaveLocation(),
    onEnterAR: handleEnterAR,
    onStartRecording: () => recordingSessionHandlers.handleStartRecording(),
    onStopRecording: () => recordingSessionHandlers.handleStopRecording(),
    onMarkRefPoint: () => refPointHandlers.handleMarkRefPoint(),
    onMarkNewRefPoint: () =>
      refPointHandlers.handleMarkRefPoint({ forceNew: true }),
    onToggleMap: handleToggleMap,
    onMapZoomIn: handleMapZoomIn,
    onMapZoomOut: handleMapZoomOut,
    onScenarioChange: (name: string) =>
      void folderManager.handleScenarioChange(name),
    onRequestPermissions: handleRequestPermissions,
  });

  // Initialize session summary panel (shown after recording stops)
  initSessionSummary({
    onNewRecording: () => {
      // Issue 4: Soft reset instead of page reload to retain read folder permission
      void resetForNewRecording();
    },
    onViewLogs: () => {
      // Issue #5: Show log panel from summary screen
      showLogPanel();
    },
  });

  // Initialize log panel (tap status to show, or from summary)
  initLogPanel();

  // Initialize toast notification system (Issue #1 Part B)
  initToast();

  // Auto-initialize OPFS storage (Issue 1a - 2026-01-27 user feedback)
  // This replaces the confusing "Select folder" button that did nothing after OPFS migration
  try {
    const scenarios = await initStorage();
    folderManager.setCachedOpfsScenarios(scenarios);
    populateScenarios(scenarios);
    updateStorageStatus('Ready', true);
    log.info('OPFS storage initialized, found scenarios:', scenarios);
  } catch (err) {
    log.error('OPFS storage initialization failed:', err);
    updateStorageStatus('Error', false);
    showError('Storage initialization failed. Please refresh the page.');
  }

  // Check all permissions early and update UI
  // This provides immediate feedback on what's available/needed
  const initialPermissions = await checkAllPermissions();
  updatePermissionStatus(initialPermissions);

  // Update status based on permission state
  if (!initialPermissions.webxr.supported) {
    // Desktop browser: WebXR not available. Switch to replay mode
    // instead of showing a dead-end error (replay-mode design doc, Issue 1).
    stopGpsWatch(); // Clean up any GPS warm-up watch (Bug 5)
    replayHandlers.setIsReplayMode(true);
    switchToReplayMode();
    initReplayUI({
      onScenarioChange: (name: string) =>
        void replayHandlers.handleReplayScenarioChange(name),
      onSessionSelect: (index: number) =>
        void replayHandlers.handleReplaySessionSelect(index),
      onStartReplay: (speed: number) =>
        void replayHandlers.handleStartReplay(speed),
      onPlayPause: () => replayHandlers.handleReplayPlayPause(),
      onSpeedChange: (speed: number) =>
        replayHandlers.handleReplaySpeedChange(speed),
      onCameraToggle: () => replayHandlers.handleReplayCameraToggle(),
      onMapToggle: () => replayHandlers.handleReplayMapToggle(),
      onMapZoomIn: () => replayHandlers.handleReplayMapZoomIn(),
      onMapZoomOut: () => replayHandlers.handleReplayMapZoomOut(),
    });
    updateStatus('Replay Mode — Open a recordings folder');
    log.info('WebXR not supported — entered replay mode');
  } else if (initialPermissions.allMandatoryReady) {
    updateStatus('Ready - Configure scenario');
  } else {
    updateStatus('Grant permissions to continue');
  }
}

/**
 * Update the storage status display in the UI.
 */
function updateStorageStatus(text: string, success: boolean): void {
  const statusEl = document.getElementById('storage-status-text');
  if (statusEl) {
    statusEl.textContent = success ? `✅ ${text}` : `❌ ${text}`;
    statusEl.className = success
      ? 'text-sm text-green-400'
      : 'text-sm text-red-400';
  }
}

/**
 * Handle the "Grant Permissions" button click.
 * Requests all pending permissions and updates the UI.
 */
async function handleRequestPermissions(): Promise<void> {
  log.info('Requesting permissions...');
  updateStatus('Requesting permissions...');

  try {
    const result = await requestAllPermissions();
    updatePermissionStatus(result);

    if (result.allMandatoryReady) {
      updateStatus('Ready - Configure scenario');
    } else {
      // Some permissions were denied
      const deniedList: string[] = [];
      if (result.geolocation.granted === false) {
        deniedList.push('Location');
      }
      if (result.camera.granted === false) {
        deniedList.push('Camera');
      }

      if (deniedList.length > 0) {
        showError(
          `${listFormatter.format(deniedList)} access denied. Please enable in browser settings.`
        );
      } else {
        updateStatus('Some permissions pending - tap Grant Permissions');
      }
    }

    // Issue 4 (2026-02-27 user feedback): Start GPS warm-up as soon as
    // geolocation permission is confirmed. This primes the GPS hardware
    // so that waitForZeroReference resolves faster when recording starts.
    // startGpsWatch is idempotent, so calling it again in handleStartRecording
    // with the real handler safely replaces this warm-up watch.
    if (result.geolocation.granted) {
      log.info('Geolocation granted — starting GPS warm-up watch');
      startGpsWatch(() => {
        /* warm-up: discard positions */
      });
    }
  } catch (err) {
    log.error('Permission request failed:', err);
    showError('Failed to request permissions. Please try again.');
  }
}

async function handleEnterAR(): Promise<void> {
  try {
    updateStatus('Starting AR session...');

    // Request orientation permission (required on iOS)
    // Field Test Readiness Issue #2: Check return value and warn user
    const orientationGranted = await requestOrientationPermission();
    if (!orientationGranted) {
      // Don't block AR start, but warn user about missing compass data
      log.warn('Orientation permission denied - compass data unavailable');
      showError(
        'Compass permission denied. Device orientation will be unavailable.'
      );
    }

    // Set up depth capture callback BEFORE initAR (sampler is created during init)
    // Field Test Readiness Issue #8: Pass unavailable callback to warn user
    setDepthCaptureCallback(handleDepthSampleCaptured, () => {
      log.warn('Depth sensing unavailable - device may not support it');
      showError(
        'Depth sensing unavailable. Your device may not support this feature.'
      );
    });

    // Set up tracking lost callback to warn user when AR tracking fails
    setTrackingLostCallback(() => {
      updateArInfo('⚠️ LOST');
      showError(
        'AR tracking lost. Try moving to a well-lit area with more visual features.'
      );
    });

    // Wire tracking restart detection BEFORE initAR() — this enables the
    // TrackingStateManager and XRReferenceSpace reset event listener.
    // When tracking resumes after an origin reset (Case 2), the store's
    // odometryTrackingRestarted reducer clears stale data and accumulates
    // offsets so alignment continues correctly across resets.
    setTrackingCallbacks((payload) => {
      store.dispatch(odometryTrackingRestarted(payload));
      updateArInfo('');
      log.info('AR tracking restarted — alignment correction dispatched');
    });

    // Wire seamless recovery callback (Case 1: same coordinate frame).
    // Clears the "LOST" UI warning without dispatching alignment correction.
    setTrackingRecoveredCallback(() => {
      updateArInfo('');
      log.info('AR tracking recovered (same coordinate frame)');
    });

    const appContainer = document.getElementById('app');
    if (!appContainer) {
      throw new Error('Missing #app container element');
    }
    await initAR(appContainer, recordingOptions.arCrashIsolation);

    // Set up image capture callback (must be done after AR init)
    // Issue #11: Pass onCaptureFailed callback to track capture failures
    // User feedback: Pass onSuspiciousImage callback to log black/empty frames
    setImageCaptureCallback(
      handleImageCaptured,
      getScreenRotation,
      () => recordingSessionHandlers.recordCaptureFailure(),
      (blobSize: number, frameIndex: number) => {
        // Log suspicious images so they appear in the expandable log panel
        log.error(
          `Suspicious image detected at frame ${frameIndex}: ` +
            `size ${blobSize} bytes - image may be black/empty. ` +
            `This can occur when WebGL hasn't composited the frame yet.`
        );
      }
    );

    // Issue 8: Create CameraFollower at scene root (not arWorldGroup)
    // The follower tracks the camera position but stays GPS-aligned (identity rotation),
    // so the map and compass cubes don't rotate with the camera or alignment matrix.
    const arWorldGroup = getArWorldGroup();
    const arScene = getScene();
    if (arWorldGroup && arScene) {
      // Issue 4: Create alignment lerper for smooth alignment transitions
      alignmentLerper = createAlignmentLerper(arWorldGroup);

      cameraFollower = createCameraFollower(arScene);
      createGpsCompassCubes(cameraFollower.object3D);
    }

    // Issue #14: Map overlay is created lazily on first toggle (not here)
    // Register per-frame callback for smooth map position updates and follower tracking
    // This is called every XR frame (~60+ Hz) rather than on GPS events (~1 Hz)
    let lastFrameTime = performance.now();
    setFrameCallback(() => {
      const now = performance.now();
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      // Update alignment lerper (Issue 4) — interpolate arWorldGroup.matrix
      alignmentLerper?.update(dt);

      // Update follower position (lerp toward camera world position)
      const camera = getCamera();
      if (cameraFollower && camera) {
        cameraFollower.update(camera, dt);
      }

      if (mapOverlay?.isVisible()) {
        mapOverlay.updatePosition();
      }
    });

    // Issue #2 fix: Update status to match AR_READY state per Application State Machine
    updateStatus('AR active - Tap Start to record');

    // Issue 7 Phase 2: Push AR screen state for back-button navigation
    pushScreenState('ar');
  } catch (err) {
    log.error('AR init failed:', err);
    // Field Test Readiness Issue #4: Provide specific error messages
    const userMessage = getXrErrorMessage(err);
    showError(userMessage);
    // Issue #10: If initAR succeeded but a later step threw, the XR session
    // is left running with incomplete wiring. Tear it down to free GPU
    // resources and avoid a broken half-initialized state.
    try {
      await endARSession();
    } catch (cleanupErr) {
      log.error(
        'Failed to clean up AR session after init failure:',
        cleanupErr
      );
    }
  }
}

/**
 * Get current device screen rotation in degrees (0, 90, 180, 270).
 * Used for image capture metadata.
 */
function getScreenRotation(): number {
  // Use Screen Orientation API if available
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  // Fallback to deprecated window.orientation
  if (typeof window.orientation === 'number') {
    // window.orientation is deprecated but provides a fallback. It may return
    // negative values (e.g., -90), so we normalize it to the 0-360 range.
    const angle = (window.orientation + 360) % 360;
    return angle;
  }
  return 0;
}

/**
 * Handle a captured image - dispatch action and write to disk.
 *
 * DESIGN NOTE: We intentionally dispatch the action BEFORE awaiting the file write.
 * This ensures actions are logged in chronological capture order. If we awaited
 * writeFrame first, slower writes could complete after faster ones, causing
 * out-of-order actions (e.g., frame-11 dispatched before frame-10).
 *
 * The tradeoff is that a failed write leaves a dangling file reference in the
 * action log. This is acceptable because:
 * 1. Write failures are rare (permissions validated at session start)
 * 2. Failures are logged for debugging
 * 3. Replay can gracefully skip missing files with a warning
 */
function handleImageCaptured(image: CapturedImage): void {
  // Issue #11: Record successful capture (resets consecutive failure counter)
  recordingSessionHandlers.recordCaptureSuccess();

  // Update live frame counter in HUD so user can see captures are happening
  updateFrameCount(image.frameIndex);

  const filename = `frame-${String(image.frameIndex).padStart(6, '0')}.jpg`;

  // Dispatch first to preserve chronological action order (see DESIGN NOTE above)
  // Raw WebXR position — the reducer applies WebXR→NUE conversion
  store.dispatch(
    add2dImage({
      imageFile: `frames/${filename}`,
      position: [image.position.x, image.position.y, image.position.z],
      rotation: [
        image.rotation.x,
        image.rotation.y,
        image.rotation.z,
        image.rotation.w,
      ],
      screenRotation: image.screenRotation,
      capturedAt: image.timestamp,
    })
  );

  // Write the image blob to disk asynchronously
  // Track failures to warn user if storage becomes unavailable
  // A1 fix: route through store.writeFrame() so NullStorageBackend works in replay
  store
    .writeFrame(image.blob, image.frameIndex)
    .then(() => recordingSessionHandlers.recordWriteSuccess())
    .catch((err) => {
      log.error('Failed to write frame:', err);
      recordingSessionHandlers.recordWriteFailure(err);
    });
}

/**
 * Handle a captured depth sample - dispatch action for replay.
 * Depth samples are stored directly in Redux actions (not separate files)
 * because at 1 Hz with ~9 points per sample, the data is lightweight (~1-2 KB).
 * This enables integration tests to process depth data during replay.
 */
function handleDepthSampleCaptured(sample: DepthSample): void {
  store.dispatch(
    recordDepthSample({
      timestamp: sample.timestamp,
      cameraPos: sample.cameraPos,
      cameraRot: sample.cameraRot,
      points: sample.points,
    })
  );
  log.info(`Recorded depth sample with ${sample.points.length} points`);
}

function handleToggleMap(): void {
  // Issue #14: Lazy map overlay creation - create on first toggle
  if (!mapOverlay) {
    const scene = getScene();
    const camera = getCamera();
    if (!scene || !camera) {
      log.warn('Map overlay not initialized - enter AR first');
      showError('Enter AR session before using the map');
      return;
    }

    mapOverlay = new LeafletMapOverlay(scene, camera, {
      mapParent: cameraFollower?.object3D,
    });
    log.info('Map overlay created lazily on first toggle');
  }

  // Ensure map has GPS position before showing
  const state = store.getState();
  const lastGpsPoint = state.gpsData?.gpsEvents?.gpsPositions?.at(-1) ?? null;

  if (lastGpsPoint && !mapOverlay.getGpsPosition()) {
    mapOverlay.setGpsPosition(lastGpsPoint.latitude, lastGpsPoint.longitude);
  }

  mapOverlay.toggle();
  log.info(`Map overlay ${mapOverlay.isVisible() ? 'shown' : 'hidden'}`);
}

function handleMapZoomIn(): void {
  mapOverlay?.zoomIn();
}

function handleMapZoomOut(): void {
  mapOverlay?.zoomOut();
}

/**
 * Exported for testing purposes.
 * Delegates to folderManager.handleScenarioChange.
 */
export function handleScenarioChangeForTesting(
  scenarioName: string
): Promise<void> {
  return folderManager.handleScenarioChange(scenarioName);
}

/**
 * Exported for testing purposes.
 * Wraps handleStartRecording to allow testing without full UI wiring.
 */
export function handleStartRecordingForTesting(): Promise<void> {
  return recordingSessionHandlers.handleStartRecording();
}

/**
 * Exported for testing purposes.
 * Wraps handleStopRecording to allow testing without full UI wiring.
 */
export function handleStopRecordingForTesting(): Promise<void> {
  return recordingSessionHandlers.handleStopRecording();
}

/**
 * Exported for testing purposes.
 * Wraps handleEnterAR to allow testing without full UI wiring.
 */
export function handleEnterARForTesting(): Promise<void> {
  return handleEnterAR();
}

/**
 * Exported for testing purposes.
 * Wraps handleRequestPermissions to allow testing GPS warm-up (Issue 4).
 */
export function handleRequestPermissionsForTesting(): Promise<void> {
  return handleRequestPermissions();
}

/**
 * Exported for testing purposes.
 * Delegates to refPointHandlers.handleMarkRefPoint.
 */
export function handleMarkRefPointForTesting(): Promise<void> {
  return refPointHandlers.handleMarkRefPoint();
}

/**
 * Exported for testing purposes.
 * Wraps handleOpenFolder to allow testing folder scanning (Issue 1, 2026-02-27).
 */
export function handleOpenFolderForTesting(): Promise<void> {
  return folderManager.handleOpenFolder();
}

/**
 * Exported for testing purposes.
 * Wraps handleReplayScenarioChange to allow testing replay scenario selection.
 */
export function handleReplayScenarioChangeForTesting(
  scenarioName: string
): Promise<void> {
  return replayHandlers.handleReplayScenarioChange(scenarioName);
}

/**
 * Set replay mode flag (for testing purposes).
 * Allows tests to simulate desktop/replay-mode behavior.
 */
export function setReplayModeForTesting(value: boolean): void {
  replayHandlers.setIsReplayMode(value);
}

/**
 * Exported for testing purposes.
 * Wraps handleBackDuringRecording to test the back-button confirmation flow.
 * Issue 5 (2026-02-27 user feedback).
 */
export function handleBackDuringRecordingForTesting(): Promise<void> {
  return recordingSessionHandlers.handleBackDuringRecording();
}

// Expose test hooks on window for e2e testing (dev mode only, not in unit tests)
// This allows Playwright tests to call real functions instead of simulating DOM changes
// Guard against unit test environment where window.testHooks setup can cause issues
if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  !import.meta.env.VITEST
) {
  window.testHooks = {
    populateScenarios,
    validateEnterButton,
    showRecordingControls,
    hideRecordingControls,
    showSessionSummary,
    updateGpsInfo,
    updateArInfo,
    updatePermissionStatus,
    setPermissionsReady,
    // Log panel hooks (Issue #5)
    showLogPanel,
    hideLogPanel,
    toggleLogPanel,
    logInfo: (tag: string, message: string) => createLogger(tag).info(message),
    logWarn: (tag: string, message: string) => createLogger(tag).warn(message),
    logError: (tag: string, message: string) =>
      createLogger(tag).error(message),
    // GPS event visualization hooks
    getGpsEventVisualizerCounts: () => gpsEventVisualizer.getCounts(),
    setGpsEventVisualizerZeroRef: (lat: number, lon: number) =>
      gpsEventVisualizer.setZeroRef({ lat, lon }),
    clearGpsEventVisualizer: () => gpsEventVisualizer.clearAll(),
    // Mandatory storage selection hooks (Task 1a-fix)
    setFolderSelected,
    setSaveLocationSelected,
  };
}

// Bootstrap
main().catch((err) => {
  log.error('Fatal error:', err);
  showError('Fatal error during initialization.');
});
