/**
 * Recording Options - User-configurable settings for data capture.
 *
 * Allows users to disable/configure high-frequency data streams
 * (depth sampling, image capture) to improve performance on lower-end devices.
 *
 * Options persist in localStorage across sessions.
 */

import { createLogger } from '../utils/logger';
import {
  DEFAULT_MOTION_FILTER,
  type MotionFilterConfig,
} from '../ar/capture-motion-gate';
import {
  DEFAULT_QUALITY_FILTER,
  type QualityFilterConfig,
} from '../ar/image-quality';

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
  frameTileDisplay?: Partial<FrameTileDisplayOptions>;
  visualization?: Partial<VisualizationOptions>;
  qr?: Partial<QrCaptureOptions>;
  compassDebug?: Partial<CompassDebugOptions>;
}

/**
 * Toggles for the library's Phase-4 compass alignment features (closed/internal
 * `AlignmentConfig` flags exposed via narrow boolean actions). They change how
 * the LIVE alignment is computed, so they sit with the other capture groups.
 * **Stage 0 (`coldStartOverride`) defaults ON** (a field-validated production
 * feature); Stage C + the WebXR-consistency gate stay experimental (default
 * OFF) until the §6a field-data matrix is in.
 *
 * On-device caveat: the resulting `gpsData` opt-in actions persist into the
 * recording, so the DEFAULT `replayAll` re-enables them. This does NOT modify the
 * raw recorded stream (`rawAbsoluteOrientation`, GPS, odometry) — only the
 * *derived* alignment — so an investigation that re-solves from the raw
 * observations under a chosen `AlignmentConfig` (`recomputeAlignment`) is
 * unaffected by the capture-time flag state. Turning the flags off during capture
 * only matters if you want the LIVE app to behave as the GPS-only baseline; it is
 * not required for clean §6a analysis data. See
 * `GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md`
 * (2026-07-01 update).
 */
export interface CompassDebugOptions {
  /** Stage 0 — cold-start compass yaw override (`setColdStartOverrideEnabled`). Default ON. */
  coldStartOverride: boolean;
  /** Stage C — trust-gated compass rotation prior (`setCompassRotationPriorEnabled`). */
  rotationPrior: boolean;
  /** GPS-free compass↔WebXR consistency gate (`setCompassWebXRConsistencyEnabled`). */
  webXRConsistency: boolean;
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
  /** Interval between samples in milliseconds. Default: 500 (FAST-reconstruction tuning, 2026-07-01). */
  intervalMs: number;
  /**
   * Grid size (N×N points per sample). Default: 32 (FAST-reconstruction
   * tuning, 2026-07-01) — dense enough to populate the AR-space occupancy
   * grid (2026-06-11 port plan §1).
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
  /**
   * Motion gate — skip motion-blurred frames by deferring a due capture until
   * device motion settles. Mirrors `ImageCaptureConfig.motionFilter` (the type
   * the capture manager consumes); the recorder destructures `images` and flows
   * the rest, including this group, through the capture seam. Default: enabled.
   * See `ar/capture-motion-gate.ts` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-23-blurry-frame-motion-gating-plan.md`.
   */
  motionFilter: MotionFilterConfig;
  /**
   * Image-quality gate — drop a blurry/black frame (judged off-thread) and retry
   * the next acceptable frame. Mirrors `ImageCaptureConfig.qualityFilter`; flows
   * through the same capture seam as `motionFilter`. **Default: disabled**
   * pending field tuning of the relative blur threshold (a mis-tuned gate
   * silently dropping good frames is worse than the motion gate's default-on).
   * See `ar/image-quality.ts` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md`.
   */
  qualityFilter: QualityFilterConfig;
}

/**
 * Configuration for the derived AR-space occupancy grid (the voxelization of
 * the depth samples, port plan 2026-06-11). These settings do NOT change what
 * is recorded — they govern the grid derived from the recorded depth points,
 * so they also apply when replaying an existing recording, letting the same
 * session be re-quantized at a different resolution.
 */
/**
 * Mesher strategy for the **persistent occluder** mesh, exposed as a recorder
 * setting (2026-06-30 occluder-tuning, F2/F2b) so the two surface-hugging
 * approaches can be A/B-tested on-device against the blocky baseline:
 * - `'greedy'` — blocky greedy cubes (the existing default; fewest triangles).
 * - `'corner-fit'` — cubes with corners pulled to the measured centroids
 *   (surface-hugging **and** watertight).
 * - `'smooth'` — surface nets: smoothest, hugs the measured surface, but an open
 *   sheet over thin features.
 *
 * Maps directly onto `meshOccupiedCells` / `OcclusionMesh` `MeshMode` (a subset).
 * `'per-face'` is intentionally not offered (same shape as `'greedy'`, more
 * triangles — no on-device value).
 */
const OCCLUDER_MESH_MODES = ['greedy', 'corner-fit', 'smooth'] as const;
export type OccluderMeshMode = (typeof OCCLUDER_MESH_MODES)[number];

