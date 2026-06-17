/**
 * Settings Modal - UI for configuring recording options.
 *
 * Provides a modal dialog for users to toggle and configure
 * depth sampling and image capture settings.
 */

import {
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
  cloneRecordingOptions,
  DEPTH_CONSTRAINTS,
  IMAGE_CONSTRAINTS,
  OCCUPANCY_CONSTRAINTS,
  QR_CONSTRAINTS,
  type RecordingOptions,
} from 'gps-plus-slam-app-framework/state/recording-options';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { getBuildInfo } from '../utils/build-info';
import { showConfirmDialog } from './confirm-dialog';

const log = createLogger('SettingsModal');

// --- State ---

/** Current working copy of options (not saved until user clicks Save) */
let workingOptions: RecordingOptions | null = null;

/** Callback to notify when options are saved */
let onOptionsChanged: ((options: RecordingOptions) => void) | null = null;

/** Callback to clear the reference-point cache across all scenarios */
let onClearRefPointCache: (() => void | Promise<void>) | null = null;

// --- DOM Elements ---

let modal: HTMLElement | null = null;
let depthEnabledCheckbox: HTMLInputElement | null = null;
let depthIntervalSlider: HTMLInputElement | null = null;
let depthIntervalValue: HTMLElement | null = null;
let depthGridSlider: HTMLInputElement | null = null;
let depthGridValue: HTMLElement | null = null;
let depthRgbCheckbox: HTMLInputElement | null = null;
let imagesEnabledCheckbox: HTMLInputElement | null = null;
let imagesIntervalSlider: HTMLInputElement | null = null;
let imagesIntervalValue: HTMLElement | null = null;
let imagesQualitySlider: HTMLInputElement | null = null;
let imagesQualityValue: HTMLElement | null = null;
let imagesResolutionDivisorSlider: HTMLInputElement | null = null;
let imagesResolutionDivisorValue: HTMLElement | null = null;
let arDomOverlayEnabledCheckbox: HTMLInputElement | null = null;
let arCameraAccessEnabledCheckbox: HTMLInputElement | null = null;
let arDepthSensingEnabledCheckbox: HTMLInputElement | null = null;
let arCss3dEnabledCheckbox: HTMLInputElement | null = null;
let arCameraTextureEnabledCheckbox: HTMLInputElement | null = null;
let arChromiumProjectionLayerWorkaroundCheckbox: HTMLInputElement | null = null;
let occupancyCellSizeSlider: HTMLInputElement | null = null;
let occupancyCellSizeValue: HTMLElement | null = null;
let vizFrameTilesCheckbox: HTMLInputElement | null = null;
let vizOccupancyCubesCheckbox: HTMLInputElement | null = null;
let vizGpsAlignmentMarkersCheckbox: HTMLInputElement | null = null;
let vizCompassCubesCheckbox: HTMLInputElement | null = null;
let qrEnabledCheckbox: HTMLInputElement | null = null;
let qrIntervalSlider: HTMLInputElement | null = null;
let qrIntervalValue: HTMLElement | null = null;
let qrCaptureSizeSlider: HTMLInputElement | null = null;
let qrCaptureSizeValue: HTMLElement | null = null;

// --- Initialization ---

/**
 * Initialize the settings modal.
 * Should be called once after DOM is ready.
 *
 * @param changeCallback - Called when options are saved
 */
