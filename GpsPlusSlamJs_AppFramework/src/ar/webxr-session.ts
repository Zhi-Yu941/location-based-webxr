/**
 * WebXR Session Module
 *
 * Handles WebXR AR session initialization and frame loop.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 *
 * Scene Hierarchy:
 *   scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
 *   └── arWorldGroup (local space = NUE; receives alignment matrix)
 *       └── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE matrix)
 *           └── arpose (local space = WebXR)
 *               └── camera (raw AR pose from WebXR)
 *
 * The arWorldGroup is transformed by the GpsPlusSlamJs alignment matrix.
 * The camera's LOCAL transform is the raw AR pose from WebXR.
 * The camera's WORLD transform is the GPS-aligned world pose.
 */

import * as THREE from 'three';
import { createLogger } from '../utils/logger';
import { WEBXR_TO_NUE } from './webxr-nue-basis';
import {
  ImageCaptureManager,
  type ImageCaptureCallbacks,
  type CapturedImage,
  type ImageCaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
} from './image-capture';
import {
  poseReceived as poseReceivedAction,
  poseLost as poseLostAction,
  originReset as originResetAction,
  resetTracking as resetTrackingAction,
  clearLastRestartedPayload as clearLastRestartedPayloadAction,
  selectTrackingPhase,
  selectLastRestartedPayload,
  type TrackingPhase,
  type TrackingSliceState,
  type ResetTransformData,
} from '../state/tracking-slice';

/**
 * Minimal subscribable-store contract the tracking pipeline needs:
 * dispatch the slice actions, read the slice for the restart payload, and
 * subscribe to phase transitions. Structurally compatible with the full
 * `SlamAppStore` (and any test double) without coupling this module to the
 * factory's exact generics.
 */
export interface TrackingSubscribableStore {
  dispatch: (action: { type: string; payload?: unknown }) => unknown;
  getState: () => { tracking: TrackingSliceState };
  subscribe: (listener: () => void) => () => void;
}
import {
  DepthSampler,
  type DepthSamplerCallbacks,
  type DepthSample,
  type DepthInfo,
} from './depth-sampler';
import { CameraBlitCapture, computeCaptureSize } from './camera-blit-capture';
import { acquireCameraTexture } from './xr-camera-texture';
import { clearFrameUpdates, runFrameUpdates } from './frame-loop';
import { runSessionDisposers } from './session-disposers';
import { clearXrFrameUpdates, runXrFrameUpdates } from './xr-frame-loop';
import {
  type OdometryTrackingRestartedPayload,
  nueToWebXR as _nueToWebXR,
  nueQuaternionToWebXR as _nueQuaternionToWebXR,
} from 'gps-plus-slam-js';
import type { ARPose } from '../types/ar-types';
import { getLastDeviceOrientation } from '../state/gps-event-coordinator';
import {
  DEFAULT_RECORDING_OPTIONS,
  type ArCrashIsolationOptions,
  validateArCrashIsolationOptions,
} from '../state/recording-options';
import { SCENE_NODE } from './scene-node-names';
import {
  createCss3dRendererManager,
  type Css3dRendererManager,
} from '../visualization/css3d-renderer-manager.js';
import type { XRCameraLike } from './xr-camera-texture';

// Re-export types for consumers
export type { CapturedImage } from './image-capture';
export type { DepthSample } from './depth-sampler';
export type { ARPose } from '../types/ar-types';

const log = createLogger('WebXR');

export function isXRCameraLike(value: unknown): value is XRCameraLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const camera = value as { width?: unknown; height?: unknown };
  return (
    typeof camera.width === 'number' &&
    Number.isFinite(camera.width) &&
    camera.width > 0 &&
    typeof camera.height === 'number' &&
    Number.isFinite(camera.height) &&
    camera.height > 0
  );
}

/**
 * Extract a validated XRCameraLike from an XRViewerPose.
 *
 * Returns null in every case where the per-frame texture acquisition must be
 * skipped — i.e. whenever the caller should treat any previously cached
 * texture as stale and clear it. Centralising the preconditions here makes
 * it impossible to accidentally fall through without clearing the cache.
 *
 * Cases that return null:
 *   - pose is null (tracking lost)
 *   - pose has no views
 *   - the first view has no `camera` property (camera-access not granted)
 *   - the camera property is not a valid XRCameraLike (zero/NaN dimensions)
 *
 * @see docs/2026-02-06-bug-camera-frames-black.md
 */
export function getXrCameraFromPose(
  pose: XRViewerPose | null
): XRCameraLike | null {
  if (!pose) {
    return null;
  }
  const view = pose.views[0];
  if (!view) {
    return null;
  }
  const candidate = (view as { camera?: unknown }).camera;
  return isXRCameraLike(candidate) ? candidate : null;
}

/**
 * Decide whether the one-time camera-access grant diagnostic should fire
 * on the current XR frame.
 *
 * The diagnostic is only meaningful when we actually have a valid pose:
 * if `pose` is null (e.g. session starts with tracking lost), then the
 * derived `xrCamera` is null regardless of permission state, and logging
 * "NOT GRANTED" would be a false negative that permanently suppresses the
 * correct status because `cameraAccessLoggedOnce` would latch to true.
 *
 * Additional conditions:
 *   - `alreadyLogged` prevents spamming the log every frame.
 *   - `captureActive` ensures we only care when an image capture session
 *     is running (otherwise the diagnostic has no audience).
 *
 * This predicate is extracted as a pure function so the guard against the
 * "first frame has no pose" false-negative regression is directly testable.
 */