/**
 * Debug-visualization style for the **persistent occluder** mesh (2026-07-02
 * debug-viz-styles plan) — which visible debug skin(s) `OcclusionMesh` renders
 * on top of the invisible depth-only occluder:
 * - `'off'` — no debug rendering (the shipped default; occlusion is invisible).
 * - `'matcap'` — the original shiny semi-transparent cyan skin.
 * - `'depth-shaded'` — matcap + camera-distance fade + white fresnel rim, so
 *   overlapping near/far surfaces read as separate shells.
 * - `'wireframe'` — the raw triangulation as GL lines (mesh-structure
 *   inspection: triangle density, mesher seams, degenerate spots).
 * - `'depth-shaded-wireframe'` — both of the above composed.
 *
 * Values array module-private (validation only; the settings `<select>`
 * options are hardcoded in the recorder's `index.html`), type exported —
 * mirroring `OCCLUDER_MESH_MODES` / {@link OccluderMeshMode}.
 */
const OCCLUDER_DEBUG_STYLES = [
  'off',
  'matcap',
  'depth-shaded',
  'wireframe',
  'depth-shaded-wireframe',
] as const;
export type OccluderDebugStyle = (typeof OCCLUDER_DEBUG_STYLES)[number];

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
  /**
   * Minimum observation count for a voxel to be trusted as occupied (the
   * grid's `getOccupiedCells(minObservations)` floor, promoted to a user
   * setting). A cell is marked occupied the instant one noisy depth point
   * lands in it; raising this filters single-frame depth noise — in
   * particular the **behind-surface** phantoms (e.g. below the floor) that
   * free-space carving can never clear because no ray passes through occluded
   * space. Default 3 (1 = unfiltered/legacy). Higher = less noise but
   * briefly-glimpsed real surfaces may be dropped, so it is exposed for
   * on-device tuning. Read once when the visualizer is constructed (Enter-AR
   * / replay load). See
   * `GpsPlusSlamJs_Docs/docs/2026-06-22-occupancy-grid-behind-surface-noise-plan.md`.
   */
  minConfidence: number;
  /**
   * Render a **persistent depth-only occlusion mesh** of the occupancy grid:
   * the grid's occupied cells are meshed (`meshOccupiedCells`) and drawn
   * invisible-but-depth-writing under `arWorldGroup`, so real geometry the
   * camera saw earlier hides virtual objects placed behind it — including
   * out-of-view surfaces a live depth occluder cannot remember. Default
   * **true** (since 2026-07-01): the Web-Worker mesh offload removed the
   * per-refresh render stall that was the reason to keep it opt-in, so the
   * remembered occluder ships on by the default `'smooth'` mesher. Read once when
   * the mesh is wired (Enter-AR / replay load), like the other occupancy knobs.
   * See `GpsPlusSlamJs_Docs/docs/2026-06-13-occupancy-mesh-options-plan.md` and
   * `GpsPlusSlamJs_Docs/docs/2026-07-01-occluder-worker-and-chunked-remesh-plan.md`.
   *
   * **Migration:** this field replaces the former `occlusionMeshEnabled`
   * boolean — `validateOccupancyOptions` maps a persisted
   * `occlusionMeshEnabled === true` onto `persistentOcclusion` (see that
   * function and `2026-06-29-occupancy-mesh-followups.md`).
   */
  persistentOcclusion: boolean;
  /**
   * Enable the **live CPU-depth occluder** — a per-frame depth occluder that
   * hides virtual content behind the real surface the camera sees *right now*,
   * sharp and registration-free (no out-of-view memory). It composes with
   * {@link persistentOcclusion}: both can be on (the live occluder wins where
   * this frame has depth, the persistent mesh fills out-of-view / depth holes —
   * `2026-06-14-webxr-depth-occlusion-plan.md` §5). Requires the
   * `requestDepthOcclusion` session feature so `cpu-optimized` depth is
   * negotiated even without depth recording. **Live-AR only** — replay has no
   * live depth stream, so this flag is a no-op there (persistent still applies).
   * Default **false**: the live occluder's on-device occlusion quality is still
   * device-gated/unverified. Read once when the AR session is wired (Enter-AR).
   */
  liveOcclusion: boolean;
  /**
   * Which **visible debug skin(s)** render the persistent occluder mesh (see
   * {@link OccluderDebugStyle}) so its shape/structure can be judged on-device.
   * All styles are additive overlays — the invisible depth-only mesh keeps
   * writing depth unchanged, so occlusion is identical in every style. Only has
   * a visible effect when {@link persistentOcclusion} is on (it is that
   * occluder's mesh); any other value is a harmless no-op. Default **`'off'`**.
   * Read once when the mesh is wired (Enter-AR / replay load), like the other
   * occupancy knobs. See
   * `GpsPlusSlamJs_Docs/docs/2026-07-02-occluder-debug-viz-styles-plan.md` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-29-occlusion-debug-viz-and-live-occluder-user-feedback.md`.
   *
   * **Migration:** this field replaces the former `occluderDebugViz` boolean —
   * `validateOccupancyOptions` maps a persisted `occluderDebugViz: true` onto
   * `'matcap'` (the skin the boolean used to enable) when this field is absent,
   * mirroring the `occlusionMeshEnabled` → {@link persistentOcclusion}
   * migration.
   */
  occluderDebugStyle: OccluderDebugStyle;
  /**
   * Which mesher builds the **persistent occluder** mesh (see
   * {@link OccluderMeshMode}). Default `'smooth'` (since 2026-07-01) — Naive
   * Surface Nets, the smoothest and lightest mesh. Switch to `'greedy'` (blocky
   * cubes, watertight) or `'corner-fit'` (surface-hugging + watertight) if the
   * smooth mesh's open concave seams leak occlusion in practice (combine with
   * {@link occluderDebugStyle} to actually *see* the mesh shape). Only has an
   * effect when {@link persistentOcclusion} is on. Read once when the mesh is
   * wired (Enter-AR / replay load), like the other occupancy knobs. See
   * `GpsPlusSlamJs_Docs/docs/2026-06-30-occluder-tuning-followups.md`.
   */
  occluderMeshMode: OccluderMeshMode;
  /**
   * Camera-local window for the **persistent occluder** snapshot (Step 2 of
   * the 2026-07-03 long-session fps plan): each re-mesh reads only the
   * occupied cells within this many meters of the camera
   * (`OccupancyGrid.getOccupiedCellsWithinFlat`), so snapshot/pack/mesh cost
   * is bounded by the neighbourhood instead of the whole session. Default
   * **25 m** — a 15 cm voxel at 25 m subtends ~0.3°, so occlusion errors
   * beyond that are imperceptible. `0` = unbounded (the pre-Step-2
   * behaviour, the safe fallback). The grid forgets nothing: walking back
   * re-meshes far geometry from memory — exactly the persistent-grid intent.
   * Only has an effect when {@link persistentOcclusion} is on. Read once at
   * Enter-AR / replay load like the other occupancy knobs.
   */
  occluderRadiusM: number;
}