export function initSettingsModal(
  changeCallback?: (options: RecordingOptions) => void,
  clearRefPointCacheCallback?: () => void | Promise<void>
): void {
  onOptionsChanged = changeCallback ?? null;
  onClearRefPointCache = clearRefPointCacheCallback ?? null;

  // Get modal elements
  modal = document.getElementById('settings-modal');
  if (!modal) {
    log.warn('Settings modal element not found in DOM');
    return;
  }

  // Get button elements
  const btnSettings = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-settings-close');
  const btnSave = document.getElementById('btn-settings-save');
  const btnReset = document.getElementById('btn-settings-reset');
  const btnMinimalBaseline = document.getElementById('btn-ar-minimal-baseline');
  const btnClearRefPointCache = document.getElementById(
    'btn-clear-refpoint-cache'
  );

  // Get form elements
  depthEnabledCheckbox = document.getElementById(
    'depth-enabled'
  ) as HTMLInputElement;
  depthIntervalSlider = document.getElementById(
    'depth-interval'
  ) as HTMLInputElement;
  depthIntervalValue = document.getElementById('depth-interval-value');
  depthGridSlider = document.getElementById('depth-grid') as HTMLInputElement;
  depthGridValue = document.getElementById('depth-grid-value');
  depthRgbCheckbox = document.getElementById('depth-rgb') as HTMLInputElement;

  imagesEnabledCheckbox = document.getElementById(
    'images-enabled'
  ) as HTMLInputElement;
  imagesIntervalSlider = document.getElementById(
    'images-interval'
  ) as HTMLInputElement;
  imagesIntervalValue = document.getElementById('images-interval-value');
  imagesQualitySlider = document.getElementById(
    'images-quality'
  ) as HTMLInputElement;
  imagesQualityValue = document.getElementById('images-quality-value');
  imagesResolutionDivisorSlider = document.getElementById(
    'images-resolution-divisor'
  ) as HTMLInputElement;
  imagesResolutionDivisorValue = document.getElementById(
    'images-resolution-divisor-value'
  );
  arDomOverlayEnabledCheckbox = document.getElementById(
    'ar-dom-overlay-enabled'
  ) as HTMLInputElement;
  arCameraAccessEnabledCheckbox = document.getElementById(
    'ar-camera-access-enabled'
  ) as HTMLInputElement;
  arDepthSensingEnabledCheckbox = document.getElementById(
    'ar-depth-sensing-enabled'
  ) as HTMLInputElement;
  arCss3dEnabledCheckbox = document.getElementById(
    'ar-css3d-enabled'
  ) as HTMLInputElement;
  arCameraTextureEnabledCheckbox = document.getElementById(
    'ar-camera-texture-enabled'
  ) as HTMLInputElement;
  arChromiumProjectionLayerWorkaroundCheckbox = document.getElementById(
    'ar-chromium-projection-layer-workaround'
  ) as HTMLInputElement;
  occupancyCellSizeSlider = document.getElementById(
    'occupancy-cell-size'
  ) as HTMLInputElement;
  occupancyCellSizeValue = document.getElementById('occupancy-cell-size-value');
  vizFrameTilesCheckbox = document.getElementById(
    'viz-frame-tiles'
  ) as HTMLInputElement;
  vizOccupancyCubesCheckbox = document.getElementById(
    'viz-occupancy-cubes'
  ) as HTMLInputElement;
  vizGpsAlignmentMarkersCheckbox = document.getElementById(
    'viz-gps-alignment-markers'
  ) as HTMLInputElement;
  vizCompassCubesCheckbox = document.getElementById(
    'viz-compass-cubes'
  ) as HTMLInputElement;
  qrEnabledCheckbox = document.getElementById('qr-enabled') as HTMLInputElement;
  qrIntervalSlider = document.getElementById('qr-interval') as HTMLInputElement;
  qrIntervalValue = document.getElementById('qr-interval-value');
  qrCaptureSizeSlider = document.getElementById(
    'qr-capture-size'
  ) as HTMLInputElement;
  qrCaptureSizeValue = document.getElementById('qr-capture-size-value');

  // Wire up events
  btnSettings?.addEventListener('click', showSettingsModal);
  btnClose?.addEventListener('click', hideSettingsModal);
  btnSave?.addEventListener('click', handleSave);
  btnReset?.addEventListener('click', handleReset);
  btnMinimalBaseline?.addEventListener('click', applyMinimalArBaselinePreset);
  btnClearRefPointCache?.addEventListener('click', () => {
    void handleClearRefPointCache();
  });

  // Modal backdrop click to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideSettingsModal();
    }
  });

  // Slider change handlers
  depthIntervalSlider?.addEventListener('input', () => {
    if (workingOptions && depthIntervalSlider && depthIntervalValue) {
      const value = parseInt(depthIntervalSlider.value, 10);
      workingOptions.depth.intervalMs = value;
      depthIntervalValue.textContent = `${(value / 1000).toFixed(1)}s`;
    }
  });

  depthGridSlider?.addEventListener('input', () => {
    if (workingOptions && depthGridSlider && depthGridValue) {
      const value = parseInt(depthGridSlider.value, 10);
      workingOptions.depth.gridSize = value;
      depthGridValue.textContent = `${value}×${value}`;
    }
  });

  imagesIntervalSlider?.addEventListener('input', () => {
    if (workingOptions && imagesIntervalSlider && imagesIntervalValue) {
      const value = parseInt(imagesIntervalSlider.value, 10);
      workingOptions.images.intervalMs = value;
      imagesIntervalValue.textContent = `${(value / 1000).toFixed(1)}s`;
    }
  });

  imagesQualitySlider?.addEventListener('input', () => {
    if (workingOptions && imagesQualitySlider && imagesQualityValue) {
      const value = parseFloat(imagesQualitySlider.value);
      workingOptions.images.quality = value;
      imagesQualityValue.textContent = `${Math.round(value * 100)}%`;
    }
  });

  imagesResolutionDivisorSlider?.addEventListener('input', () => {
    if (
      workingOptions &&
      imagesResolutionDivisorSlider &&
      imagesResolutionDivisorValue
    ) {
      const value = parseInt(imagesResolutionDivisorSlider.value, 10);
      workingOptions.images.resolutionDivisor = value;
      imagesResolutionDivisorValue.textContent = formatResolutionDivisor(value);
    }
  });

  // Voxel size slider operates in centimetres for readability; the stored
  // option (`occupancy.cellSizeM`) is in metres, so divide by 100 on the way in.
  occupancyCellSizeSlider?.addEventListener('input', () => {
    if (workingOptions && occupancyCellSizeSlider && occupancyCellSizeValue) {
      const cm = parseInt(occupancyCellSizeSlider.value, 10);
      workingOptions.occupancy.cellSizeM = cm / 100;
      occupancyCellSizeValue.textContent = `${cm} cm`;
    }
  });

  // Checkbox change handlers
  depthEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && depthEnabledCheckbox) {
      workingOptions.depth.enabled = depthEnabledCheckbox.checked;
      updateDepthControlsState();
    }
  });

  depthRgbCheckbox?.addEventListener('change', () => {
    if (workingOptions && depthRgbCheckbox) {
      workingOptions.depth.rgb = depthRgbCheckbox.checked;
    }
  });

  imagesEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && imagesEnabledCheckbox) {
      workingOptions.images.enabled = imagesEnabledCheckbox.checked;
      updateImageControlsState();
    }
  });

  arDomOverlayEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arDomOverlayEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableDomOverlay =
        arDomOverlayEnabledCheckbox.checked;
    }
  });

  arCameraAccessEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arCameraAccessEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableCameraAccess =
        arCameraAccessEnabledCheckbox.checked;
    }
  });

  arDepthSensingEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arDepthSensingEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableDepthSensingFeature =
        arDepthSensingEnabledCheckbox.checked;
    }
  });

  arCss3dEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arCss3dEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableCss3dRenderer =
        arCss3dEnabledCheckbox.checked;
    }
  });

  arCameraTextureEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && arCameraTextureEnabledCheckbox) {
      workingOptions.arCrashIsolation.enableCameraTextureAcquisition =
        arCameraTextureEnabledCheckbox.checked;
    }
  });

  arChromiumProjectionLayerWorkaroundCheckbox?.addEventListener(
    'change',
    () => {
      if (workingOptions && arChromiumProjectionLayerWorkaroundCheckbox) {
        workingOptions.arCrashIsolation.applyChromiumProjectionLayerWorkaround =
          arChromiumProjectionLayerWorkaroundCheckbox.checked;
      }
    }
  );

  // Live debug-overlay toggles (Finding B). Each gates only what is drawn live
  // during recording; replay is unaffected. Read once at the next Enter-AR.
  vizFrameTilesCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizFrameTilesCheckbox) {
      workingOptions.visualization.frameTiles = vizFrameTilesCheckbox.checked;
    }
  });

  vizOccupancyCubesCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizOccupancyCubesCheckbox) {
      workingOptions.visualization.occupancyCubes =
        vizOccupancyCubesCheckbox.checked;
    }
  });

  vizGpsAlignmentMarkersCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizGpsAlignmentMarkersCheckbox) {
      workingOptions.visualization.gpsAlignmentMarkers =
        vizGpsAlignmentMarkersCheckbox.checked;
    }
  });

  vizCompassCubesCheckbox?.addEventListener('change', () => {
    if (workingOptions && vizCompassCubesCheckbox) {
      workingOptions.visualization.compassCubes =
        vizCompassCubesCheckbox.checked;
    }
  });

  // QR detection (recorder live-QR WS-2/WS-5). Opt-in; the interval + capture
  // sliders are gated on the enabled checkbox (mirrors depth/images).
  qrEnabledCheckbox?.addEventListener('change', () => {
    if (workingOptions && qrEnabledCheckbox) {
      workingOptions.qr.enabled = qrEnabledCheckbox.checked;
      updateQrControlsState();
    }
  });

  qrIntervalSlider?.addEventListener('input', () => {
    if (workingOptions && qrIntervalSlider && qrIntervalValue) {
      const value = parseInt(qrIntervalSlider.value, 10);
      workingOptions.qr.intervalMs = value;
      qrIntervalValue.textContent = `${value} ms`;
    }
  });

  qrCaptureSizeSlider?.addEventListener('input', () => {
    if (workingOptions && qrCaptureSizeSlider && qrCaptureSizeValue) {
      const value = parseInt(qrCaptureSizeSlider.value, 10);
      workingOptions.qr.captureSize = value;
      qrCaptureSizeValue.textContent = `${value} px`;
    }
  });

  // Populate build version label (one-time, build info is constant)
  const buildLabel = document.getElementById('build-version-label');
  if (buildLabel) {
    try {
      const info = getBuildInfo();
      buildLabel.textContent = `${info.appVersion} (${info.commitHash})`;
    } catch (error) {
      buildLabel.textContent = 'Build unavailable';
      log.warn('Build metadata unavailable for settings modal', error);
    }
  }

  log.debug('Settings modal initialized');
}

