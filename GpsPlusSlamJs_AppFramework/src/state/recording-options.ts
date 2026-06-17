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
  occupancy?: Partial<OccupancyOptions>;
  visualization?: Partial<VisualizationOptions>;
  qr?: Partial<QrCaptureOptions>;
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
   * affected window (148.0.7778.12 up to 149.0.7821).
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
  /**
   * Grid size (N×N points per sample). Default: 16 — dense enough to
   * populate the AR-space occupancy grid (2026-06-11 port plan §1).
   */
  gridSize: number;
  /**
   * Whether to enrich each depth point with the camera color at its view
   * coordinates (RGB voxel coloring, occupancy-grid port plan Iter 8).
   * Costs one small GPU blit+readback per sample (~1 Hz); when off, the
   * occupancy cubes keep the height-based coloring. Default: true.
   */
  rgb: boolean;
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
 * Configuration for the derived AR-space occupancy grid (the voxelization of
 * the depth samples, port plan 2026-06-11). These settings do NOT change what
 * is recorded — they govern the grid derived from the recorded depth points,
 * so they also apply when replaying an existing recording, letting the same
 * session be re-quantized at a different resolution.
 */
export interface OccupancyOptions {
  /**
   * Voxel edge length in metres. Drives the occupancy-grid quantization, the
   * debug cubes, and the COLMAP `points3D` density. Default 0.15 (15 cm, Unity
   * parity). Smaller = finer detail but cell count scales as 1/cellSize³, so the
   * range is deliberately clamped (see `OCCUPANCY_CONSTRAINTS`). Read once when
   * the grid is constructed (Enter-AR / replay load), so a change takes effect
   * on the next session rather than mid-session.
   */
  cellSizeM: number;
}

/**
 * Visibility toggles for the live AR debug overlays (Finding B / DB-2 of
 * 2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md).
 *
 * These gate **only what is drawn live during recording** — they never change
 * what is captured (frame blobs, depth samples, occupancy data, GPS events all
 * continue regardless) and they never affect replay (where reviewing the
 * captured overlays is the whole point). Read once at Enter-AR: toggling
 * mid-session applies on the next Enter-AR, not retroactively.
 *
 * All four default ON, so adding this group is purely additive — every overlay
 * still renders until the operator opts out.
 */
export interface VisualizationOptions {
  /** Live frame-tile planes (`FrameTileVisualizer`). Default: true */
  frameTiles: boolean;
  /** Voxel depth cubes (`OccupancyCubesVisualizer`). Default: true */
  occupancyCubes: boolean;
  /** Raw/fused/snapshot GPS+VIO alignment spheres (`GpsEventVisualizer`). Default: true */
  gpsAlignmentMarkers: boolean;
  /** N/E/S/W compass orientation cubes (`createGpsCompassCubes`). Default: true */
  compassCubes: boolean;
}

/**
 * Configuration for live QR detection + RAW recording (decision §0 of the
 * recorder live-QR follow-up,
 * `2026-06-17-followup-recorder-live-qr-next-steps.md`).
 *
 * OPT-IN (`enabled` defaults to `false`): turning it on adds per-frame RGBA
 * capture + a `BarcodeDetector` decode to the session, so it is operator-gated
 * exactly like the heavy `depth`/`images` streams — an existing recording pays
 * nothing. When on, the producer dispatches one RAW `qrDetected/recordQrDetection`
 * action per accepted decode (size + pose are DERIVED on read, never recorded).
 */
export interface QrCaptureOptions {
  /** Whether live QR detection + recording runs. Default: false (opt-in). */
  enabled: boolean;
  /**
   * Capture / detection cadence in ms — the SINGLE cadence owner (the producer
   * runs `minIntervalMs: 0`; this throttles the camera-frame source). Default
   * 125 (~8 Hz), matching the QR demo's `DETECT_INTERVAL_MS`.
   */
  intervalMs: number;
  /**
   * RGBA capture long-edge in px. Larger = more decode range on a small/distant
   * QR but a costlier blit + detect. Default 1024 (the on-device sweep settled
   * here; 512 only decoded small QRs at very close range).
   */
  captureSize: number;
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
  /** Derived occupancy-grid configuration (voxel size) */
  occupancy: OccupancyOptions;
  /** Live AR debug-overlay visibility toggles (live-only; replay unaffected) */
  visualization: VisualizationOptions;
  /** Live QR detection + RAW recording configuration (opt-in) */
  qr: QrCaptureOptions;
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
    gridSize: 16, // 16×16 = 256 points per sample (occupancy-grid density)
    rgb: true, // RGB voxel coloring (Iter 8)
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
  occupancy: {
    cellSizeM: 0.15, // 15 cm voxels — matches OccupancyGrid's own default (Unity parity)
  },
  visualization: {
    // All overlays ON so the group is purely additive (DB-1b) — no behaviour
    // change until the operator opts out.
    frameTiles: true,
    occupancyCubes: true,
    gpsAlignmentMarkers: true,
    compassCubes: true,
  },
  qr: {
    // OFF by default (§0): QR capture/detection is opt-in so existing
    // recordings pay nothing (performance must not regress).
    enabled: false,
    intervalMs: 125, // ~8 Hz — the QR demo's DETECT_INTERVAL_MS
    captureSize: 1024, // long-edge px — the on-device-verified default
  },
};