/**
 * Configuration for how captured frame tiles are DISPLAYED in AR (D7-resolution,
 * 2026-06-16 RecorderApp user feedback / Q3). This is **distinct from** the
 * capture setting `images.resolutionDivisor`: capture quality (the JPEG written
 * to the recording) is unchanged — this only downscales the in-AR/replay display
 * texture built from each captured frame, cutting per-tile GPU texture memory.
 *
 * Like {@link OccupancyOptions} it does NOT change what is recorded, so it
 * applies to **both live and replay** (the tile texture is decoded in both). A
 * partial memory mitigation for the OOM/crash track (the tile *count* still
 * grows unbounded — capping/recycling is the separate Track-S fix).
 */
export interface FrameTileDisplayOptions {
  /**
   * Display-texture resolution divisor: 1 = full captured resolution, 2 = half
   * (each dimension), 4 = quarter, 8 = eighth. Default 2 (half). Higher = less
   * GPU memory per tile but a blurrier in-AR preview. Independent of the capture
   * `images.resolutionDivisor`.
   */
  divisor: number;
  /**
   * FIFO cap on the **live** frame-tile planes (Step 4 of the 2026-07-03
   * long-session fps plan): adding a tile over the cap removes + disposes the
   * oldest, bounding draw calls / GPU texture memory / scene-graph size for
   * arbitrarily long sessions while keeping the recent-path breadcrumb.
   * `0` = unlimited. Default 100 (a ~5-min walk captures 112–145 frames, so
   * the cap binds on real walks). **Live only** (2026-07-03 interview): in
   * replay the tiles audit coverage of the full recorded path, so the replay
   * wiring stays uncapped regardless of this value.
   */
  maxTiles: number;
}