// --- Show / Hide ---

/**
 * Format the resolution divisor value for display.
 * 1 → "1× (full)", 2 → "÷2 (half)", 4 → "÷4 (quarter)", etc.
 */
function formatResolutionDivisor(divisor: number): string {
  if (divisor <= 1) {
    return '1× (full)';
  }
  if (divisor === 2) {
    return '÷2 (half)';
  }
  if (divisor === 4) {
    return '÷4 (quarter)';
  }
  return `÷${divisor}`;
}

/**
 * Show the settings modal.
 * Loads current options and populates form.
 */
export function showSettingsModal(): void {
  if (!modal) {
    log.warn('Settings modal not initialized');
    return;
  }

  // Load current options and create working copy
  workingOptions = cloneRecordingOptions(loadRecordingOptions());

  // Populate form with current values
  populateForm(workingOptions);

  // Show modal
  modal.classList.remove('hidden');
  log.debug('Settings modal shown');
}

/**
 * Hide the settings modal.
 * Discards any unsaved changes.
 */
export function hideSettingsModal(): void {
  if (!modal) {
    return;
  }

  modal.classList.add('hidden');
  workingOptions = null;
  log.debug('Settings modal hidden');
}

/**
 * Check if the settings modal is currently visible.
 */
export function isSettingsModalVisible(): boolean {
  return modal !== null && !modal.classList.contains('hidden');
}

