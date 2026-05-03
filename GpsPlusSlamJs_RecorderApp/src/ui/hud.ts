/**
 * HUD / UI Module
 *
 * Manages the HTML overlay elements: status display, buttons, modals.
 */

import type { PermissionCheckResult } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import { listFormatter } from 'gps-plus-slam-app-framework/utils/list-formatter';
import { getRequiredElement } from '../utils/dom-helpers';
import { DEFAULT_SCENARIO } from './session-browser';

export interface UICallbacks {
  onOpenFolder: () => Promise<void>;
  onChooseSaveLocation: () => Promise<void>;
  onEnterAR: () => Promise<void>;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => void | Promise<void>;
  onMarkRefPoint: () => Promise<void>;
  onMarkNewRefPoint: () => Promise<void>;
  onToggleMap: () => void;
  onMapZoomIn: () => void;
  onMapZoomOut: () => void;
  onScenarioChange: (scenarioName: string) => void;
  onRequestPermissions: () => Promise<void>;
}

let callbacks: UICallbacks | null = null;

// Track permission status for Enter AR button validation
let permissionsReady = false;

// Track storage status for Enter AR button validation (Issue 1a-fix)
let folderSelected = false;
let saveLocationSelected = false;

// Cached references to required UI elements, set during initUI()
let cachedElements: {
  btnEnterAR: HTMLButtonElement;
  scenarioSelect: HTMLSelectElement;
  btnStart: HTMLElement;
  btnStop: HTMLElement;
  btnRefPoint: HTMLElement;
  btnNewRefPoint: HTMLElement;
  recordingIndicator: HTMLElement;
} | null = null;

/**
 * Initialize UI event listeners
 */