/**
 * Visibility toggles for the live AR debug overlays (Finding B / DB-2 of
 * 2026-06-14-followup-frame-tile-legacy-aspect-and-live-toggle.md).
 *
 * These gate **only what is drawn live during recording** — they never change
 * what is captured (frame blobs, depth samples, occupancy data, GPS events all
 * continue regardless) and, with one exception, they never affect replay
 * (where reviewing the captured overlays is the whole point). Read once at
 * Enter-AR: toggling mid-session applies on the next Enter-AR, not
 * retroactively.
 *
 * The debug overlays default ON, so the group is purely additive — every
 * overlay still renders until the operator opts out. The exception on both
 * counts is {@link VisualizationOptions.statsOverlay}: a perf-measurement tool
 * that defaults OFF and, when on, also runs in replay (see its docs).
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
  /**
   * Rotate the live in-AR minimap so the user's view direction always points
   * up/forward (heading-up) instead of fixed north-up. Unlike the other flags
   * in this group this is a map-orientation preference, not a show/hide — but it
   * shares their live-only semantics (read at Enter-AR, never affects replay).
   * Default: true. See the 2026-06-29 heading-up plan.
   */
  headingUpMap: boolean;
  /**
   * Performance stats overlay (Stats.js: FPS / frame ms / MB panels) for
   * long-session fps attribution (2026-07-03 long-session fps plan §0).
   * Two exceptions to this group's rules: it is a debug tool, so it defaults
   * **OFF** (must not cost the default path), and unlike the live-only
   * overlays it also runs in **replay** (frame time matters there too).
   * In immersive AR it composites via the dom-overlay feature, so it is
   * invisible when `arCrashIsolation.enableDomOverlay` is off.
   */
  statsOverlay: boolean;
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
  /** Frame-tile display-texture resolution (live + replay; capture unchanged) */
  frameTileDisplay: FrameTileDisplayOptions;
  /** Live AR debug-overlay visibility toggles (live-only; replay unaffected) */
  visualization: VisualizationOptions;
  /** Live QR detection + RAW recording configuration (opt-in) */
  qr: QrCaptureOptions;
  /** Compass alignment debug toggles (Stage 0 / Stage C / consistency gate) */
  compassDebug: CompassDebugOptions;
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
    // Tuned for FAST mesh reconstruction (2026-07-01 param-sweep on a real
    // recording; see recording-options.ts.md):
    intervalMs: 500, // 2 samples per second — denser temporal sampling
    gridSize: 32, // 32×32 = 1024 points per sample — confirms cells fastest (was 24; slider max raised to 64 for on-device experimentation)
    rgb: true, // RGB voxel coloring (Iter 8)
  },
  images: {
    enabled: true,
    intervalMs: 2000, // 1 image every 2 seconds
    quality: 0.7, // 70% JPEG quality
    resolutionDivisor: 1, // Full native camera resolution
    // Spread so this default object does not ALIAS DEFAULT_MOTION_FILTER /
    // DEFAULT_CAPTURE_CONFIG.motionFilter — each default group must be its own
    // object so an accidental in-place mutation cannot leak across them.
    motionFilter: { ...DEFAULT_MOTION_FILTER }, // blurry-frame motion gate (on)
    // Same spread/alias rationale — blur/blackness image gate (off by default).
    qualityFilter: { ...DEFAULT_QUALITY_FILTER },
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
    cellSizeM: 0.15, // 15 cm voxels — matches OccupancyGrid's own default (Unity parity); balances detail vs speed
    minConfidence: 3, // ≥3 observations to render a voxel — the FAST-reconstruction noise floor (2026-07-01; ~1.5s dwell before a surface meshes vs 2.5s at 5, +25% early coverage; 1 = legacy/unfiltered)
    persistentOcclusion: true, // persistent depth-only mesh occluder ON by default (2026-07-01: Web-Worker offload removed the render stall — see 2026-07-01-occluder-worker-and-chunked-remesh-plan.md)
    liveOcclusion: false, // live CPU-depth occluder OFF by default (device-gated quality; replay no-op)
    occluderDebugStyle: 'off', // debug visualization of the persistent occluder mesh OFF by default (occlusion is invisible in normal use)
    occluderMeshMode: 'smooth', // persistent-occluder mesher: Naive Surface Nets by default (smoothest/lightest); 'greedy' = blocky cubes (watertight), 'corner-fit' = surface-hugging + watertight
    occluderRadiusM: 25, // camera-local occluder window (2026-07-03 fps plan Step 2); 0 = unbounded
  },
  frameTileDisplay: {
    // Half-resolution display texture by default (D7): a noticeable per-tile
    // memory saving with little perceptual cost on the small floating tiles.
    divisor: 2,
    // Live FIFO tile cap (2026-07-03 fps plan Step 4); 0 = unlimited.
    maxTiles: 100,
  },
  visualization: {
    // All overlays ON so the group is purely additive (DB-1b) — no behaviour
    // change until the operator opts out.
    frameTiles: true,
    occupancyCubes: true,
    gpsAlignmentMarkers: true,
    compassCubes: true,
    // Heading-up minimap ON by default in live (2026-06-29 user decision).
    headingUpMap: true,
    // Perf stats overlay OFF by default — a debug tool must not cost the
    // default path (2026-07-03 long-session fps plan §0).
    statsOverlay: false,
  },
  qr: {
    // OFF by default (§0): QR capture/detection is opt-in so existing
    // recordings pay nothing (performance must not regress).
    enabled: false,
    intervalMs: 125, // ~8 Hz — the QR demo's DETECT_INTERVAL_MS
    captureSize: 1024, // long-edge px — the on-device-verified default
  },
  compassDebug: {
    // Stage 0 (cold-start compass yaw override) ships ON by default — it is a
    // field-validated, observability-gated handover that orients the world
    // immediately at cold start and hands back to GPS once the yaw is
    // observable. Operator can turn it OFF (e.g. for §6a field-calibration
    // recordings). Stage C + the WebXR-consistency gate stay experimental (OFF).
    coldStartOverride: true,
    rotationPrior: false,
    webXRConsistency: false,
  },
};