// --- Form Population ---

function populateForm(options: RecordingOptions): void {
  // Depth options
  if (depthEnabledCheckbox) {
    depthEnabledCheckbox.checked = options.depth.enabled;
  }
  if (depthIntervalSlider) {
    depthIntervalSlider.min = String(DEPTH_CONSTRAINTS.intervalMs.min);
    depthIntervalSlider.max = String(DEPTH_CONSTRAINTS.intervalMs.max);
    depthIntervalSlider.step = String(DEPTH_CONSTRAINTS.intervalMs.step);
    depthIntervalSlider.value = String(options.depth.intervalMs);
  }
  if (depthIntervalValue) {
    depthIntervalValue.textContent = `${(options.depth.intervalMs / 1000).toFixed(1)}s`;
  }
  if (depthGridSlider) {
    depthGridSlider.min = String(DEPTH_CONSTRAINTS.gridSize.min);
    depthGridSlider.max = String(DEPTH_CONSTRAINTS.gridSize.max);
    depthGridSlider.step = String(DEPTH_CONSTRAINTS.gridSize.step);
    depthGridSlider.value = String(options.depth.gridSize);
  }
  if (depthGridValue) {
    depthGridValue.textContent = `${options.depth.gridSize}×${options.depth.gridSize}`;
  }
  if (depthRgbCheckbox) {
    depthRgbCheckbox.checked = options.depth.rgb;
  }

  // Image options
  if (imagesEnabledCheckbox) {
    imagesEnabledCheckbox.checked = options.images.enabled;
  }
  if (imagesIntervalSlider) {
    imagesIntervalSlider.min = String(IMAGE_CONSTRAINTS.intervalMs.min);
    imagesIntervalSlider.max = String(IMAGE_CONSTRAINTS.intervalMs.max);
    imagesIntervalSlider.step = String(IMAGE_CONSTRAINTS.intervalMs.step);
    imagesIntervalSlider.value = String(options.images.intervalMs);
  }
  if (imagesIntervalValue) {
    imagesIntervalValue.textContent = `${(options.images.intervalMs / 1000).toFixed(1)}s`;
  }
  if (imagesQualitySlider) {
    imagesQualitySlider.min = String(IMAGE_CONSTRAINTS.quality.min);
    imagesQualitySlider.max = String(IMAGE_CONSTRAINTS.quality.max);
    imagesQualitySlider.step = String(IMAGE_CONSTRAINTS.quality.step);
    imagesQualitySlider.value = String(options.images.quality);
  }
  if (imagesQualityValue) {
    imagesQualityValue.textContent = `${Math.round(options.images.quality * 100)}%`;
  }
  if (imagesResolutionDivisorSlider) {
    imagesResolutionDivisorSlider.min = String(
      IMAGE_CONSTRAINTS.resolutionDivisor.min
    );
    imagesResolutionDivisorSlider.max = String(
      IMAGE_CONSTRAINTS.resolutionDivisor.max
    );
    imagesResolutionDivisorSlider.step = String(
      IMAGE_CONSTRAINTS.resolutionDivisor.step
    );
    imagesResolutionDivisorSlider.value = String(
      options.images.resolutionDivisor
    );
  }
  if (imagesResolutionDivisorValue) {
    imagesResolutionDivisorValue.textContent = formatResolutionDivisor(
      options.images.resolutionDivisor
    );
  }

  if (arDomOverlayEnabledCheckbox) {
    arDomOverlayEnabledCheckbox.checked =
      options.arCrashIsolation.enableDomOverlay;
  }
  if (arCameraAccessEnabledCheckbox) {
    arCameraAccessEnabledCheckbox.checked =
      options.arCrashIsolation.enableCameraAccess;
  }
  if (arDepthSensingEnabledCheckbox) {
    arDepthSensingEnabledCheckbox.checked =
      options.arCrashIsolation.enableDepthSensingFeature;
  }
  if (arCss3dEnabledCheckbox) {
    arCss3dEnabledCheckbox.checked =
      options.arCrashIsolation.enableCss3dRenderer;
  }
  if (arCameraTextureEnabledCheckbox) {
    arCameraTextureEnabledCheckbox.checked =
      options.arCrashIsolation.enableCameraTextureAcquisition;
  }
  if (arChromiumProjectionLayerWorkaroundCheckbox) {
    arChromiumProjectionLayerWorkaroundCheckbox.checked =
      options.arCrashIsolation.applyChromiumProjectionLayerWorkaround;
  }

  // Occupancy voxel size — slider min/max/step are in cm (constraints are in m).
  if (occupancyCellSizeSlider) {
    occupancyCellSizeSlider.min = String(
      OCCUPANCY_CONSTRAINTS.cellSizeM.min * 100
    );
    occupancyCellSizeSlider.max = String(
      OCCUPANCY_CONSTRAINTS.cellSizeM.max * 100
    );
    occupancyCellSizeSlider.step = String(
      OCCUPANCY_CONSTRAINTS.cellSizeM.step * 100
    );
    occupancyCellSizeSlider.value = String(
      Math.round(options.occupancy.cellSizeM * 100)
    );
  }
  if (occupancyCellSizeValue) {
    occupancyCellSizeValue.textContent = `${Math.round(options.occupancy.cellSizeM * 100)} cm`;
  }

  // Live debug-overlay toggles (Finding B)
  if (vizFrameTilesCheckbox) {
    vizFrameTilesCheckbox.checked = options.visualization.frameTiles;
  }
  if (vizOccupancyCubesCheckbox) {
    vizOccupancyCubesCheckbox.checked = options.visualization.occupancyCubes;
  }
  if (vizGpsAlignmentMarkersCheckbox) {
    vizGpsAlignmentMarkersCheckbox.checked =
      options.visualization.gpsAlignmentMarkers;
  }
  if (vizCompassCubesCheckbox) {
    vizCompassCubesCheckbox.checked = options.visualization.compassCubes;
  }

  // QR detection (opt-in). Interval slider in ms, capture-size slider in px.
  if (qrEnabledCheckbox) {
    qrEnabledCheckbox.checked = options.qr.enabled;
  }
  if (qrIntervalSlider) {
    qrIntervalSlider.min = String(QR_CONSTRAINTS.intervalMs.min);
    qrIntervalSlider.max = String(QR_CONSTRAINTS.intervalMs.max);
    qrIntervalSlider.step = String(QR_CONSTRAINTS.intervalMs.step);
    qrIntervalSlider.value = String(options.qr.intervalMs);
  }
  if (qrIntervalValue) {
    qrIntervalValue.textContent = `${options.qr.intervalMs} ms`;
  }
  if (qrCaptureSizeSlider) {
    qrCaptureSizeSlider.min = String(QR_CONSTRAINTS.captureSize.min);
    qrCaptureSizeSlider.max = String(QR_CONSTRAINTS.captureSize.max);
    qrCaptureSizeSlider.step = String(QR_CONSTRAINTS.captureSize.step);
    qrCaptureSizeSlider.value = String(options.qr.captureSize);
  }
  if (qrCaptureSizeValue) {
    qrCaptureSizeValue.textContent = `${options.qr.captureSize} px`;
  }

  // Update enabled/disabled state of controls
  updateDepthControlsState();
  updateImageControlsState();
  updateQrControlsState();
}