export function initUI(cbs: UICallbacks): void {
  callbacks = cbs;

  // Critical setup modal elements - app cannot function without these
  const btnEnterAR = getRequiredElement<HTMLButtonElement>('btn-enter-ar');
  const scenarioSelect =
    getRequiredElement<HTMLSelectElement>('scenario-select');

  // Recording controls - core functionality
  const btnStart = getRequiredElement('btn-start');
  const btnStop = getRequiredElement('btn-stop');
  const btnRefPoint = getRequiredElement('btn-ref-point');

  // Secondary ref point button — always in DOM, shown only for Part B proximity feature
  const btnNewRefPoint = getRequiredElement('btn-new-ref-point');

  // Recording indicator element
  const recordingIndicator = getRequiredElement('recording-indicator');

  // Cache required elements for use in other functions
  cachedElements = {
    btnEnterAR,
    scenarioSelect,
    btnStart,
    btnStop,
    btnRefPoint,
    btnNewRefPoint,
    recordingIndicator,
  };

  // Optional elements - graceful degradation allowed
  const btnMap = document.getElementById('btn-map');
  const btnRequestPermissions = document.getElementById(
    'btn-request-permissions'
  );

  // Optional external backup buttons (Issue 1a - 2026-01-27 user feedback)
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnChooseSave = document.getElementById('btn-choose-save');

  // Wire up events for external backup buttons (optional)
  btnOpenFolder?.addEventListener('click', () => {
    void callbacks?.onOpenFolder();
  });

  btnChooseSave?.addEventListener('click', () => {
    void callbacks?.onChooseSaveLocation();
  });

  btnEnterAR.addEventListener('click', () => {
    void callbacks
      ?.onEnterAR()
      .then(() => {
        hideSetupModal();
        showArReadyControls();
      })
      .catch(() => {
        // Error already handled by main.ts handleEnterAR try/catch.
        // Ensure setup modal stays visible so user can retry.
        showSetupModal();
      });
  });

  btnStart.addEventListener('click', () => {
    void callbacks?.onStartRecording();
  });

  btnStop.addEventListener('click', () => {
    void callbacks?.onStopRecording();
  });

  btnRefPoint.addEventListener('click', () => {
    void callbacks?.onMarkRefPoint();
  });

  btnNewRefPoint.addEventListener('click', () => {
    void callbacks?.onMarkNewRefPoint();
  });

  // Optional map button
  btnMap?.addEventListener('click', () => {
    callbacks?.onToggleMap();
  });

  // Optional map zoom buttons
  const btnZoomIn = document.getElementById('btn-map-zoom-in');
  const btnZoomOut = document.getElementById('btn-map-zoom-out');
  btnZoomIn?.addEventListener('click', () => {
    callbacks?.onMapZoomIn();
  });
  btnZoomOut?.addEventListener('click', () => {
    callbacks?.onMapZoomOut();
  });

  // Permission request button
  btnRequestPermissions?.addEventListener('click', () => {
    void callbacks?.onRequestPermissions();
  });

  // Scenario dropdown logic
  scenarioSelect.addEventListener('change', () => {
    const newScenarioSection = document.getElementById('new-scenario-section');
    const newScenarioNameInput = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement | null;
    if (scenarioSelect.value === '__new__') {
      // Show with transition: remove hidden, then add opacity
      newScenarioSection?.classList.remove('hidden');
      // Use requestAnimationFrame to ensure transition triggers after display change
      requestAnimationFrame(() => {
        newScenarioSection?.classList.remove('opacity-0');
        newScenarioSection?.classList.add('opacity-100');
      });
      // Auto-focus the input to guide user to next action
      newScenarioNameInput?.focus();
    } else {
      // Hide with transition: remove opacity first
      newScenarioSection?.classList.remove('opacity-100');
      newScenarioSection?.classList.add('opacity-0');

      // Check if transitions are expected to run.
      // Use optional chaining for matchMedia (not available in jsdom without polyfill).
      const prefersReducedMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ??
        false;
      const transitionDuration = newScenarioSection
        ? getComputedStyle(newScenarioSection).transitionDuration
        : '0s';
      // Treat empty string (jsdom) or '0s' as no transition
      const hasTransition =
        !prefersReducedMotion &&
        transitionDuration !== '0s' &&
        transitionDuration !== '';

      if (hasTransition) {
        // Add hidden after transition completes to avoid visual glitches.
        // Use a timeout fallback in case transitionend never fires (browser bug,
        // rapid DOM changes, etc.). The fallback duration is slightly longer than
        // the CSS transition (300ms + 50ms buffer).
        const fallbackTimeoutMs = 350;
        const timeoutId = setTimeout(() => {
          if (scenarioSelect.value !== '__new__') {
            newScenarioSection?.classList.add('hidden');
          }
        }, fallbackTimeoutMs);

        // Note on cleanup: { once: true } auto-removes the listener after firing,
        // preventing accumulation. The element is never removed from the DOM (only
        // hidden via CSS), so no explicit cleanup is needed. The inner conditional
        // handles rapid toggles—if user switches back to "__new__" before transition
        // ends, we skip adding 'hidden'.
        newScenarioSection?.addEventListener(
          'transitionend',
          () => {
            clearTimeout(timeoutId);
            if (scenarioSelect.value !== '__new__') {
              newScenarioSection?.classList.add('hidden');
            }
          },
          { once: true }
        );
      } else {
        // No transition expected (reduced motion or 0s duration) — hide immediately.
        // This ensures the element is properly hidden from assistive tech.
        if (scenarioSelect.value !== '__new__') {
          newScenarioSection?.classList.add('hidden');
        }
      }

      // Notify main.ts about scenario change
      if (scenarioSelect.value) {
        callbacks?.onScenarioChange(scenarioSelect.value);
      }
    }
    validateEnterButton();
  });

  // New scenario name input - revalidate on typing
  const newScenarioName = document.getElementById(
    'new-scenario-name'
  ) as HTMLInputElement | null;
  // Pre-fill with the canonical default scenario so users can tap "Enter AR"
  // without typing when no existing scenarios are found (UX 2026-05-03).
  // Sourced from `DEFAULT_SCENARIO` so the canonical name lives in exactly
  // one place; HTML cannot import a TS constant directly.
  if (newScenarioName && newScenarioName.value === '') {
    newScenarioName.value = DEFAULT_SCENARIO;
  }
  newScenarioName?.addEventListener('input', () => {
    validateEnterButton();
  });

  // Initialize help section collapsed state from localStorage (Issue 2 - User Feedback)
  initHelpSection();

  // Set initial hint state
  validateEnterButton();
}