/** Validation constraints for depth options */
export const DEPTH_CONSTRAINTS = {
  intervalMs: { min: 500, max: 5000, step: 100 },
  // Max raised 32 → 64 (2026-07-01) for on-device experimentation with faster
  // mesh reconstruction: 64×64 = 4096 getDepthInMeters reads per sample (4× the
  // 32² default). High values trade per-sample depth-readback cost + grid growth
  // for faster cell confirmation — measure the per-frame cost on-device before
  // adopting a value above the 32 default.
  gridSize: { min: 2, max: 64, step: 1 },
} as const;

/** Validation constraints for image options */
export const IMAGE_CONSTRAINTS = {
  intervalMs: { min: 1000, max: 10000, step: 500 },
  quality: { min: 0.3, max: 1.0, step: 0.1 },
  resolutionDivisor: { min: 1, max: 8, step: 1 },
} as const;

/**
 * Validation constraints for the motion-filter (blurry-frame gate) thresholds.
 *
 * The velocity ranges (0.05–5) bracket the plausible scanning regime: below
 * ~0.05 the gate would reject almost everything; above ~5 rad/s ≈ 286°/s (or
 * 5 m/s) it would never reject, so the gate would be inert. `maxWaitMs` is
 * clamped to 0.5–20 s — the never-calm fallback must always be able to fire.
 * All three back a (currently advanced/hidden) settings slider, so a corrupt
 * stored value can never disable capture. The default thresholds themselves are
 * placeholders pending on-device field tuning (plan §7).
 */
export const MOTION_FILTER_CONSTRAINTS = {
  maxAngularVelocity: { min: 0.05, max: 5, step: 0.05 },
  maxLinearVelocity: { min: 0.05, max: 5, step: 0.05 },
  maxWaitMs: { min: 500, max: 20000, step: 500 },
} as const;

/**
 * Validation constraints for the image-quality (blur/blackness) gate thresholds.
 *
 * `blurRelativeThreshold` (`k` in `sharpness < k·median`) is clamped to
 * 0.05–0.95: it is a fraction of the recent sharpness median, so values must sit
 * strictly inside (0, 1) — at ~0 the blur check never rejects, near 1 it rejects
 * almost everything. `minMeanLuminance` (the absolute black cutoff on a 0–255
 * luma scale) is clamped to 0–128: 0 disables the black check, and a cutoff
 * above mid-grey would reject normally-lit frames. `maxWaitMs` mirrors the motion
 * gate's range (0.5–20 s) so the never-good fallback can always fire. All back a
 * (currently advanced/hidden) settings slider, so a corrupt stored value can
 * never disable capture. The default thresholds are placeholders pending
 * on-device field tuning (plan §5, §10).
 */
export const QUALITY_FILTER_CONSTRAINTS = {
  blurRelativeThreshold: { min: 0.05, max: 0.95, step: 0.05 },
  minMeanLuminance: { min: 0, max: 128, step: 1 },
  maxWaitMs: { min: 500, max: 20000, step: 500 },
} as const;

/**
 * Validation constraints for occupancy options.
 *
 * `cellSizeM` is clamped to 1–20 cm. The floor exists because cell count (and
 * therefore the cube `InstancedMesh`, the grid `Map`, and the COLMAP
 * `points3D` row count) scales as 1/cellSize³ — sub-centimetre voxels are both
 * a memory/perf cliff on a phone and below the depth sensor's noise floor.
 * Step is 1 cm (the settings slider operates in cm).
 *
 * `minConfidence` is clamped to 1–10 (integer). 1 disables the filter (legacy
 * behaviour: a single observation counts as occupied); the ceiling exists
 * because real surfaces accumulate only a handful of observations per second
 * of dwell, so a floor above ~10 would start hiding genuine geometry.
 */
export const OCCUPANCY_CONSTRAINTS = {
  cellSizeM: { min: 0.01, max: 0.2, step: 0.01 },
  minConfidence: { min: 1, max: 10, step: 1 },
  // Camera-local occluder window: 0 = unbounded; 200 m is far past any
  // useful mobile-AR occlusion distance but keeps a corrupt stored value
  // from effectively disabling the bound by accident.
  occluderRadiusM: { min: 0, max: 200, step: 5 },
} as const;

/**
 * Validation constraints for the frame-tile display-resolution divisor.
 *
 * Clamped to 1–8 (full down to one-eighth per dimension), mirroring the capture
 * `IMAGE_CONSTRAINTS.resolutionDivisor` range so the settings slider behaves the
 * same. The intended stops are 1, 2, 4, 8 (full / half / quarter / eighth); the
 * divisor is rounded to an integer so the resize target dimensions stay clean.
 */
