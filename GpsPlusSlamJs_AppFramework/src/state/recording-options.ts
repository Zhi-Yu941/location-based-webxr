/**
 * Recording Options - User-configurable settings for data capture.
 *
 * Allows users to disable/configure high-frequency data streams
 * (depth sampling, image capture) to improve performance on lower-end devices.
 *
 * Options persist in localStorage across sessions.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('RecordingOptions');

// --- Types ---

/**
 * Input type for validateRecordingOptions allowing partial nested objects.
 * This allows passing incomplete objects that will be merged with defaults.
 */
export interface RecordingOptionsInput {
  depth?: Partial<DepthCaptureOptions>;
  images?: Partial<ImageCaptureOptions>;
  arCrashIsolation?: Partial<ArCrashIsolationOptions>;
}

/**
 * Diagnostic flags for isolating pre-recording AR startup crashes.
 * These gates affect XR session negotiation and frame-loop behavior,
 * independently of recording-time image/depth capture.
 */
export interface ArCrashIsolationOptions {
  enableDomOverlay: boolean;
  enableCameraAccess: boolean;
  enableDepthSensingFeature: boolean;
  enableCss3dRenderer: boolean;
  enableCameraTextureAcquisition: boolean;
  /**
   * Apply the Chromium WebXR camera-access tab-crash workaround at app
   * bootstrap. The workaround always deletes
   * `XRWebGLBinding.prototype.createProjectionLayer` /
   * `XRRenderState.prototype.layers` (forcing `XRWebGLLayer`) — required on
   * every affected Chrome build observed on-device, including Chrome 150 — and
   * additionally persists the `baseLayer` across
   * `XRSession.prototype.updateRenderState` only for Chrome builds inside the
   * affected window (148.0.7778.12 .. 149.0.7821).
   *
   * Default `true`. Opt-out is offered because forcing `XRWebGLLayer` may break
   * WebXR on unaffected (e.g. Quest) devices.
   *
   * @see GpsPlusSlamJs_AppFramework/src/ar/chromium-camera-access-workaround.ts
   * @see https://github.com/mrdoob/three.js/issues/33404
   */
  applyChromiumProjectionLayerWorkaround: boolean;
}

/**
 * Configuration for depth sampling during recording.
 */
export interface DepthCaptureOptions {
  /** Whether to capture depth samples. Default: true */
  enabled: boolean;
  /** Interval between samples in milliseconds. Default: 1000 */
  intervalMs: number;
  /** Grid size (N×N points per sample). Default: 3 */
  gridSize: number;
}

/**
 * Configuration for image capture during recording.
 */
export interface ImageCaptureOptions {
  /** Whether to capture images. Default: true */
  enabled: boolean;
  /** Interval between captures in milliseconds. Default: 2000 */
  intervalMs: number;
  /** JPEG quality (0.0 - 1.0). Default: 0.7 */
  quality: number;
  /** Resolution divisor: 1 = full native resolution, 2 = half, 4 = quarter. Default: 1 */
  resolutionDivisor: number;
}

/**
 * User-configurable recording options.
 * Persisted to localStorage for cross-session consistency.
 */
export interface RecordingOptions {
  /** Depth sampling configuration */
  depth: DepthCaptureOptions;
  /** Image capture configuration */
  images: ImageCaptureOptions;
  /** Diagnostic flags for pre-recording AR crash isolation */
  arCrashIsolation: ArCrashIsolationOptions;
}

// --- Constants ---

/**
 * localStorage key for persisted options.
 *
 * **Multi-tab caveat:** All tabs/instances sharing the same origin will
 * read and write this key. In multi-tab or embedded scenarios, concurrent
 * saves can silently overwrite each other. Use a custom `storageKey`
 * parameter in `loadRecordingOptions` / `saveRecordingOptions` to isolate
 * instances when needed.
 */
export const STORAGE_KEY = 'gps-plus-slam-recorder-options';

/** Default recording options (all streams enabled) */
export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  depth: {
    enabled: true,
    intervalMs: 1000, // 1 sample per second
    gridSize: 3, // 3×3 = 9 points per sample
  },
  images: {
    enabled: true,
    intervalMs: 2000, // 1 image every 2 seconds
    quality: 0.7, // 70% JPEG quality
    resolutionDivisor: 1, // Full native camera resolution
  },
  arCrashIsolation: {
    enableDomOverlay: true,
    enableCameraAccess: true,
    enableDepthSensingFeature: true,
    enableCss3dRenderer: true,
    enableCameraTextureAcquisition: true,
    applyChromiumProjectionLayerWorkaround: true,
  },
};

/** Validation constraints for depth options */
export const DEPTH_CONSTRAINTS = {
  intervalMs: { min: 500, max: 5000, step: 100 },
  gridSize: { min: 2, max: 10, step: 1 },
} as const;

/** Validation constraints for image options */
export const IMAGE_CONSTRAINTS = {
  intervalMs: { min: 1000, max: 10000, step: 500 },
  quality: { min: 0.3, max: 1.0, step: 0.1 },
  resolutionDivisor: { min: 1, max: 8, step: 1 },
} as const;

/**
 * Validate and normalize AR crash isolation flags.
 * Missing or invalid values fall back to defaults.
 */