/**
 * Update the status text in the HUD
 */
export function updateStatus(text: string): void {
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = text;
    statusText.className = 'text-green-400';
  }
}

/**
 * Update the folder-status display text.
 */
export function updateFolderStatus(text: string): void {
  const el = document.getElementById('folder-status');
  if (el) {
    el.textContent = text;
  }
}

/**
 * Update the save-status display text.
 */
export function updateSaveStatus(text: string): void {
  const el = document.getElementById('save-status');
  if (el) {
    el.textContent = text;
  }
}

/**
 * Show an error message
 */
export function showError(message: string): void {
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = message;
    statusText.className = 'text-red-400';
  }

  // Also show WebXR warning in modal if relevant
  const warning = document.getElementById('webxr-warning');
  if (warning && message.toLowerCase().includes('webxr')) {
    warning.textContent = message;
    warning.classList.remove('hidden');
  }
}

/**
 * Update GPS accuracy display
 */
export function updateGpsInfo(accuracy: number): void {
  const gpsInfo = document.getElementById('gps-info');
  const gpsAccuracy = document.getElementById('gps-accuracy');
  if (gpsInfo && gpsAccuracy) {
    gpsInfo.classList.remove('hidden');
    gpsAccuracy.textContent = `±${accuracy.toFixed(1)}m`;
    gpsAccuracy.className =
      accuracy < 10
        ? 'text-green-400'
        : accuracy < 30
          ? 'text-yellow-400'
          : 'text-red-400';
  }
}

/**
 * Update AR tracking status display
 */
export function updateArInfo(tracking: string): void {
  const arInfo = document.getElementById('ar-info');
  const arTracking = document.getElementById('ar-tracking');
  if (arInfo && arTracking) {
    arInfo.classList.remove('hidden');
    arTracking.textContent = tracking;
  }
}

/**
 * Update the live frame capture counter in the HUD.
 * Shown during recording so the user can immediately see if image capture is working.
 *
 * @param count - Number of frames captured so far
 */
export function updateFrameCount(count: number): void {
  const frameCountInfo = document.getElementById('frame-count-info');
  const frameCountSpan = document.getElementById('frame-count');
  if (frameCountInfo && frameCountSpan) {
    frameCountInfo.classList.remove('hidden');
    frameCountSpan.textContent = String(count);
    // Color: red if stuck at 0 after a while, green otherwise
    frameCountSpan.className = count > 0 ? 'text-green-400' : 'text-yellow-400';
  }
}

/**
 * Hide the frame count display (e.g., when recording stops).
 */
export function hideFrameCount(): void {
  const frameCountInfo = document.getElementById('frame-count-info');
  if (frameCountInfo) {
    frameCountInfo.classList.add('hidden');
  }
}

/**
 * Sync status for display purposes.
 * Matches SyncStatus from sync-manager.ts.
 */
interface SyncStatusDisplay {
  state: 'idle' | 'active' | 'syncing';
  lastSyncTime: number | null;
  lastError: string | null;
}

/**
 * Format relative time (e.g., "30s ago", "2m ago")
 */