export const FRAME_TILE_DISPLAY_CONSTRAINTS = {
  divisor: { min: 1, max: 8, step: 1 },
  // Live tile cap: 0 = unlimited; 2000 is far past any sane on-device tile
  // budget (each tile is one draw call + one texture) but keeps a corrupt
  // stored value from making the cap effectively unbounded by accident.
  maxTiles: { min: 0, max: 2000, step: 10 },
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
 * Validate and normalize the compass alignment debug toggles. Boolean-or-default
 * per field; a missing/corrupted/pre-feature value falls back to the OFF default
 * so a bad persisted value can never silently turn an alignment override ON.
 */
export function validateCompassDebugOptions(
  options: Partial<CompassDebugOptions>
): CompassDebugOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.compassDebug;
  return {
    coldStartOverride:
      typeof options.coldStartOverride === 'boolean'
        ? options.coldStartOverride
        : defaults.coldStartOverride,
    rotationPrior:
      typeof options.rotationPrior === 'boolean'
        ? options.rotationPrior
        : defaults.rotationPrior,
    webXRConsistency:
      typeof options.webXRConsistency === 'boolean'
        ? options.webXRConsistency
        : defaults.webXRConsistency,
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
    headingUpMap:
      typeof options.headingUpMap === 'boolean'
        ? options.headingUpMap
        : defaults.headingUpMap,
    // Same boolean-or-default policy, but the default is OFF (debug tool) — a
    // corrupt value must never switch the overlay on by itself.
    statsOverlay:
      typeof options.statsOverlay === 'boolean'
        ? options.statsOverlay
        : defaults.statsOverlay,
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
    // gridSize is an N×N grid dimension, so it must be an integer: round here
    // (and fall back to the default for non-finite input) so the sanitizer's
    // output always applies downstream. DepthSampler.updateConfig rejects a
    // fractional gridSize, so without this an out-of-band value would survive
    // validation yet silently fall back to the sampler's default at runtime.
    gridSize: clamp(
      typeof options.gridSize === 'number' && Number.isFinite(options.gridSize)
        ? Math.round(options.gridSize)
        : defaults.gridSize,
      DEPTH_CONSTRAINTS.gridSize.min,
      DEPTH_CONSTRAINTS.gridSize.max
    ),
    rgb: typeof options.rgb === 'boolean' ? options.rgb : defaults.rgb,
  };
}

/**
 * Validate and normalize the motion-filter (blurry-frame gate) options.
 * `enabled` is boolean-or-default; the three numeric thresholds are clamped to
 * {@link MOTION_FILTER_CONSTRAINTS} with a `Number.isFinite` guard (a stored
 * `NaN` is `typeof 'number'` and would survive `clamp`). A missing group
 * default-fills entirely — a pre-feature persisted options object that lacks
 * `motionFilter` therefore loads with the gate enabled rather than crashing.
 */
export function validateMotionFilterOptions(
  options: Partial<MotionFilterConfig>
): MotionFilterConfig {
  const defaults = DEFAULT_RECORDING_OPTIONS.images.motionFilter;
  return {
    enabled:
      typeof options.enabled === 'boolean' ? options.enabled : defaults.enabled,
    maxAngularVelocity: clamp(
      typeof options.maxAngularVelocity === 'number' &&
        Number.isFinite(options.maxAngularVelocity)
        ? options.maxAngularVelocity
        : defaults.maxAngularVelocity,
      MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.min,
      MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.max
    ),
    maxLinearVelocity: clamp(
      typeof options.maxLinearVelocity === 'number' &&
        Number.isFinite(options.maxLinearVelocity)
        ? options.maxLinearVelocity
        : defaults.maxLinearVelocity,
      MOTION_FILTER_CONSTRAINTS.maxLinearVelocity.min,
      MOTION_FILTER_CONSTRAINTS.maxLinearVelocity.max
    ),
    maxWaitMs: clamp(
      typeof options.maxWaitMs === 'number' &&
        Number.isFinite(options.maxWaitMs)
        ? options.maxWaitMs
        : defaults.maxWaitMs,
      MOTION_FILTER_CONSTRAINTS.maxWaitMs.min,
      MOTION_FILTER_CONSTRAINTS.maxWaitMs.max
    ),
  };
}

/**
 * Validate and normalize the image-quality (blur/blackness gate) options. Same
 * policy as {@link validateMotionFilterOptions}: `enabled` is boolean-or-default;
 * the three numeric thresholds are clamped to {@link QUALITY_FILTER_CONSTRAINTS}
 * with a `Number.isFinite` guard (a stored `NaN` is `typeof 'number'` and would
 * survive `clamp`). A missing group default-fills entirely — a pre-feature
 * persisted options object that lacks `qualityFilter` loads with the gate
 * disabled (the safe default) rather than crashing.
 */