export function validateArCrashIsolationOptions(
  options: Partial<ArCrashIsolationOptions>
): ArCrashIsolationOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.arCrashIsolation;
  return {
    enableDomOverlay:
      typeof options.enableDomOverlay === 'boolean'
        ? options.enableDomOverlay
        : defaults.enableDomOverlay,
    enableCameraAccess:
      typeof options.enableCameraAccess === 'boolean'
        ? options.enableCameraAccess
        : defaults.enableCameraAccess,
    enableDepthSensingFeature:
      typeof options.enableDepthSensingFeature === 'boolean'
        ? options.enableDepthSensingFeature
        : defaults.enableDepthSensingFeature,
    enableCss3dRenderer:
      typeof options.enableCss3dRenderer === 'boolean'
        ? options.enableCss3dRenderer
        : defaults.enableCss3dRenderer,
    enableCameraTextureAcquisition:
      typeof options.enableCameraTextureAcquisition === 'boolean'
        ? options.enableCameraTextureAcquisition
        : defaults.enableCameraTextureAcquisition,
    applyChromiumProjectionLayerWorkaround:
      typeof options.applyChromiumProjectionLayerWorkaround === 'boolean'
        ? options.applyChromiumProjectionLayerWorkaround
        : defaults.applyChromiumProjectionLayerWorkaround,
  };
}

// --- Validation ---

/**
 * Clamp a value to the specified constraints.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate and normalize depth options.
 * Invalid values are clamped to valid ranges.
 */
export function validateDepthOptions(
  options: Partial<DepthCaptureOptions>
): DepthCaptureOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.depth;
  return {
    enabled:
      typeof options.enabled === 'boolean' ? options.enabled : defaults.enabled,
    intervalMs: clamp(
      typeof options.intervalMs === 'number'
        ? options.intervalMs
        : defaults.intervalMs,
      DEPTH_CONSTRAINTS.intervalMs.min,
      DEPTH_CONSTRAINTS.intervalMs.max
    ),
    gridSize: clamp(
      typeof options.gridSize === 'number'
        ? options.gridSize
        : defaults.gridSize,
      DEPTH_CONSTRAINTS.gridSize.min,
      DEPTH_CONSTRAINTS.gridSize.max
    ),
  };
}

/**
 * Validate and normalize image options.
 * Invalid values are clamped to valid ranges.
 */
export function validateImageOptions(
  options: Partial<ImageCaptureOptions>
): ImageCaptureOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.images;
  return {
    enabled:
      typeof options.enabled === 'boolean' ? options.enabled : defaults.enabled,
    intervalMs: clamp(
      typeof options.intervalMs === 'number'
        ? options.intervalMs
        : defaults.intervalMs,
      IMAGE_CONSTRAINTS.intervalMs.min,
      IMAGE_CONSTRAINTS.intervalMs.max
    ),
    quality: clamp(
      typeof options.quality === 'number' ? options.quality : defaults.quality,
      IMAGE_CONSTRAINTS.quality.min,
      IMAGE_CONSTRAINTS.quality.max
    ),
    resolutionDivisor: clamp(
      typeof options.resolutionDivisor === 'number'
        ? options.resolutionDivisor
        : defaults.resolutionDivisor,
      IMAGE_CONSTRAINTS.resolutionDivisor.min,
      IMAGE_CONSTRAINTS.resolutionDivisor.max
    ),
  };
}

/**
 * Validate and normalize a full RecordingOptions object.
 * Merges with defaults and clamps invalid values.
 */
export function validateRecordingOptions(
  options: RecordingOptionsInput
): RecordingOptions {
  return {
    depth: validateDepthOptions(options.depth ?? {}),
    images: validateImageOptions(options.images ?? {}),
    arCrashIsolation: validateArCrashIsolationOptions(
      options.arCrashIsolation ?? {}
    ),
  };
}

// --- Persistence ---

/**
 * Load recording options from localStorage.
 * Returns defaults if no saved options exist or parsing fails.
 * Validates and merges with defaults to handle schema evolution.
 * @param storageKey - Optional custom localStorage key (defaults to STORAGE_KEY).
 */
export function loadRecordingOptions(
  storageKey: string = STORAGE_KEY
): RecordingOptions {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as RecordingOptionsInput;
      log.debug('Loaded options from storage:', parsed);
      return validateRecordingOptions(parsed);
    }
  } catch (err) {
    log.warn('Failed to load recording options:', err);
  }
  log.debug('Using default recording options');
  return cloneRecordingOptions(DEFAULT_RECORDING_OPTIONS);
}

/**
 * Save recording options to localStorage.
 * Options are validated before saving.
 * @param storageKey - Optional custom localStorage key (defaults to STORAGE_KEY).
 */
export function saveRecordingOptions(
  options: RecordingOptions,
  storageKey: string = STORAGE_KEY
): void {
  try {
    const validated = validateRecordingOptions(options);
    localStorage.setItem(storageKey, JSON.stringify(validated));
    log.debug('Saved recording options:', validated);
  } catch (err) {
    log.warn('Failed to save recording options:', err);
  }
}

/**
 * Reset recording options to defaults.
 * Clears localStorage and returns default options.
 * @param storageKey - Optional custom localStorage key (defaults to STORAGE_KEY).
 */
export function resetRecordingOptions(
  storageKey: string = STORAGE_KEY
): RecordingOptions {
  try {
    localStorage.removeItem(storageKey);
    log.debug('Reset recording options to defaults');
  } catch (err) {
    log.warn('Failed to clear recording options from storage:', err);
  }
  return cloneRecordingOptions(DEFAULT_RECORDING_OPTIONS);
}

/**
 * Create a deep copy of recording options.
 * Useful for creating mutable copies of the frozen defaults.
 */
export function cloneRecordingOptions(
  options: RecordingOptions
): RecordingOptions {
  return {
    depth: { ...options.depth },
    images: { ...options.images },
    arCrashIsolation: { ...options.arCrashIsolation },
  };
}