function formatRelativeTime(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Interval ID for refreshing relative time display in sync status */
let relativeTimeInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Update the sync status indicator in the HUD.
 *
 * Shows:
 * - Green "Xs ago" when sync is active and successful
 * - Yellow "⚠️ Error" when last sync failed
 * - "pending" when active but never synced
 * - Hidden when sync is idle
 *
 * Starts a 10s refresh timer so the relative time display stays current
 * between sync events.
 *
 * @param status - Current sync status
 */
export function updateSyncStatus(status: SyncStatusDisplay): void {
  const syncInfo = document.getElementById('sync-info');
  const syncStatus = document.getElementById('sync-status');
  if (!syncInfo || !syncStatus) {
    return;
  }

  // Clear any existing refresh timer
  if (relativeTimeInterval !== null) {
    clearInterval(relativeTimeInterval);
    relativeTimeInterval = null;
  }

  // Hide if idle
  if (status.state === 'idle') {
    syncInfo.classList.add('hidden');
    return;
  }

  // Show the indicator
  syncInfo.classList.remove('hidden');

  // Reset classes
  syncStatus.classList.remove('text-green-400', 'text-yellow-400');

  // Format based on state
  if (status.lastError) {
    // Error state - yellow warning
    syncStatus.textContent = `⚠️ ${status.lastError}`;
    syncStatus.classList.add('text-yellow-400');
  } else if (status.lastSyncTime) {
    // Successful sync - green with relative time
    syncStatus.textContent = formatRelativeTime(status.lastSyncTime);
    syncStatus.classList.add('text-green-400');

    // Refresh relative time every 10s so it doesn't freeze
    const lastSync = status.lastSyncTime;
    relativeTimeInterval = setInterval(() => {
      syncStatus.textContent = formatRelativeTime(lastSync);
    }, 10_000);
  } else {
    // Active but never synced
    syncStatus.textContent = 'pending...';
    syncStatus.classList.add('text-green-400');
  }
}

/**
 * Hide the setup modal
 */
function hideSetupModal(): void {
  const modal = document.getElementById('setup-modal');
  modal?.classList.add('hidden');
}

/**
 * Show the setup modal.
 *
 * Used by the soft reset flow (Issue 4, 2026-02-06 user feedback) to return
 * the UI to the SETUP screen without a full page reload.
 */
export function showSetupModal(): void {
  const modal = document.getElementById('setup-modal');
  modal?.classList.remove('hidden');
}

/**
 * Options for resetUIForNewRecording.
 */
interface ResetUIOptions {
  /** If true, keep the folder-selected state (read folder handle persists). */
  keepFolder: boolean;
}

/**
 * Reset HUD state for a new recording session.
 *
 * Returns the UI to the SETUP screen: shows the setup modal, hides
 * recording/AR controls, clears the save location (each session needs a
 * new ZIP), and optionally preserves folder selection state.
 *
 * Issue 4 (2026-02-06 user feedback): Retain read permission on new recording.
 */
export function resetUIForNewRecording(options: ResetUIOptions): void {
  // Show setup modal, hide recording controls
  showSetupModal();
  if (cachedElements) {
    cachedElements.btnStart.classList.add('hidden');
    cachedElements.btnStop.classList.add('hidden');
    cachedElements.btnRefPoint.classList.add('hidden');
    cachedElements.recordingIndicator.classList.add('hidden');
  }

  // Always clear save location (new session = new ZIP)
  saveLocationSelected = false;
  const saveStatus = document.getElementById('save-status');
  if (saveStatus) {
    saveStatus.textContent = '';
  }

  // Conditionally clear folder selection
  if (!options.keepFolder) {
    folderSelected = false;
    const folderStatus = document.getElementById('folder-status');
    if (folderStatus) {
      folderStatus.textContent = '';
    }
  }

  validateEnterButton();
}

/**
 * Show AR ready controls (after AR session starts, before recording begins).
 *
 * Per the Application State Machine (README.md#application-state-machine):
 * In AR_READY state, the Start button is visible so the user can
 * explicitly choose when to begin recording.
 *
 * Issue #2 fix: Previously this showed Stop button, which was confusing.
 */

const DEFAULT_REF_POINT_LABEL = '📍 Mark Point';

export function showArReadyControls(): void {
  if (!cachedElements) {
    throw new Error('showArReadyControls called before initUI()');
  }
  // Show Start button (user must explicitly start recording)
  cachedElements.btnStart.classList.remove('hidden');
  // Hide Stop button (not recording yet)
  cachedElements.btnStop.classList.add('hidden');
  // Hide ref point button (only available during recording)
  cachedElements.btnRefPoint.classList.add('hidden');
  // Hide secondary "add new ref point" button
  cachedElements.btnNewRefPoint.classList.add('hidden');
  // Hide recording indicator (not recording yet)
  cachedElements.recordingIndicator.classList.add('hidden');
  // Reset ref point button label for next session (Change D)
  cachedElements.btnRefPoint.textContent = DEFAULT_REF_POINT_LABEL;
}

/**
 * Update the ref point button label to reflect proximity to a known ref point.
 * Called on each GPS update during recording. Pass `undefined` to reset to default.
 */
export function updateRefPointButtonLabel(refPointName?: string): void {
  if (!cachedElements) {
    return;
  }
  cachedElements.btnRefPoint.textContent = refPointName
    ? `📍 Capture '${refPointName}'`
    : DEFAULT_REF_POINT_LABEL;
}

/**
 * Show or hide the secondary "+" button for creating a new ref point
 * when the user is in a neighboring H3 cell of an existing ref point.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
export function setNewRefPointButtonVisible(visible: boolean): void {
  if (!cachedElements) {
    return;
  }
  cachedElements.btnNewRefPoint.classList.toggle('hidden', !visible);
}

/**
 * Show recording controls (after recording starts).
 *
 * Per the Application State Machine (README.md#application-state-machine):
 * In RECORDING state, the Stop button is visible and Start is hidden.
 */
export function showRecordingControls(): void {
  if (!cachedElements) {
    throw new Error('showRecordingControls called before initUI()');
  }
  cachedElements.btnStart.classList.add('hidden');
  cachedElements.btnStop.classList.remove('hidden');
  cachedElements.btnRefPoint.classList.remove('hidden');

  // Show recording indicator
  cachedElements.recordingIndicator.classList.remove('hidden');
}

/**
 * Hide recording controls and return to AR_READY state (after recording stops).
 *
 * This is semantically equivalent to showArReadyControls() but named for the
 * transition context (stopping recording) rather than the destination state.
 * Keeping both allows callers to express intent clearly.
 */
export function hideRecordingControls(): void {
  showArReadyControls();
}

/**
 * Enable/disable the Enter AR button based on form validity.
 * Also updates the hint text to guide users on what action is needed.
 *
 * Requirements (Issue 1a-fix):
 * 1. Permissions must be ready (camera, location)
 * 2. Folder must be selected (for reading previous recordings)
 * 3. Save location must be chosen (for writing new recording)
 * 4. A scenario must be selected or new scenario name entered
 */
export function validateEnterButton(): void {
  if (!cachedElements) {
    throw new Error('validateEnterButton called before initUI()');
  }
  const { btnEnterAR, scenarioSelect } = cachedElements;
  // newScenarioName is optional - only shown when creating new scenario
  const newScenarioName = document.getElementById(
    'new-scenario-name'
  ) as HTMLInputElement | null;
  // Hint element for user guidance
  const hint = document.getElementById('enter-ar-hint');

  let valid = false;
  let hintText = '';

  // Check requirements in order of UI flow
  if (!folderSelected) {
    hintText = 'Open a folder with previous recordings';
  } else if (!saveLocationSelected) {
    hintText = 'Choose a save location for this recording';
  } else if (!permissionsReady) {
    hintText = 'Grant required permissions to continue';
  } else if (scenarioSelect.value && scenarioSelect.value !== '__new__') {
    valid = true;
  } else if (scenarioSelect.value === '__new__') {
    if (newScenarioName?.value.trim()) {
      valid = true;
    } else {
      hintText = 'Enter a scenario name to continue';
    }
  } else {
    // Fallback for unexpected states (e.g., dropdown enabled but no value)
    hintText = 'Please select or create a scenario';
  }

  btnEnterAR.disabled = !valid;

  // Update hint visibility and text
  if (hint) {
    if (valid) {
      hint.classList.add('hidden');
    } else {
      hint.classList.remove('hidden');
      hint.textContent = hintText;
    }
  }
}

/**
 * Populate the scenario dropdown with existing scenarios
 */
export function populateScenarios(scenarios: string[]): void {
  if (!cachedElements) {
    throw new Error('populateScenarios called before initUI()');
  }
  const { scenarioSelect } = cachedElements;
  // sessionNotes is optional - graceful degradation allowed
  const sessionNotes = document.getElementById(
    'session-notes'
  ) as HTMLTextAreaElement | null;

  scenarioSelect.innerHTML = '';
  scenarioSelect.disabled = false;

  // Add "new scenario" option
  const newOption = document.createElement('option');
  newOption.value = '__new__';
  newOption.textContent = '+ Create new scenario';
  scenarioSelect.appendChild(newOption);

  // Add existing scenarios
  for (const name of scenarios) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    scenarioSelect.appendChild(opt);
  }

  // Enable notes
  if (sessionNotes) {
    sessionNotes.disabled = false;
  }

  // Select first existing scenario if available, otherwise handle new scenario flow
  if (scenarios.length > 0) {
    scenarioSelect.value = scenarios[0]!;
    // Programmatic value change doesn't fire 'change' event, so we need to
    // manually notify main.ts to sync currentScenarioName
    callbacks?.onScenarioChange(scenarios[0]!);
    // Hide new scenario section since an existing scenario is selected
    const newScenarioSection = document.getElementById('new-scenario-section');
    newScenarioSection?.classList.add('hidden');
    newScenarioSection?.classList.remove('opacity-100');
    newScenarioSection?.classList.add('opacity-0');
  } else {
    // No existing scenarios - the only option is "__new__"
    // Browser auto-selects it but doesn't fire change event, so we need to
    // manually show the new scenario input section and focus it
    scenarioSelect.value = '__new__';
    const newScenarioSection = document.getElementById('new-scenario-section');
    const newScenarioNameInput = document.getElementById(
      'new-scenario-name'
    ) as HTMLInputElement | null;
    newScenarioSection?.classList.remove('hidden');
    // Use requestAnimationFrame to ensure transition triggers after display change
    requestAnimationFrame(() => {
      newScenarioSection?.classList.remove('opacity-0');
      newScenarioSection?.classList.add('opacity-100');
    });
    newScenarioNameInput?.focus();
  }

  validateEnterButton();
}