export function validateQualityFilterOptions(
  options: Partial<QualityFilterConfig>
): QualityFilterConfig {
  const defaults = DEFAULT_RECORDING_OPTIONS.images.qualityFilter;
  return {
    enabled:
      typeof options.enabled === 'boolean' ? options.enabled : defaults.enabled,
    blurRelativeThreshold: clamp(
      typeof options.blurRelativeThreshold === 'number' &&
        Number.isFinite(options.blurRelativeThreshold)
        ? options.blurRelativeThreshold
        : defaults.blurRelativeThreshold,
      QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.min,
      QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.max
    ),
    minMeanLuminance: clamp(
      typeof options.minMeanLuminance === 'number' &&
        Number.isFinite(options.minMeanLuminance)
        ? options.minMeanLuminance
        : defaults.minMeanLuminance,
      QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.min,
      QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.max
    ),
    maxWaitMs: clamp(
      typeof options.maxWaitMs === 'number' &&
        Number.isFinite(options.maxWaitMs)
        ? options.maxWaitMs
        : defaults.maxWaitMs,
      QUALITY_FILTER_CONSTRAINTS.maxWaitMs.min,
      QUALITY_FILTER_CONSTRAINTS.maxWaitMs.max
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
    motionFilter: validateMotionFilterOptions(options.motionFilter ?? {}),
    qualityFilter: validateQualityFilterOptions(options.qualityFilter ?? {}),
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
 *
 * **Backward-compat migration:** the occlusion options were a single
 * `occlusionMeshEnabled` boolean before 2026-06-29; they are now the two
 * composable booleans `persistentOcclusion` + `liveOcclusion`. A persisted
 * object that predates the split carries only the legacy field, so when the new
 * `persistentOcclusion` is absent we read `occlusionMeshEnabled` and map
 * `true → persistentOcclusion: true` (the old mesh occluder is the persistent
 * one); the legacy shape never enabled a live occluder, so `liveOcclusion`
 * stays at its default. A present new field always wins over the legacy one.
 * See `2026-06-29-occupancy-mesh-followups.md`.
 */
/**
 * Resolve `persistentOcclusion` with legacy migration. A **present** new field
 * always wins over the legacy `occlusionMeshEnabled` — even when its value is
 * invalid: a present-but-corrupt value falls back to the default, never to the
 * legacy flag, so corrupted saved options can't silently flip the occluder
 * against the "new field wins" contract. Only an **absent** new field migrates
 * the legacy boolean (`true → persistent on`); else the default.
 */
function resolvePersistentOcclusion(
  options: Partial<OccupancyOptions>,
  legacyOcclusionMeshEnabled: unknown,
  defaultValue: boolean
): boolean {
  if ('persistentOcclusion' in options) {
    return typeof options.persistentOcclusion === 'boolean'
      ? options.persistentOcclusion
      : defaultValue;
  }
  return typeof legacyOcclusionMeshEnabled === 'boolean'
    ? legacyOcclusionMeshEnabled
    : defaultValue;
}

/**
 * Resolve `occluderDebugStyle` with legacy migration, following the same
 * contract as {@link resolvePersistentOcclusion}: a **present** new field
 * always wins over the legacy `occluderDebugViz` boolean — even when its value
 * is unknown/corrupt it falls back to the default (`'off'`), never to the
 * legacy flag, so corrupted saved options can't silently turn a debug render
 * on. Only an **absent** new field migrates the legacy boolean
 * (`true → 'matcap'`, the skin the boolean used to enable); else the default.
 */
function resolveOccluderDebugStyle(
  options: Partial<OccupancyOptions>,
  legacyOccluderDebugViz: unknown,
  defaultValue: OccluderDebugStyle
): OccluderDebugStyle {
  if ('occluderDebugStyle' in options) {
    return (OCCLUDER_DEBUG_STYLES as readonly unknown[]).includes(
      options.occluderDebugStyle
    )
      ? (options.occluderDebugStyle as OccluderDebugStyle)
      : defaultValue;
  }
  if (typeof legacyOccluderDebugViz === 'boolean') {
    return legacyOccluderDebugViz ? 'matcap' : 'off';
  }
  return defaultValue;
}

export function validateOccupancyOptions(
  options: Partial<OccupancyOptions>
): OccupancyOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.occupancy;
  // Legacy fields (removed from OccupancyOptions): only read for migration.
  const legacyOcclusionMeshEnabled = (
    options as { occlusionMeshEnabled?: unknown }
  ).occlusionMeshEnabled;
  const legacyOccluderDebugViz = (options as { occluderDebugViz?: unknown })
    .occluderDebugViz;
  return {
    cellSizeM: clamp(
      typeof options.cellSizeM === 'number' &&
        Number.isFinite(options.cellSizeM)
        ? options.cellSizeM
        : defaults.cellSizeM,
      OCCUPANCY_CONSTRAINTS.cellSizeM.min,
      OCCUPANCY_CONSTRAINTS.cellSizeM.max
    ),
    // Round before clamping so a fractional stored value resolves to a valid
    // integer threshold; NaN/non-finite falls back to the default (clamp would
    // otherwise pass NaN straight through, and getOccupiedCells expects an int).
    minConfidence: clamp(
      typeof options.minConfidence === 'number' &&
        Number.isFinite(options.minConfidence)
        ? Math.round(options.minConfidence)
        : defaults.minConfidence,
      OCCUPANCY_CONSTRAINTS.minConfidence.min,
      OCCUPANCY_CONSTRAINTS.minConfidence.max
    ),
    // Present new field wins (even if invalid → default); absent → migrate the
    // legacy boolean. See resolvePersistentOcclusion.
    persistentOcclusion: resolvePersistentOcclusion(
      options,
      legacyOcclusionMeshEnabled,
      defaults.persistentOcclusion
    ),
    // The legacy single-toggle never drove a live occluder, so there is nothing
    // to migrate here — boolean-or-default only.
    liveOcclusion:
      typeof options.liveOcclusion === 'boolean'
        ? options.liveOcclusion
        : defaults.liveOcclusion,
    // Present new field wins (unknown value → default 'off'); absent → migrate
    // the legacy occluderDebugViz boolean. See resolveOccluderDebugStyle.
    occluderDebugStyle: resolveOccluderDebugStyle(
      options,
      legacyOccluderDebugViz,
      defaults.occluderDebugStyle
    ),
    // Enum-or-default: only one of the known mesher modes is accepted; anything
    // else (corrupt/legacy/missing) falls back to the default blocky cubes.
    occluderMeshMode: (OCCLUDER_MESH_MODES as readonly string[]).includes(
      options.occluderMeshMode as string
    )
      ? (options.occluderMeshMode as OccluderMeshMode)
      : defaults.occluderMeshMode,
    // Number-or-default; 0 stays 0 (the explicit "unbounded"). Rounded to
    // whole meters — the grid throws on invalid radii, so garbage must never
    // pass through.
    occluderRadiusM: clamp(
      typeof options.occluderRadiusM === 'number' &&
        Number.isFinite(options.occluderRadiusM)
        ? Math.round(options.occluderRadiusM)
        : defaults.occluderRadiusM,
      OCCUPANCY_CONSTRAINTS.occluderRadiusM.min,
      OCCUPANCY_CONSTRAINTS.occluderRadiusM.max
    ),
  };
}

/**
 * Validate and normalize frame-tile display options. `divisor` is clamped to
 * {@link FRAME_TILE_DISPLAY_CONSTRAINTS} and rounded to an integer, with a
 * `Number.isFinite` guard so a stored `NaN` (which is `typeof 'number'` and
 * survives `clamp`) falls back to the default rather than producing a broken
 * resize target.
 */
export function validateFrameTileDisplayOptions(
  options: Partial<FrameTileDisplayOptions>
): FrameTileDisplayOptions {
  const defaults = DEFAULT_RECORDING_OPTIONS.frameTileDisplay;
  return {
    divisor: clamp(
      typeof options.divisor === 'number' && Number.isFinite(options.divisor)
        ? Math.round(options.divisor)
        : defaults.divisor,
      FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.min,
      FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.max
    ),
    // Same number-or-default policy; 0 stays 0 (the explicit "unlimited").
    maxTiles: clamp(
      typeof options.maxTiles === 'number' && Number.isFinite(options.maxTiles)
        ? Math.round(options.maxTiles)
        : defaults.maxTiles,
      FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles.min,
      FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles.max
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
    frameTileDisplay: validateFrameTileDisplayOptions(
      options.frameTileDisplay ?? {}
    ),
    visualization: validateVisualizationOptions(options.visualization ?? {}),
    qr: validateQrOptions(options.qr ?? {}),
    compassDebug: validateCompassDebugOptions(options.compassDebug ?? {}),
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
    // `images` carries NESTED objects (`motionFilter`, `qualityFilter`) — the
    // only group that does — so each needs a deeper clone than the other
    // flat-primitive groups. A shallow `{ ...options.images }` would share the
    // same nested references, and the settings modal mutates them in place
    // (`workingOptions.images.motionFilter.enabled = …`,
    // `…images.qualityFilter.enabled = …`); without this the write would reach
    // straight back into DEFAULT_RECORDING_OPTIONS on the no-storage / reset path
    // (DEFAULT → clone → clone), poisoning the default for the session.
    images: {
      ...options.images,
      motionFilter: { ...options.images.motionFilter },
      qualityFilter: { ...options.images.qualityFilter },
    },
    arCrashIsolation: { ...options.arCrashIsolation },
    occupancy: { ...options.occupancy },
    frameTileDisplay: { ...options.frameTileDisplay },
    visualization: { ...options.visualization },
    qr: { ...options.qr },
    compassDebug: { ...options.compassDebug },
  };
}