/** Validation constraints for depth options */
export const DEPTH_CONSTRAINTS = {
  intervalMs: { min: 500, max: 5000, step: 100 },
  // Max raised 10 → 32 with the occupancy-grid work: 32×32 = 1024
  // getDepthInMeters reads per sample is the ceiling until the per-frame
  // cost is measured on-device (port plan Iter 6 field verification).
  gridSize: { min: 2, max: 32, step: 1 },
} as const;

/** Validation constraints for image options */
export const IMAGE_CONSTRAINTS = {
  intervalMs: { min: 1000, max: 10000, step: 500 },
  quality: { min: 0.3, max: 1.0, step: 0.1 },
  resolutionDivisor: { min: 1, max: 8, step: 1 },
} as const;

/**
 * Validation constraints for occupancy options.
 *
 * `cellSizeM` is clamped to 1–20 cm. The floor exists because cell count (and
 * therefore the cube `InstancedMesh`, the grid `Map`, and the COLMAP
 * `points3D` row count) scales as 1/cellSize³ — sub-centimetre voxels are both
 * a memory/perf cliff on a phone and below the depth sensor's noise floor.
 * Step is 1 cm (the settings slider operates in cm).
 */
export const OCCUPANCY_CONSTRAINTS = {
  cellSizeM: { min: 0.01, max: 0.2, step: 0.01 },
} as const;

/**
 * Validation constraints for QR-capture options.
 *
 * `intervalMs` is clamped to 50–1000 ms (20 Hz down to 1 Hz): below ~50 ms the
 * detector cannot keep up and frames just queue; above 1 s tracking feels dead.
 * `captureSize` is clamped to 256–2048 px: under 256 even a near QR loses its
 * modules; over 2048 the blit + decode cost is not worth it on a phone. Both
 * back a settings slider so a corrupt stored value can never break capture.
 */
export const QR_CONSTRAINTS = {
  intervalMs: { min: 50, max: 1000, step: 25 },
  captureSize: { min: 256, max: 2048, step: 128 },
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

/**
 * Validate and normalize the live debug-overlay visibility toggles.
 * Each field is boolean-or-default (same policy as the AR-crash-isolation
 * flags): a missing, corrupted, or pre-feature persisted value falls back to
 * the ON default so an overlay is never silently disabled by bad input.
 */
export function validateVisualizationOptions(
  options: Partial<VisualizationOptions>
): VisualizationOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.visualization;
  return {
    frameTiles:
      typeof options.frameTiles === 'boolean'
        ? options.frameTiles
        : defaults.frameTiles,
    occupancyCubes:
      typeof options.occupancyCubes === 'boolean'
        ? options.occupancyCubes
        : defaults.occupancyCubes,
    gpsAlignmentMarkers:
      typeof options.gpsAlignmentMarkers === 'boolean'
        ? options.gpsAlignmentMarkers
        : defaults.gpsAlignmentMarkers,
    compassCubes:
      typeof options.compassCubes === 'boolean'
        ? options.compassCubes
        : defaults.compassCubes,
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
 * Validate and normalize QR-capture options. `enabled` is boolean-or-default
 * (a corrupt/pre-feature value falls back to the OFF default so QR never
 * silently turns ON); `intervalMs`/`captureSize` are clamped to
 * {@link QR_CONSTRAINTS}, with a `Number.isFinite` guard so a stored `NaN`
 * (which is `typeof 'number'` and survives `clamp`) falls back to the default
 * rather than breaking the camera-frame source.
 */
export function validateQrOptions(
  options: Partial<QrCaptureOptions>
): QrCaptureOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.qr;
  return {
    enabled:
      typeof options.enabled === 'boolean' ? options.enabled : defaults.enabled,
    intervalMs: clamp(
      typeof options.intervalMs === 'number' &&
        Number.isFinite(options.intervalMs)
        ? options.intervalMs
        : defaults.intervalMs,
      QR_CONSTRAINTS.intervalMs.min,
      QR_CONSTRAINTS.intervalMs.max
    ),
    captureSize: clamp(
      typeof options.captureSize === 'number' &&
        Number.isFinite(options.captureSize)
        ? options.captureSize
        : defaults.captureSize,
      QR_CONSTRAINTS.captureSize.min,
      QR_CONSTRAINTS.captureSize.max
    ),
  };
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
    rgb: typeof options.rgb === 'boolean' ? options.rgb : defaults.rgb,
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
 * Validate and normalize occupancy options.
 * Invalid values are clamped to valid ranges.
 *
 * Note the explicit `Number.isFinite` guard: `OccupancyGrid` throws a
 * `RangeError` on a non-finite cell size, and `clamp(NaN, …)` would otherwise
 * pass `NaN` straight through (it is `typeof 'number'`). Falling back to the
 * default keeps a corrupted stored value from crashing grid construction.
 */
export function validateOccupancyOptions(
  options: Partial<OccupancyOptions>
): OccupancyOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.occupancy;
  return {
    cellSizeM: clamp(
      typeof options.cellSizeM === 'number' &&
        Number.isFinite(options.cellSizeM)
        ? options.cellSizeM
        : defaults.cellSizeM,
      OCCUPANCY_CONSTRAINTS.cellSizeM.min,
      OCCUPANCY_CONSTRAINTS.cellSizeM.max
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
    occupancy: validateOccupancyOptions(options.occupancy ?? {}),
    visualization: validateVisualizationOptions(options.visualization ?? {}),
    qr: validateQrOptions(options.qr ?? {}),
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
    occupancy: { ...options.occupancy },
    visualization: { ...options.visualization },
    qr: { ...options.qr },
  };
}