/**
 * Update the permission status display in the setup modal.
 * Shows visual indicators for each permission and updates the
 * "Grant Permissions" button visibility.
 */
export function updatePermissionStatus(result: PermissionCheckResult): void {
  // Update internal state
  permissionsReady = result.allMandatoryReady;

  // Update File Storage status (shown first per user feedback Issue #1)
  updateSinglePermissionStatus(
    'perm-filestorage-status',
    result.fileSystem.supported,
    result.fileSystem.granted,
    result.fileSystem.error
  );

  // Update WebXR status
  updateSinglePermissionStatus(
    'perm-webxr-status',
    result.webxr.supported,
    result.webxr.granted,
    result.webxr.error
  );

  // Update Geolocation status
  updateSinglePermissionStatus(
    'perm-gps-status',
    result.geolocation.supported,
    result.geolocation.granted,
    result.geolocation.error
  );

  // Update Camera status
  updateSinglePermissionStatus(
    'perm-camera-status',
    result.camera.supported,
    result.camera.granted,
    result.camera.error
  );

  // Update Orientation status
  updateSinglePermissionStatus(
    'perm-orientation-status',
    result.orientation.supported,
    result.orientation.granted,
    result.orientation.error
  );

  // Show/hide "Grant Permissions" button based on whether any permissions need requesting
  const btnRequestPermissions = document.getElementById(
    'btn-request-permissions'
  );
  const needsRequest =
    (result.geolocation.supported && result.geolocation.granted === null) ||
    (result.camera.supported && result.camera.granted === null) ||
    (result.orientation.supported && result.orientation.granted === null);

  if (btnRequestPermissions) {
    if (needsRequest) {
      btnRequestPermissions.classList.remove('hidden');
    } else {
      btnRequestPermissions.classList.add('hidden');
    }
  }

  // Show any critical errors
  const permissionError = document.getElementById('permission-error');
  if (permissionError) {
    const errors: string[] = [];
    if (!result.webxr.supported && result.webxr.error) {
      errors.push(result.webxr.error);
    }

    // File system access errors need special handling - show inline message
    if (result.fileSystem.granted === false && result.fileSystem.error) {
      errors.push(result.fileSystem.error);
    }

    // Consolidate denied permission messages for conciseness (consistent with main.ts)
    const denied: string[] = [];
    if (result.geolocation.granted === false) {
      denied.push('Location');
    }
    if (result.camera.granted === false) {
      denied.push('Camera');
    }
    if (denied.length > 0) {
      errors.push(
        `${listFormatter.format(denied)} access denied. Please enable in browser settings.`
      );
    }

    if (errors.length > 0) {
      permissionError.textContent = errors.join(' ');
      permissionError.classList.remove('hidden');
    } else {
      permissionError.classList.add('hidden');
    }
  }

  // Re-validate Enter AR button with new permission state
  validateEnterButton();
}