function updateDepthControlsState(): void {
  const enabled = depthEnabledCheckbox?.checked ?? true;
  if (depthIntervalSlider) {
    depthIntervalSlider.disabled = !enabled;
  }
  if (depthGridSlider) {
    depthGridSlider.disabled = !enabled;
  }
  if (depthRgbCheckbox) {
    depthRgbCheckbox.disabled = !enabled;
  }
}

function updateImageControlsState(): void {
  const enabled = imagesEnabledCheckbox?.checked ?? true;
  if (imagesIntervalSlider) {
    imagesIntervalSlider.disabled = !enabled;
  }
  if (imagesQualitySlider) {
    imagesQualitySlider.disabled = !enabled;
  }
  if (imagesResolutionDivisorSlider) {
    imagesResolutionDivisorSlider.disabled = !enabled;
  }
}

function updateQrControlsState(): void {
  // QR is opt-in (default off), so the sliders start disabled until enabled.
  const enabled = qrEnabledCheckbox?.checked ?? false;
  if (qrIntervalSlider) {
    qrIntervalSlider.disabled = !enabled;
  }
  if (qrCaptureSizeSlider) {
    qrCaptureSizeSlider.disabled = !enabled;
  }
}

// --- Actions ---

function handleSave(): void {
  if (!workingOptions) {
    return;
  }

  saveRecordingOptions(workingOptions);
  log.debug('Settings saved:', workingOptions);

  // Notify callback
  if (onOptionsChanged) {
    onOptionsChanged(cloneRecordingOptions(workingOptions));
  }

  hideSettingsModal();
}