export function shouldLogCameraAccessDiagnostic(
  pose: XRViewerPose | null,
  alreadyLogged: boolean,
  captureActive: boolean
): boolean {
  return pose !== null && !alreadyLogged && captureActive;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let xrSession: XRSession | null = null;

/**
 * Monotonic time of the previous XR frame, in milliseconds (XR `time`
 * argument). Reset to 0 by `resetWebXRState()` so the first frame of a
 * new session sees `dt = 0` rather than a stale delta from the prior
 * session.
 */
let lastFrameTime = 0;

/**
 * Reset WebXR module state - exported for testing only.
 * @internal
 */
export function resetWebXRState(): void {
  // Stop render loop and dispose GPU resources before nulling references
  if (renderer) {
    renderer.setAnimationLoop(null);
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
    renderer.dispose();
  }
  renderer = null;
  scene = null;
  camera = null;
  xrSession = null;
  arWorldGroup = null;
  arPoseNode = null;
  latestArPose = null;
  lastFrameTime = 0;
  clearFrameUpdates();
  clearXrFrameUpdates();
  // Flush session-scoped teardown (e.g. the store subscription opened by
  // `enableArWorldGroupAlignment`). `clearFrameUpdates` above already drops the
  // per-frame ticks; this releases the non-frame resources that would otherwise
  // outlive the session. This is the single chokepoint every restart passes
  // through, so callers never have to dispose those by hand.
  runSessionDisposers();
  imageCaptureManager = null;
  onImageCaptured = null;
  getScreenRotation = null;
  onCaptureFailed = null;
  onSuspiciousImage = null;
  if (trackingPhaseUnsubscribe) {
    trackingPhaseUnsubscribe();
    trackingPhaseUnsubscribe = null;
  }
  trackingStore = null;
  onTrackingRestarted = null;
  onTrackingLost = null;
  onTrackingRecovered = null;
  depthSampler = null;
  onDepthCaptured = null;
  onDepthUnavailable = null;
  onFrameCallback = null;
  if (css3dManager) {
    css3dManager.dispose();
    css3dManager = null;
  }
  cameraAccessLoggedOnce = false;
  getCameraTextureNullCount = 0;
  latestCameraWidth = 0;
  latestCameraHeight = 0;
  currentArCrashIsolationOptions = {
    ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation,
  };
  cleanupBlitResources();
}

/**
 * The AR world group - parent of camera and all AR-tracked content.
 * This group's transform = the alignment matrix from GpsPlusSlamJs.
 * When the library computes a new alignment, apply it to this group.
 */
let arWorldGroup: THREE.Group | null = null;

/**
 * The arpose Object3D — intermediate node between arWorldGroup and camera.
 * During recording it stays at identity; during replay it receives recorded
 * odomPosition/odomRotation from the store subscriber.
 */
let arPoseNode: THREE.Object3D | null = null;

/**
 * Stores the latest raw AR pose from WebXR (updated every frame).
 * This is read by the GPS callback to create paired GPS+AR events.
 */
let latestArPose: ARPose | null = null;

/**
 * Image capture manager instance (created when AR session starts)
 */
let imageCaptureManager: ImageCaptureManager | null = null;

/**
 * Callback for when an image is captured (set via setImageCaptureCallback)
 */
let onImageCaptured: ((image: CapturedImage) => void) | null = null;

/**
 * Callback for when image capture fails (set via setImageCaptureCallback)
 */
let onCaptureFailed: (() => void) | null = null;

/**
 * Callback for when a captured image appears suspicious/black
 * (set via setImageCaptureCallback)
 */
let onSuspiciousImage: ((blobSize: number, frameIndex: number) => void) | null =
  null;

/**
 * Screen rotation getter (set via setImageCaptureCallback)
 */
let getScreenRotation: (() => number) | null = null;

/**
 * Redux store injected by the host (`setTrackingStore`). When present
 * together with `onTrackingRestarted`, `onXRFrame` dispatches
 * `poseReceived`/`poseLost`, the XR reference-space reset listener
 * dispatches `originReset`, and a `subscribeToSelector` translation
 * surface translates phase transitions back into the existing
 * `onTrackingLost` / `onTrackingRestarted` / `onTrackingRecovered`
 * callbacks. When the store is absent the tracking pipeline simply
 * no-ops.
 */
let trackingStore: TrackingSubscribableStore | null = null;

/**
 * Unsubscribe handle returned by the phase subscription set up in
 * `initAR`. Cleared in `resetWebXRState` and on session-end so we never
 * leave dangling listeners on a stale store.
 */
let trackingPhaseUnsubscribe: (() => void) | null = null;

/**
 * Callback for when tracking restarts (set via setTrackingCallbacks)
 */
let onTrackingRestarted:
  | ((payload: OdometryTrackingRestartedPayload) => void)
  | null = null;

/**
 * Callback for when tracking is lost (set via setTrackingLostCallback)
 * Field Test Readiness Issue #3: Provide user feedback when tracking is lost
 */
let onTrackingLost: (() => void) | null = null;

/**
 * Callback for when tracking recovers seamlessly without origin reset (Case 1).
 * Set via setTrackingRecoveredCallback.
 */
let onTrackingRecovered: (() => void) | null = null;

/**
 * Depth sampler instance (created when AR session starts with depth callbacks)
 */
let depthSampler: DepthSampler | null = null;

/**
 * Callback for when a depth sample is captured (set via setDepthCaptureCallback)
 */
let onDepthCaptured: ((sample: DepthSample) => void) | null = null;

/**
 * Callback for when depth sensing is determined to be unavailable.
 * Field Test Readiness Issue #8: Notify user if depth was requested but not granted.
 */
let onDepthUnavailable: (() => void) | null = null;

/**
 * Per-frame callback for custom updates (e.g., map overlay position).
 * Called every XR frame after pose updates but before render.
 */
let onFrameCallback: (() => void) | null = null;

/**
 * CSS3D renderer manager for rendering DOM-based 3D objects (e.g., Leaflet map)
 * alongside the WebGL render. Created in initAR(), disposed in resetWebXRState().
 */
let css3dManager: Css3dRendererManager | null = null;

/**
 * Camera blit capture instance for reading WebXR opaque camera textures.
 * Created when image capture starts, disposed when it stops.
 * @see docs/2026-02-06-bug-camera-frames-black.md
 */
let blitCapture: CameraBlitCapture | null = null;

/**
 * Latest WebXR camera texture, updated each frame when camera-access is enabled.
 * Acquired via Three.js's renderer.xr.getCameraTexture() API (ExternalTexture).
 * @see xr-camera-texture.ts
 */
let latestCameraTexture: THREE.Texture | null = null;

/**
 * Latest camera frame dimensions from XRCamera (native resolution).
 * Used to dynamically resize the blit render target for full-quality captures.
 */
let latestCameraWidth = 0;
let latestCameraHeight = 0;

/**
 * Track whether camera-access diagnostic status has been logged.
 * Reset on each new session via resetWebXRState().
 */
let cameraAccessLoggedOnce = false;

/**
 * Counter for throttled getCameraTexture diagnostic logging.
 * Only logs the first few null returns to avoid log spam.
 */
let getCameraTextureNullCount = 0;
const GET_CAMERA_TEXTURE_LOG_THRESHOLD = 5;
let currentArCrashIsolationOptions: ArCrashIsolationOptions = {
  ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation,
};

/**
 * Dispose blit capture resources and clear the cached camera texture.
 * Shared by resetWebXRState() and stopImageCapture() to avoid duplication.
 */
function cleanupBlitResources(): void {
  if (blitCapture) {
    blitCapture.dispose();
    blitCapture = null;
  }
  latestCameraTexture = null;
}

/**
 * Extract the reset transform from an XRReferenceSpaceEvent-like object.
 *
 * Distinguishes three cases per OdometryTrackingRestartedPayload semantics:
 * - Transform property missing (older browsers) → returns `undefined`
 * - Transform property present but null (runtime can't determine delta) → returns `null`
 * - Transform property present with data → returns `ResetTransformData`
 *
 * This is a pure function extracted for testability.
 *
 * @param event - The event object, cast to a record with an optional transform property
 * @returns ResetTransformData, null, or undefined
 */
export function extractResetTransformData(
  event: Record<string, unknown>
): ResetTransformData | null | undefined {
  if (!('transform' in event)) {
    return undefined;
  }
  const transform = event.transform as {
    position: DOMPointReadOnly;
    orientation: DOMPointReadOnly;
  } | null;
  if (!transform) {
    return null;
  }
  const pos = transform.position;
  const ori = transform.orientation;
  return {
    position: [pos.x, pos.y, pos.z],
    orientation: [ori.x, ori.y, ori.z, ori.w],
  };
}

/**
 * Extract pose data from an XRViewerPose.
 * Returns null if pose or views are unavailable.
 *
 * This is a pure function extracted for testability.
 *
 * @param pose - The XRViewerPose from frame.getViewerPose()
 * @returns ARPose with position and orientation, or null
 */
export function extractPoseFromViewer(
  pose: XRViewerPose | null
): ARPose | null {
  if (!pose) {
    return null;
  }

  const view = pose.views[0];
  if (!view) {
    return null;
  }

  const { position, orientation } = view.transform;

  return {
    position: { x: position.x, y: position.y, z: position.z },
    orientation: {
      x: orientation.x,
      y: orientation.y,
      z: orientation.z,
      w: orientation.w,
    },
  };
}

/**
 * Get the current raw AR pose from the latest XR frame.
 * This is updated every frame and should be called when GPS arrives
 * to get the AR pose at that moment.
 *
 * IMPORTANT: This returns the RAW pose from WebXR, NOT transformed
 * by any alignment matrix. This is what we record to the store.
 *
 * @returns The latest AR pose, or null if no pose available yet
 */
export function getCurrentArPose(): ARPose | null {
  return latestArPose;
}

/**
 * Opt-in standard WebXR session features that are independent of the
 * crash-isolation diagnostic flags. Kept separate from
 * `ArCrashIsolationOptions` because requesting `hit-test` is a normal app
 * capability, not a crash-isolation toggle.
 */
export interface SessionFeatureOptions {
  /**
   * Request the WebXR `hit-test` feature (as an *optional* feature) so app
   * code can drive a reticle via `registerXrFrameUpdate`. Default `false` —
   * existing recorder/anchor sessions are unaffected.
   */
  requestHitTest?: boolean;
}

/**
 * Build XR session init options.
 * Extracted as a pure function for testability.
 *
 * @param rootElement - The DOM element for DOM overlay
 * @param isolationOptions - Crash-isolation diagnostic flags (DOM overlay,
 *   depth-sensing, camera-access)
 * @param sessionFeatures - Opt-in standard WebXR features that are independent
 *   of crash isolation (currently `requestHitTest`)
 * @returns XRSessionInit options
 * @throws Error if rootElement is null
 */
export function buildSessionOptions(
  rootElement: Element | null,
  isolationOptions: Partial<ArCrashIsolationOptions> = {},
  sessionFeatures: SessionFeatureOptions = {}
): XRSessionInit {
  if (!rootElement) {
    throw new Error('App root element not found');
  }
  const normalizedOptions = validateArCrashIsolationOptions(isolationOptions);
  const optionalFeatures: string[] = [];
  const sessionOptions: XRSessionInit = {
    requiredFeatures: ['local-floor'],
  };

  if (normalizedOptions.enableDomOverlay) {
    optionalFeatures.push('dom-overlay');
    sessionOptions.domOverlay = { root: rootElement };
  }

  if (normalizedOptions.enableDepthSensingFeature) {
    optionalFeatures.push('depth-sensing');
    Object.assign(sessionOptions, {
      // Required when requesting depth-sensing feature, otherwise Chrome/ARCore throws TypeError
      // Note: Only 'cpu-optimized' is used to avoid a Three.js bug where glBinding.getDepthInformation()
      // is called without null-checking glBinding when 'gpu-optimized' is active.
      // See: https://github.com/mrdoob/three.js/issues/... (Three.js WebXRManager race condition)
      // Our DepthSampler uses XRFrame.getDepthInformation() which works with cpu-optimized.
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
    });
  }

  if (normalizedOptions.enableCameraAccess) {
    optionalFeatures.push('camera-access');
  }

  // Hit-test is requested as an *optional* feature (not required) so the
  // session still starts on devices/runtimes without hit-test support; the
  // app guards on whether a hit-test source is actually obtainable. Opt-in
  // via `requestHitTest` so existing recorder/anchor sessions are unaffected.
  if (sessionFeatures.requestHitTest) {
    optionalFeatures.push('hit-test');
  }

  if (optionalFeatures.length > 0) {
    sessionOptions.optionalFeatures = optionalFeatures;
  }

  return sessionOptions;
}

/**
 * Check if WebXR immersive-ar is supported
 */
export async function isWebXRSupported(): Promise<boolean> {
  if (!navigator.xr) {
    return false;
  }
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/**
 * Create the scene hierarchy with proper AR/GPS frame separation.
 * This is a pure function for testability.
 *
 * Hierarchy:
 *   scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
 *   ├── ambientLight
 *   ├── directionalLight
 *   └── arWorldGroup (local space = NUE; receives alignment matrix)
 *       └── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE matrix)
 *           └── arpose (Object3D — AR pose; local space = WebXR)
 *               └── camera (PerspectiveCamera)
 *
 * basisChangeNode is a static scene-graph node that holds the WEBXR_TO_NUE
 * basis-change matrix permanently (matrixAutoUpdate=false). Moving it here
 * instead of composing it in applyAlignmentMatrix() keeps arWorldGroup's
 * local space in the **NUE axis convention** (X=North, Y=Up, Z=East), so no
 * WebXR↔NUE swizzle is needed for children.
 *
 * CAUTION — two NUE frames: arWorldGroup's local space is the *AR-odometry*
 * NUE frame, i.e. the **domain** of the alignment matrix, NOT the GPS-world
 * NUE frame of the scene root. Only content authored in AR-odometry
 * coordinates (e.g. the camera subtree) may be placed with raw local values.
 * GPS-world content (a lat/lon → NUE point) is expressed in the scene-root
 * frame and must be pre-multiplied by alignment⁻¹ before being used as a
 * local position under arWorldGroup — see createGpsAnchor and the
 * alignment-frame bug doc
 * (GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md).
 *
 * - Recording: arpose stays at identity; WebXRManager writes to camera.
 * - Replay: arpose receives recorded odomPosition/odomRotation;
 *   camera is owned by user controls (OrbitControls / FPS).
 *
 * @returns Object containing scene, arWorldGroup, arpose, and camera
 */
export function createSceneHierarchy(): {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
  arpose: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
} {
  const newScene = new THREE.Scene();

  // Create the AR world group — local space is NUE (X=North, Y=Up, Z=East).
  // applyAlignmentMatrix() writes the alignment matrix directly here.
  const newArWorldGroup = new THREE.Group();
  newArWorldGroup.name = 'ar-world';
  newScene.add(newArWorldGroup);

  // Static basis-change node: converts WebXR camera coordinates to NUE world
  // space. Set once at scene creation from WEBXR_TO_NUE and never modified.
  // matrixAutoUpdate=false ensures Three.js never overwrites it from
  // position/quaternion/scale decomposition.
  const newBasisChangeNode = new THREE.Group();
  newBasisChangeNode.name = SCENE_NODE.BASIS_CHANGE;
  newBasisChangeNode.matrix.copy(WEBXR_TO_NUE);
  newBasisChangeNode.matrixAutoUpdate = false;
  newArWorldGroup.add(newBasisChangeNode);

  // Create arpose — intermediate node between basisChangeNode and camera.
  // Its local space is WebXR (X=East, Y=Up, Z=South).
  // During recording it stays at identity (transparent in transform chain).
  // During replay it receives the recorded AR pose.
  const newArPose = new THREE.Object3D();
  newArPose.name = 'ar-pose';
  newBasisChangeNode.add(newArPose);

  // Create camera INSIDE arpose.
  // Its local transform = raw AR pose from WebXR (recording) or user controls (replay).
  // Its world transform = arWorldGroup.matrix × basisChangeNode.matrix × arpose.matrix × camera.matrix
  //                     = alignment × WEBXR_TO_NUE × arpose × camera  (mathematically identical to before)
  const newCamera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  newArPose.add(newCamera);

  // Add lighting to the scene (outside AR world - fixed in GPS space)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  newScene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(0, 10, 5);
  newScene.add(directionalLight);

  return {
    scene: newScene,
    arWorldGroup: newArWorldGroup,
    arpose: newArPose,
    camera: newCamera,
  };
}

/**
 * Initialize the AR session and Three.js renderer.
 * @param container - DOM element to host the AR canvas and CSS3D overlay.
 * @param isolationOptions - Crash-isolation diagnostic flags.
 * @param sessionFeatures - Opt-in standard WebXR features (e.g.
 *   `requestHitTest`) forwarded to the session negotiation.
 */
export async function initAR(
  container: HTMLElement,
  isolationOptions: Partial<ArCrashIsolationOptions> = {},
  sessionFeatures: SessionFeatureOptions = {}
): Promise<void> {
  if (!navigator.xr) {
    throw new Error('WebXR not available');
  }

  // Guard against re-entry. A renderer/session is only non-null between a
  // successful initAR() and a matching endARSession()/resetWebXRState(). If
  // either is still set, calling initAR() again would orphan the previous
  // renderer's canvas in the DOM and leak its GPU resources while silently
  // overwriting the module-level references. Surface this as a programming
  // error so the host tears down the existing session explicitly first.
  if (renderer || xrSession) {
    throw new Error(
      'AR session already initialized — call endARSession() before initAR() again'
    );
  }

  currentArCrashIsolationOptions =
    validateArCrashIsolationOptions(isolationOptions);

  // Create Three.js renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // Insert canvas into DOM
  container.insertBefore(renderer.domElement, container.firstChild);

  // Create CSS3D renderer overlay (Approach E) — child of dom overlay root
  // so it's visible in WebXR's dom-overlay compositing.
  if (currentArCrashIsolationOptions.enableCss3dRenderer) {
    css3dManager = createCss3dRendererManager(
      container,
      window.innerWidth,
      window.innerHeight
    );
  }

  // Create scene with proper hierarchy
  const hierarchy = createSceneHierarchy();
  scene = hierarchy.scene;
  arWorldGroup = hierarchy.arWorldGroup;
  arPoseNode = hierarchy.arpose;
  camera = hierarchy.camera;

  // Request AR session with validated options
  const sessionOptions = buildSessionOptions(
    container,
    currentArCrashIsolationOptions,
    sessionFeatures
  );

  xrSession = await navigator.xr.requestSession('immersive-ar', sessionOptions);

  // Handle session end
  xrSession.addEventListener('end', () => {
    log.info('Session ended');
    // Reset the tracking slice so the next session starts from a clean
    // INITIALIZING state.
    if (trackingStore) {
      trackingStore.dispatch(resetTrackingAction());
    }
    xrSession = null;
    latestArPose = null;
  });

  await renderer.xr.setSession(xrSession);

  // Initialize the tracking pipeline if (a) the host supplied an
  // `onTrackingRestarted` callback (i.e. tracking is wanted at all) and
  // (b) a store was injected via `setTrackingStore`. Without both we keep
  // the legacy no-op behaviour: `onXRFrame` never dispatches and no
  // callbacks ever fire. See docs/2026-05-13-tracking-state-slice-port-plan.md.
  if (onTrackingRestarted && trackingStore) {
    const store = trackingStore;
    // Start from a clean slate — the previous session may have left the
    // slice in any phase. The subscription created below starts with its
    // own closure-local `prev = 'initializing'`, so this dispatch makes
    // the slice match.
    store.dispatch(resetTrackingAction());

    trackingPhaseUnsubscribe = subscribeToTrackingPhase(store);

    // Listen for XRReferenceSpace reset events to distinguish Case 1 (seamless
    // recovery) from Case 2 (relocalization). The reset event fires when the
    // runtime shifts the reference space origin after tracking loss recovery.
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (referenceSpace) {
      referenceSpace.addEventListener('reset', (event: Event) => {
        // Extract the XRReferenceSpaceEvent.transform, distinguishing:
        //   - property missing (older browsers) → undefined
        //   - property null (runtime can't determine delta) → null
        //   - property present with data → ResetTransformData
        const transformData = extractResetTransformData(
          event as unknown as Record<string, unknown>
        );
        store.dispatch(originResetAction(transformData));
        log.warn(
          'XR reference space reset detected',
          transformData ? '(transform available)' : '(no transform)'
        );
      });
    }
  }

  // Initialize depth sampler if callback is set
  if (onDepthCaptured) {
    const depthCallbacks: DepthSamplerCallbacks = {
      onSampleCaptured: onDepthCaptured,
      getCurrentPose: getCurrentArPose,
      // Field Test Readiness Issue #8: Notify user if depth is unavailable
      onDepthUnavailable: onDepthUnavailable ?? undefined,
    };
    depthSampler = new DepthSampler(depthCallbacks);
  }

  // Start render loop
  renderer.setAnimationLoop(onXRFrame);

  log.info('AR session started');
}

/**
 * Snapshot the current `DeviceOrientation` (with documented fallback
 * defaults) for inclusion in `poseReceived` payloads.
 */
function snapshotDeviceOrientation(): {
  alpha: number;
  beta: number;
  gamma: number;
  absolute: boolean;
} {
  const orientation = getLastDeviceOrientation();
  return {
    alpha: orientation?.alpha ?? 0,
    beta: orientation?.beta ?? 0,
    gamma: orientation?.gamma ?? 0,
    absolute: orientation?.absolute ?? false,
  };
}

/**
 * Wire the tracking-slice → host-callbacks translation. The subscriber
 * runs synchronously inside each `dispatch`, so the host callbacks fire
 * in the same order as a direct invocation would.
 *
 * Translation rules (locked in by tracking-slice tests):
 *   - `tracking → lost`: clear `latestArPose` (drops in-flight GPS events)
 *     and call `onTrackingLost?.()`.
 *   - `lost → tracking` with `lastRestartedPayload !== null` (Case 2):
 *     call `onTrackingRestarted?.(payload)` then dispatch
 *     `clearLastRestartedPayload` so a subsequent loss cycle starts clean.
 *   - `lost → tracking` with payload null (Case 1: seamless recovery):
 *     call `onTrackingRecovered?.()`.
 *   - `initializing → tracking`: no callback (initial acquisition is not
 *     a restart — same behaviour as the manager).
 */
function subscribeToTrackingPhase(
  store: TrackingSubscribableStore
): () => void {
  // `prev` is closure-local so the mirror state is naturally scoped to a
  // single subscription. Disposing the subscription (or replacing the
  // store via `setTrackingStore`) discards this closure, so the next
  // subscription always starts fresh at 'initializing'.
  let prev: TrackingPhase = 'initializing';
  return store.subscribe(() => {
    const next = selectTrackingPhase(store.getState());
    if (next === prev) return;
    const previous = prev;
    prev = next;

    if (previous === 'tracking' && next === 'lost') {
      log.warn('Tracking lost');
      // Drop GPS events during tracking loss by nulling the pose.
      // The recording coordinator's null guard will skip GPS events.
      latestArPose = null;
      onTrackingLost?.();
      return;
    }

    if (previous === 'lost' && next === 'tracking') {
      const payload = selectLastRestartedPayload(store.getState());
      if (payload !== null) {
        log.info('Tracking restarted (origin reset)');
        onTrackingRestarted?.(payload);
        store.dispatch(clearLastRestartedPayloadAction());
      } else {
        // A null payload means Case 1 (no origin reset during loss). The
        // legacy manager had a third branch — origin reset flagged but
        // `lastValidPose === null` → warn + fire nothing — but that state is
        // unreachable: `phase` only becomes 'lost' from 'tracking', and
        // 'tracking' is only entered via `poseReceived`, which always sets a
        // non-null `lastValidPose`. So LOST ⟹ lastValidPose !== null, and the
        // only remaining null-payload case is a genuine seamless recovery.
        // See tracking-slice.ts (defensive branch) and the port plan doc.
        log.info('Tracking recovered (same coordinate frame)');
        onTrackingRecovered?.();
      }
    }
  });
}

/**
 * Dispatch the per-frame `poseReceived` / `poseLost` action into the
 * tracking slice. No-op when no store is bound or when tracking wiring
 * was not requested.
 */
function updateTrackingState(arPose: ARPose | null): void {
  if (!trackingStore || !onTrackingRestarted) {
    return;
  }

  if (arPose) {
    trackingStore.dispatch(
      poseReceivedAction({
        pose: arPose,
        sensorOrientation: snapshotDeviceOrientation(),
      })
    );
  } else {
    trackingStore.dispatch(poseLostAction());
  }
}

/**
 * Called each XR frame
 */
function onXRFrame(time: number, frame: XRFrame | undefined): void {
  if (!renderer || !scene || !camera || !frame) {
    return;
  }

  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) {
    return;
  }

  const pose = frame.getViewerPose(referenceSpace);
  const arPose = extractPoseFromViewer(pose);

  // Update tracking state manager
  updateTrackingState(arPose);

  // Tick the per-frame callback registry. `dt`/`elapsed` are derived from
  // the XR `time` argument (monotonic ms since session start) — not from
  // `THREE.Clock` — so replay/test harnesses that drive `onXRFrame` with
  // synthetic timestamps see deterministic ticks. See `frame-loop.ts.md`
  // and `2026-05-13-ecs-migration-plan.md`.
  const dt = lastFrameTime === 0 ? 0 : (time - lastFrameTime) / 1000;
  const elapsed = time / 1000;
  lastFrameTime = time;
  runFrameUpdates(dt, elapsed);

  // Hand the live XR context to app-registered per-frame callbacks (hit-test,
  // light estimation, …). `frame`/`referenceSpace`/`session` are valid only
  // synchronously inside each callback — see `xr-frame-loop.ts` safety
  // contract. We only run these when a session is live (it always is inside
  // `onXRFrame`, but the guard keeps the types honest and avoids firing during
  // teardown races).
  if (xrSession) {
    runXrFrameUpdates({
      frame,
      referenceSpace,
      session: xrSession,
      dt,
      elapsed,
    });
  }

  if (arPose) {
    // Store the latest pose for getCurrentArPose()
    latestArPose = arPose;
  }

  // Extract camera texture for blit capture (camera-access feature).
  // The texture is only valid within this XR frame callback, so we clear
  // any previous reference up-front and only repopulate on successful
  // acquisition this frame. This prevents stale textures from being used
  // in the subsequent capture logic (which could cause native crashes).
  latestCameraTexture = null;
  if (currentArCrashIsolationOptions.enableCameraTextureAcquisition) {
    // getXrCameraFromPose() collapses every precondition failure
    // (pose=null, no views, no .camera, invalid dimensions) to a single
    // null result. Combined with the unconditional clear above, this
    // guarantees we never reuse a stale camera texture across frames.
    const xrCamera = getXrCameraFromPose(pose);

    // Diagnostic: log camera-access grant status once per session.
    // See shouldLogCameraAccessDiagnostic() for why `pose` is part of the
    // guard (prevents a false "NOT GRANTED" when the session's first frame
    // arrives with tracking lost).
    if (
      shouldLogCameraAccessDiagnostic(
        pose,
        cameraAccessLoggedOnce,
        imageCaptureManager !== null
      )
    ) {
      cameraAccessLoggedOnce = true;
      if (xrCamera) {
        log.info(
          'camera-access GRANTED — XRView.camera is available for blit capture'
        );
      } else {
        log.warn(
          'camera-access NOT GRANTED — XRView.camera is undefined. ' +
            'Image capture will fall back to canvas.toBlob() which may produce black/empty frames in WebXR.'
        );
      }
    }

    if (xrCamera) {
      // Use Three.js's built-in getCameraTexture() API.
      // Internally, Three.js creates XRWebGLBinding, calls getCameraImage(),
      // and wraps the result in an ExternalTexture (proper texture subclass).
      const result = acquireCameraTexture(renderer, xrCamera);
      if (result) {
        latestCameraTexture = result.texture;
        latestCameraWidth = result.width;
        latestCameraHeight = result.height;
      } else {
        // Diagnostic: log when getCameraTexture returns null/undefined
        getCameraTextureNullCount++;
        if (getCameraTextureNullCount <= GET_CAMERA_TEXTURE_LOG_THRESHOLD) {
          log.warn(
            `getCameraTexture() returned null (occurrence ${getCameraTextureNullCount}/${GET_CAMERA_TEXTURE_LOG_THRESHOLD}). ` +
              'camera-access is granted but Three.js did not provide a texture.'
          );
        }
      }
    }
  }

  // Check if we need to capture an image
  if (imageCaptureManager) {
    imageCaptureManager.onFrame(time);
  }

  // Check if we need to sample depth
  if (depthSampler) {
    const depthInfo = getDepthInfoFromFrame(frame, pose);
    depthSampler.onFrame(time, depthInfo);
  }

  // Call per-frame callback (e.g., for map overlay position updates)
  if (onFrameCallback) {
    try {
      onFrameCallback();
    } catch (error) {
      log.error('Error in onFrameCallback:', error);
    }
  }

  renderer.render(scene, camera);

  // Render CSS3D overlay (DOM-based 3D objects like Leaflet map)
  if (currentArCrashIsolationOptions.enableCss3dRenderer && css3dManager) {
    css3dManager.render(scene, camera);
  }
}

/**
 * Extract depth information from an XR frame.
 * Returns null if depth sensing is not available.
 */
function getDepthInfoFromFrame(
  frame: XRFrame,
  pose: XRViewerPose | null
): DepthInfo | null {
  if (!pose || !pose.views[0]) {
    return null;
  }

  // XRFrame may have getDepthInformation method if depth-sensing feature is enabled
  // TypeScript doesn't have full types for this yet
  const xrFrame = frame as XRFrame & {
    getDepthInformation?: (view: XRView) => DepthInfo | null;
  };

  if (typeof xrFrame.getDepthInformation !== 'function') {
    return null;
  }

  try {
    const result = xrFrame.getDepthInformation(pose.views[0]);
    return result ?? null;
  } catch {
    // Depth sensing may fail on some devices
    return null;
  }
}

/**
 * Get the current Three.js scene (for adding objects like map)
 */
export function getScene(): THREE.Scene | null {
  return scene;
}

/**
 * Get the AR world group (for adding AR-tracked content)
 * Content added here will be transformed by the alignment matrix.
 */
export function getArWorldGroup(): THREE.Group | null {
  return arWorldGroup;
}

/**
 * Get the current camera
 */
export function getCamera(): THREE.PerspectiveCamera | null {
  return camera;
}

/**
 * Set the scene externally (for replay mode).
 * Allows non-WebXR code paths to register a scene so that modules
 * calling getScene() receive it.
 * @see docs/2026-02-19-replay-mode.md Risk R1
 */
export function setScene(s: THREE.Scene | null): void {
  scene = s;
}

/**
 * Set the AR world group externally (for replay mode).
 * Allows non-WebXR code paths to register an arWorldGroup so that
 * applyAlignmentMatrix() and visualizers work correctly.
 * @see docs/2026-02-19-replay-mode.md Risk R1
 */
export function setArWorldGroup(g: THREE.Group | null): void {
  arWorldGroup = g;
}

/**
 * Set the camera externally (for replay mode).
 * Allows non-WebXR code paths to register a camera so that modules
 * calling getCamera() receive it.
 * @see docs/2026-02-19-replay-mode.md Risk R1
 */
export function setCamera(c: THREE.PerspectiveCamera | null): void {
  camera = c;
}

/**
 * Get the arpose Object3D (intermediate node between arWorldGroup and camera).
 * Returns null before scene initialization.
 */
export function getArPose(): THREE.Object3D | null {
  return arPoseNode;
}

/**
 * Set the arpose Object3D externally (for replay mode).
 * Allows non-WebXR code paths to register an arpose so that
 * store subscribers can update it with recorded odom data.
 */
export function setArPose(a: THREE.Object3D | null): void {
  arPoseNode = a;
}

/**
 * Apply an alignment matrix to the AR world group.
 *
 * The alignment matrix maps odometry positions in NUE space
 * to GPS world space (also NUE). It is applied directly to arWorldGroup
 * whose local space is NUE.
 *
 * The WebXR→NUE basis change lives permanently in basisChangeNode (a
 * child of arWorldGroup), so the full camera world transform is:
 *
 *   camera_world = arWorldGroup × basisChangeNode × arpose × camera_local
 *               = alignment × WEBXR_TO_NUE × arpose × camera_local
 *
 * This is mathematically identical to the previous composition
 * (alignment × WEBXR_TO_NUE applied directly to arWorldGroup.matrix),
 * but arWorldGroup's local space is now NUE: objects placed as children
 * of arWorldGroup use NUE coordinates directly ([1,0,0]=North, [0,0,1]=East).
 *
 * Replay note: arpose still lives in WebXR space (below basisChangeNode),
 * so nuePositionToWebXR() is still required when setting arpose.position.
 *
 * @param matrix - 16-element column-major matrix (gl-matrix mat4 format)
 */
export function applyAlignmentMatrix(matrix: readonly number[]): void {
  if (!arWorldGroup) {
    log.warn('Cannot apply alignment - arWorldGroup not initialized');
    return;
  }

  if (matrix.length !== 16) {
    log.error('Invalid alignment matrix - expected 16 elements');
    return;
  }

  // Write alignment directly — WEBXR_TO_NUE lives in basisChangeNode
  arWorldGroup.matrix.fromArray(matrix);
  arWorldGroup.matrixAutoUpdate = false;
  arWorldGroup.updateMatrixWorld(true);
}

/**
 * Convert a position from internal NUE convention (X=North, Y=Up, Z=East)
 * to WebXR local-floor convention (X=East, Y=Up, Z=South).
 *
 * Delegates to the canonical library implementation (nueToWebXR).
 * Accepts `readonly number[]` for call-site convenience.
 *
 * NUE [n, u, e] → WebXR [e, u, -n]
 */
export function nuePositionToWebXR(
  nue: readonly number[]
): readonly [number, number, number] {
  return _nueToWebXR(nue as [number, number, number]);
}

/**
 * Convert a quaternion from internal NUE convention to WebXR local-floor convention.
 *
 * Delegates to the canonical library implementation (nueQuaternionToWebXR).
 * Accepts `readonly number[]` for call-site convenience.
 *
 * NUE [x, y, z, w] → WebXR [z, y, -x, w]
 */
export function nueQuaternionToWebXR(
  nue: readonly number[]
): readonly [number, number, number, number] {
  return _nueQuaternionToWebXR(nue as [number, number, number, number]);
}

/**
 * End the current XR session and clean up all resources.
 *
 * Stops the animation loop, ends the XR session, then delegates the full
 * teardown to {@link resetWebXRState} so every module-level reference is
 * cleared (renderer/scene/camera, image-capture, depth, the tracking-phase
 * subscription, the frame-update registry, diagnostics, blit resources).
 * This is the production cleanup path — call it when the AR experience is
 * finished.
 */
export async function endARSession(): Promise<void> {
  // Stop the render loop first so onXRFrame stops firing before we end the
  // session and tear everything down.
  if (renderer) {
    renderer.setAnimationLoop(null);
  }

  // End the actual XR session and await it. resetWebXRState() in the
  // `finally` below only nulls the `xrSession` reference — it never calls
  // XRSession.end() — so ending the session here is the one piece of
  // teardown that is unique to the production path.
  //
  // The end()/teardown pair is wrapped in try/finally because
  // XRSession.end() can reject (e.g. the session is already ended or in an
  // invalid state). Without the `finally`, a rejection would skip the
  // teardown and leave `renderer`/`xrSession` non-null — and the re-entry
  // guard in initAR() would then permanently reject every subsequent
  // session until a page reload. Running the teardown unconditionally
  // guarantees the module always returns to a clean, re-initialisable state.
  try {
    if (xrSession) {
      await xrSession.end();
    }
  } finally {
    // Delegate the rest of the teardown to resetWebXRState() so we never leak
    // any module-level reference. Re-implementing a subset here (the previous
    // approach) silently dropped imageCaptureManager, depthSampler, the
    // tracking-phase subscription, the frame-update registry, the scene-graph
    // references and the diagnostic counters — all of which resetWebXRState()
    // clears. Keeping a single source of truth for cleanup prevents new module
    // state from leaking between sessions when it is added to resetWebXRState()
    // but forgotten here.
    resetWebXRState();
  }
}

/**
 * Set up image capture callbacks.
 * Call this before starting image capture to wire up the callback handlers.
 *
 * @param onCaptured - Called when an image is successfully captured
 * @param screenRotationGetter - Returns current device screen rotation (0, 90, 180, 270)
 * @param onFailed - Optional callback for when image capture fails (e.g., low memory)
 * @param onSuspicious - Optional callback for when a captured image appears black/empty
 */
export function setImageCaptureCallback(
  onCaptured: (image: CapturedImage) => void,
  screenRotationGetter: () => number,
  onFailed?: () => void,
  onSuspicious?: (blobSize: number, frameIndex: number) => void
): void {
  onImageCaptured = onCaptured;
  getScreenRotation = screenRotationGetter;
  onCaptureFailed = onFailed ?? null;
  onSuspiciousImage = onSuspicious ?? null;
}

/**
 * Start capturing images during recording.
 * Must call setImageCaptureCallback first.
 * @param config - Optional capture configuration (intervalMs, quality)
 * @param resolutionDivisor - Resolution divisor: 1 = full, 2 = half, 4 = quarter (default: 1)
 */
export function startImageCapture(
  config?: Partial<ImageCaptureConfig>,
  resolutionDivisor = 1
): void {
  if (!renderer) {
    log.warn('Cannot start image capture - renderer not initialized');
    return;
  }

  if (!onImageCaptured || !getScreenRotation) {
    log.warn('Cannot start image capture - callbacks not set');
    return;
  }

  // Stop any in-flight capture session before starting a new one. Without
  // this, a second startImageCapture() (e.g. toggling capture settings
  // mid-session) would overwrite `blitCapture` — leaking the previous
  // CameraBlitCapture and its WebGLRenderTarget GPU memory — and orphan the
  // previous ImageCaptureManager, leaving two managers competing over the
  // same callbacks and a dangling safety timeout running.
  if (imageCaptureManager || blitCapture) {
    log.warn('Image capture already running - stopping previous session');
    stopImageCapture();
  }

  const callbacks: ImageCaptureCallbacks = {
    getCurrentPose: getCurrentArPose,
    getScreenRotation: getScreenRotation,
    onCaptured: onImageCaptured,
    onCaptureFailed: onCaptureFailed ?? undefined,
    onSuspiciousImage: onSuspiciousImage ?? undefined,
  };

  // Set up blit capture for WebXR opaque camera textures.
  // This creates a GPU pipeline that converts the opaque texture to readable pixels.
  // Falls back to canvas.toBlob() when camera-access is not available or blit fails.
  blitCapture = new CameraBlitCapture();
  const currentRenderer = renderer;
  const divisor = resolutionDivisor;
  callbacks.captureFrame = async (quality: number): Promise<Blob | null> => {
    if (!blitCapture || !latestCameraTexture) {
      // camera-access not available or no texture yet — fall back to canvas.toBlob
      return new Promise<Blob | null>((resolve) => {
        currentRenderer.domElement.toBlob(
          (blob) => resolve(blob),
          'image/jpeg',
          quality
        );
      });
    }

    // Dynamically resize render target to match camera resolution (divided by user scale)
    if (latestCameraWidth > 0 && latestCameraHeight > 0) {
      const target = computeCaptureSize(
        latestCameraWidth,
        latestCameraHeight,
        divisor
      );
      blitCapture.resizeIfNeeded(target.width, target.height);
    }

    return blitCapture.captureToBlob(
      currentRenderer,
      latestCameraTexture,
      quality
    );
  };
  log.info(`Blit capture pipeline initialized (resolutionDivisor=${divisor})`);

  // Merge provided config with defaults
  const mergedConfig: ImageCaptureConfig = {
    ...DEFAULT_CAPTURE_CONFIG,
    ...config,
  };

  imageCaptureManager = new ImageCaptureManager(
    renderer.domElement,
    callbacks,
    mergedConfig
  );
  imageCaptureManager.start();
  log.info('Image capture started');
}

/**
 * Stop capturing images.
 */
export function stopImageCapture(): void {
  if (imageCaptureManager) {
    imageCaptureManager.stop();
    log.info(
      `Image capture stopped (${imageCaptureManager.getFrameCount()} frames captured)`
    );
    imageCaptureManager = null;
  }
  cleanupBlitResources();
}

/**
 * Get the current image capture frame count.
 */
export function getImageCaptureFrameCount(): number {
  return imageCaptureManager?.getFrameCount() ?? 0;
}

/**
 * Inject the Redux store used by the tracking-state slice pipeline.
 *
 * MUST be called before `initAR()` whenever the host also wires tracking
 * callbacks via `setTrackingCallbacks`. Without a store the tracking
 * pipeline silently no-ops.
 *
 * @param store — any store satisfying {@link TrackingSubscribableStore}.
 *   `null` clears the binding (useful for teardown in tests).
 */
export function setTrackingStore(
  store: TrackingSubscribableStore | null
): void {
  // If we already have an active phase subscription to a different store,
  // tear it down before swapping. The new subscription is established
  // inside `initAR`, not here, because we also want it to survive
  // `resetWebXRState`-then-`initAR` cycles cleanly.
  if (trackingPhaseUnsubscribe) {
    trackingPhaseUnsubscribe();
    trackingPhaseUnsubscribe = null;
  }
  trackingStore = store;
}

/**
 * Set up tracking state callbacks.
 * Call this BEFORE initAR() to enable tracking restart detection.
 *
 * @param onRestarted - Called when tracking restarts after being lost
 */
export function setTrackingCallbacks(
  onRestarted: (payload: OdometryTrackingRestartedPayload) => void
): void {
  onTrackingRestarted = onRestarted;
}

/**
 * Set a callback for when AR tracking is lost.
 * Call this BEFORE initAR() to enable tracking loss notifications.
 * Field Test Readiness Issue #3: Provide user feedback when tracking is lost.
 *
 * @param callback - Called when tracking is lost (pose becomes null)
 */
export function setTrackingLostCallback(callback: () => void): void {
  onTrackingLost = callback;
}

/**
 * Set a callback for when AR tracking recovers seamlessly (Case 1: same coordinate frame).
 * Call this BEFORE initAR() to enable seamless recovery notifications.
 *
 * @param callback - Called when tracking recovers without origin reset
 */
export function setTrackingRecoveredCallback(callback: () => void): void {
  onTrackingRecovered = callback;
}

/**
 * Set up depth capture callback.
 * Call this BEFORE initAR() to enable depth sampling.
 *
 * @param onCaptured - Called when a depth sample is captured
 * @param onUnavailable - Called once if depth is unavailable after threshold
 */
export function setDepthCaptureCallback(
  onCaptured: (sample: DepthSample) => void,
  onUnavailable?: () => void
): void {
  onDepthCaptured = onCaptured;
  onDepthUnavailable = onUnavailable ?? null;
}

/**
 * Start depth sampling during recording.
 * Must call setDepthCaptureCallback before initAR.
 */
export function startDepthCapture(): void {
  if (!depthSampler) {
    log.warn('Cannot start depth capture - sampler not initialized');
    return;
  }
  depthSampler.start();
  log.info('Depth capture started');
}

/**
 * Stop depth sampling.
 */
export function stopDepthCapture(): void {
  if (depthSampler) {
    const count = depthSampler.getSampleCount();
    depthSampler.stop();
    log.info(`Depth capture stopped (${count} samples captured)`);
  }
}

/**
 * Get the current depth sample count.
 */
export function getDepthSampleCount(): number {
  return depthSampler?.getSampleCount() ?? 0;
}

/**
 * Set a per-frame callback for custom updates.
 * The callback is invoked every XR frame after pose updates but before render.
 * Useful for updating elements that need to follow the camera smoothly
 * (e.g., map overlay position).
 *
 * @param callback - Function to call each frame, or null to clear
 */
export function setFrameCallback(callback: (() => void) | null): void {
  onFrameCallback = callback;
}

/**
 * Get the CSS3D renderer manager for live AR mode.
 * Returns null if no AR session is active or CSS3D was not created.
 */
export function getLiveCss3dManager(): Css3dRendererManager | null {
  return css3dManager;
}