/**
 * Update a single permission status indicator.
 */
function updateSinglePermissionStatus(
  elementId: string,
  supported: boolean,
  granted: boolean | null,
  error?: string
): void {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  // Remove all color classes first
  element.classList.remove(
    'text-green-400',
    'text-red-400',
    'text-yellow-400',
    'text-gray-400'
  );

  if (!supported) {
    element.textContent = '❌ Not supported';
    element.classList.add('text-red-400');
    element.title = error ?? 'Feature not supported';
  } else if (granted === true) {
    element.textContent = '✅ Ready';
    element.classList.add('text-green-400');
    element.title = 'Permission granted';
  } else if (granted === false) {
    element.textContent = '❌ Denied';
    element.classList.add('text-red-400');
    element.title = error ?? 'Permission denied';
  } else {
    element.textContent = '⏳ Pending';
    element.classList.add('text-yellow-400');
    element.title = 'Permission not yet requested';
  }
}

/**
 * Set the permissionsReady flag directly.
 * Used for testing to simulate permission states.
 * @internal
 */
export function setPermissionsReady(ready: boolean): void {
  permissionsReady = ready;
}

/**
 * Set the folderSelected flag.
 * Called after user successfully selects a folder for reading.
 * @internal
 */
export function setFolderSelected(selected: boolean): void {
  folderSelected = selected;
}