function handleReset(): void {
  workingOptions = resetRecordingOptions();
  populateForm(workingOptions);
  log.debug('Settings reset to defaults');
}

async function handleClearRefPointCache(): Promise<void> {
  if (!onClearRefPointCache) {
    log.warn('Clear ref-point cache requested but no callback is wired');
    return;
  }

  const confirmed = await showConfirmDialog({
    message:
      'Clear cached reference points for all scenarios? They will be re-imported from your *.zip recordings the next time a scenario is opened. Observations not yet exported to a zip will be lost.',
    confirmLabel: 'Clear Cache',
    cancelLabel: 'Cancel',
  });

  if (!confirmed) {
    log.debug('User cancelled clearing ref-point cache');
    return;
  }

  try {
    await onClearRefPointCache();
    log.info('Ref-point cache cleared');
  } catch (err) {
    log.error('Failed to clear ref-point cache:', err);
  }
}

function applyMinimalArBaselinePreset(): void {
  if (!workingOptions) {
    return;
  }

  workingOptions.images.enabled = false;
  workingOptions.depth.enabled = false;
  workingOptions.arCrashIsolation.enableDomOverlay = false;
  workingOptions.arCrashIsolation.enableCameraAccess = false;
  workingOptions.arCrashIsolation.enableDepthSensingFeature = false;
  workingOptions.arCrashIsolation.enableCss3dRenderer = false;
  workingOptions.arCrashIsolation.enableCameraTextureAcquisition = false;

  populateForm(workingOptions);
  log.debug('Applied minimal AR baseline preset');
}

// --- Exported for testing ---

/**
 * Get the current working options (for testing).
 * Returns null if modal is not shown.
 */
export function getWorkingOptions(): RecordingOptions | null {
  return workingOptions ? cloneRecordingOptions(workingOptions) : null;
}