/**
 * Get the current folderSelected state.
 * Used for testing.
 * @internal
 */
export function getFolderSelected(): boolean {
  return folderSelected;
}

/**
 * Set the saveLocationSelected flag.
 * Called after user successfully chooses a save location.
 * @internal
 */
export function setSaveLocationSelected(selected: boolean): void {
  saveLocationSelected = selected;
}

/**
 * Get the current saveLocationSelected state.
 * Used for testing.
 * @internal
 */
export function getSaveLocationSelected(): boolean {
  return saveLocationSelected;
}

// --- Help Section (Issue 2 - User Feedback 2026-01-27) ---

/**
 * localStorage key for help section collapsed state.
 * ⚠️ Also defined in playwright-tests/help-section.spec.js — keep in sync!
 */
const HELP_COLLAPSED_KEY = 'gps-recorder-help-collapsed';

/**
 * Initialize the collapsible help section.
 * - Restores collapsed state from localStorage
 * - Saves state changes when user toggles the section
 *
 * The help section is open by default for first-time users to explain
 * key concepts (scenario, session, reference points). Once a user closes it,
 * the preference is remembered.
 */
function initHelpSection(): void {
  const helpSection = document.getElementById(
    'help-section'
  ) as HTMLDetailsElement | null;
  if (!helpSection) {
    // Help section not in DOM - graceful degradation
    return;
  }

  // Restore collapsed state from localStorage
  const wasCollapsed = localStorage.getItem(HELP_COLLAPSED_KEY) === 'true';
  if (wasCollapsed) {
    helpSection.removeAttribute('open');
  }

  // Save state when user toggles the section
  helpSection.addEventListener('toggle', () => {
    const isNowOpen = helpSection.open;
    if (isNowOpen) {
      // User expanded - remove the collapsed flag
      localStorage.removeItem(HELP_COLLAPSED_KEY);
    } else {
      // User collapsed - remember this preference
      localStorage.setItem(HELP_COLLAPSED_KEY, 'true');
    }
  });
}
