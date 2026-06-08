/**
 * Unit tests for WebXR session utilities.
 *
 * Tests the pure, extractable parts of WebXR session setup.
 * The actual WebXR API calls require a real device or emulator.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * Tests verify the scene hierarchy and pose separation invariants.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Scene, Group, PerspectiveCamera } from 'three';
import {
  buildSessionOptions,
  extractPoseFromViewer,
  extractResetTransformData,
  createSceneHierarchy,
  isXRCameraLike,
  getXrCameraFromPose,
  shouldLogCameraAccessDiagnostic,
  isWebXRSupported,
  getCurrentArPose,
  getScene,
  getArWorldGroup,
  getCamera,
  getArPose,
  setScene,
  setArWorldGroup,
  setCamera,
  setArPose,
  resetWebXRState,
  endARSession,
  applyAlignmentMatrix,
  nuePositionToWebXR,
  setImageCaptureCallback,
  startImageCapture,
  stopImageCapture,
  getImageCaptureFrameCount,
  setTrackingCallbacks,
  setTrackingLostCallback,
  setTrackingRecoveredCallback,
  setDepthCaptureCallback,
  startDepthCapture,
  stopDepthCapture,
  getDepthSampleCount,
  setFrameCallback,
  getLiveCss3dManager,
  type ARPose,
} from './webxr-session.js';
import { createMockPose } from '../test-utils/browser-mocks.js';
import {
  registerSessionDisposer,
  clearSessionDisposers,
} from './session-disposers.js';
import { SCENE_NODE } from './scene-node-names';

describe('buildSessionOptions', () => {
  /**
   * Why this test matters:
   * Ensures the session options include all required WebXR features.
   * This is a regression test for the domOverlay type safety fix.
   */
  it('returns valid XRSessionInit with required features', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    expect(options.requiredFeatures).toContain('local-floor');
    expect(options.optionalFeatures).toContain('dom-overlay');
    expect(options.optionalFeatures).toContain('depth-sensing');
    expect(options.domOverlay).toEqual({ root: mockElement });
  });

  /**
   * Why this test matters:
   * Regression test for the null-safety issue that was previously
   * hidden by @ts-expect-error. If document.getElementById returns null,
   * we must fail fast with a clear error rather than passing null to WebXR.
   */
  it('throws when rootElement is null', () => {
    expect(() => buildSessionOptions(null)).toThrow(
      'App root element not found'
    );
  });

  /**
   * Why this test matters:
   * Validates that the domOverlay.root is the exact element passed in,
   * ensuring correct DOM overlay behavior in AR sessions.
   */
  it('uses the provided element as domOverlay root', () => {
    const appDiv = document.createElement('div');
    appDiv.id = 'app';

    const options = buildSessionOptions(appDiv);

    expect(options.domOverlay?.root).toBe(appDiv);
  });

  /**
   * Why this test matters:
   * REGRESSION TEST for Sentry issue JS-GPS-RECORDER-1.
   * Three.js has a bug in WebXRManager where glBinding.getDepthInformation()
   * is called without null-checking when gpu-optimized depth is active.
   * This causes crashes during XR session teardown race conditions.
   * We MUST only use cpu-optimized to avoid triggering this bug.
   * Our DepthSampler uses XRFrame.getDepthInformation() which works with cpu-optimized.
   */
  it('uses only cpu-optimized depth sensing to avoid Three.js bug', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    // Access the depthSensing property (typed as unknown in XRSessionInit)
    const depthSensing = (
      options as { depthSensing?: { usagePreference?: string[] } }
    ).depthSensing;

    expect(depthSensing).toBeDefined();
    expect(depthSensing?.usagePreference).toContain('cpu-optimized');
    expect(depthSensing?.usagePreference).not.toContain('gpu-optimized');
  });

  /**
   * Why this test matters (Black Frames Bug Fix):
   * The 'camera-access' optional feature is required for
   * renderer.xr.getCameraTexture() to work. Without it, the WebXR
   * camera texture is not available and we fall back to canvas.toBlob()
   * which produces black frames on Android Chrome.
   *
   * @see docs/2026-02-06-bug-camera-frames-black.md
   */
  it('includes camera-access in optional features for blit capture', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    expect(options.optionalFeatures).toContain('camera-access');
  });

  it('omits dom-overlay when disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableDomOverlay: false,
    });

    expect(options.optionalFeatures).not.toContain('dom-overlay');
    expect(options.domOverlay).toBeUndefined();
  });

  it('omits camera-access when disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableCameraAccess: false,
    });

    expect(options.optionalFeatures).not.toContain('camera-access');
  });

  it('omits depth-sensing config when disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableDepthSensingFeature: false,
    }) as XRSessionInit & { depthSensing?: unknown };

    expect(options.optionalFeatures).not.toContain('depth-sensing');
    expect(options.depthSensing).toBeUndefined();
  });

  it('can build a minimal baseline session request with all optional flags disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement, {
      enableDomOverlay: false,
      enableCameraAccess: false,
      enableDepthSensingFeature: false,
    }) as XRSessionInit & { depthSensing?: unknown };

    expect(options.requiredFeatures).toEqual(['local-floor']);
    expect(options.optionalFeatures).toBeUndefined();
    expect(options.domOverlay).toBeUndefined();
    expect(options.depthSensing).toBeUndefined();
  });

  /**
   * Why this test matters:
   * The minimal AR hit-test example needs the session to request the WebXR
   * `hit-test` feature. It is opt-in (default off) so existing
   * recorder/anchor sessions are unaffected, and it is *optional* (not
   * required) so the session still starts on runtimes without hit-test. See
   * `2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md` §6.3.
   */
  it('does not request hit-test by default', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(mockElement);

    expect(options.optionalFeatures ?? []).not.toContain('hit-test');
    expect(options.requiredFeatures).not.toContain('hit-test');
  });

  it('requests hit-test as an optional feature when requestHitTest is true', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      {},
      { requestHitTest: true }
    );

    expect(options.optionalFeatures).toContain('hit-test');
    // Still optional, never required, so unsupported devices can still start.
    expect(options.requiredFeatures).toEqual(['local-floor']);
  });

  it('keeps hit-test off when requestHitTest is false even with other flags disabled', () => {
    const mockElement = document.createElement('div');

    const options = buildSessionOptions(
      mockElement,
      {
        enableDomOverlay: false,
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
      },
      { requestHitTest: false }
    );

    expect(options.optionalFeatures).toBeUndefined();
  });
});

describe('extractPoseFromViewer', () => {
  /**
   * Why this test matters:
   * Verifies that pose extraction correctly maps XRViewerPose data
   * to our ARPose interface for downstream processing.
   */
  it('extracts position and orientation from valid pose', () => {
    const mockPose = createMockPose(
      { x: 1.5, y: 2.0, z: -3.0 },
      { x: 0.1, y: 0.2, z: 0.3, w: 0.9 }
    );

    // Cast to XRViewerPose - mock contains only properties needed for extraction
    const result = extractPoseFromViewer(mockPose as unknown as XRViewerPose);

    expect(result).not.toBeNull();
    expect(result?.position).toEqual({ x: 1.5, y: 2.0, z: -3.0 });
    expect(result?.orientation).toEqual({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
  });

  /**
   * Why this test matters:
   * Ensures graceful handling when pose is unavailable (e.g., tracking lost).
   */
  it('returns null when pose is null', () => {
    const result = extractPoseFromViewer(null);

    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * Handles edge case where pose exists but has no views.
   */
  it('returns null when pose has no views', () => {
    const emptyPose = { views: [] } as unknown as XRViewerPose;

    const result = extractPoseFromViewer(emptyPose);

    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * Validates that the extracted pose is a plain object (not a reference
   * to the XR types), allowing safe serialization and storage.
   */
  it('returns plain object suitable for serialization', () => {
    const mockPose = createMockPose(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 }
    );

    // Cast to XRViewerPose - mock contains only properties needed for extraction
    const result = extractPoseFromViewer(mockPose as unknown as XRViewerPose);

    // Should be serializable as JSON
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized) as ARPose;

    expect(parsed.position).toEqual({ x: 0, y: 1, z: 0 });
    expect(parsed.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('isXRCameraLike', () => {
  /**
   * Why this test matters:
   * The WebXR frame loop uses this guard before forwarding camera dimensions
   * into the capture pipeline, so accepted values must satisfy downstream
   * assumptions about finite, non-zero render target sizes.
   */
  it('accepts objects with finite positive dimensions', () => {
    expect(isXRCameraLike({ width: 1920, height: 1080 })).toBe(true);
  });

  /**
   * Why this test matters:
   * Invalid dimensions can reach sizing code and produce broken render targets
   * or unexpected capture behavior, so the guard must reject non-finite and
   * non-positive numbers.
   */
  it.each([
    { width: 0, height: 1080 },
    { width: -1, height: 1080 },
    { width: Number.NaN, height: 1080 },
    { width: Number.POSITIVE_INFINITY, height: 1080 },
    { width: 1920, height: 0 },
    { width: 1920, height: -1 },
    { width: 1920, height: Number.NaN },
    { width: 1920, height: Number.POSITIVE_INFINITY },
  ])('rejects invalid camera dimensions: %o', (value) => {
    expect(isXRCameraLike(value)).toBe(false);
  });
});

describe('getXrCameraFromPose', () => {
  /**
   * Why this test matters:
   * REGRESSION — the per-frame texture acquisition block used to leave a
   * stale `latestCameraTexture` reference in place whenever its preconditions
   * failed (pose=null, no views, no `.camera`, or invalid dimensions).
   * WebXR camera textures are only valid within the frame callback, so
   * reusing a stale reference can crash the native renderer. This helper
   * collapses every precondition failure to a single `null` result so the
   * caller can unconditionally clear the cache above it.
   * @see 2026-02-06-bug-camera-frames-black.md
   */
  it('returns null when pose is null (tracking lost)', () => {
    expect(getXrCameraFromPose(null)).toBeNull();
  });

  it('returns null when pose has no views', () => {
    const pose = { views: [] } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBeNull();
  });

  it('returns null when the first view has no camera property (camera-access not granted)', () => {
    const pose = { views: [{}] } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBeNull();
  });

  it('returns null when the camera property has invalid dimensions', () => {
    const pose = {
      views: [{ camera: { width: 0, height: 1080 } }],
    } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBeNull();
  });

  it('returns the camera when the first view exposes a valid XRCameraLike', () => {
    const camera = { width: 1920, height: 1080 };
    const pose = { views: [{ camera }] } as unknown as XRViewerPose;
    expect(getXrCameraFromPose(pose)).toBe(camera);
  });
});

describe('shouldLogCameraAccessDiagnostic', () => {
  /**
   * Why these tests matter:
   * REGRESSION — if the session's first XR frame arrives with `pose === null`
   * (tracking lost at startup), `getXrCameraFromPose(null)` returns null
   * regardless of whether camera-access was granted. Without the pose gate,
   * the diagnostic would log "camera-access NOT GRANTED" and latch
   * `cameraAccessLoggedOnce = true`, permanently suppressing the correct
   * status once a pose becomes available. Locks in the pose-guarded
   * behaviour of the one-shot diagnostic.
   */
  const validPose = {
    views: [{ camera: { width: 1920, height: 1080 } }],
  } as unknown as XRViewerPose;

  it('returns false when pose is null (avoids false "NOT GRANTED" on tracking-lost startup)', () => {
    expect(shouldLogCameraAccessDiagnostic(null, false, true)).toBe(false);
  });

  it('returns false when already logged (one-shot)', () => {
    expect(shouldLogCameraAccessDiagnostic(validPose, true, true)).toBe(false);
  });

  it('returns false when no capture session is active', () => {
    expect(shouldLogCameraAccessDiagnostic(validPose, false, false)).toBe(
      false
    );
  });

  it('returns true when pose is available, not yet logged, and capture is active', () => {
    expect(shouldLogCameraAccessDiagnostic(validPose, false, true)).toBe(true);
  });
});

/**
 * Scene Hierarchy Tests
 *
 * CRITICAL: These tests verify the AR/GPS coordinate frame separation.
 * See docs/architecture-ar-gps-pose-separation.md for why this matters.
 */
describe('createSceneHierarchy', () => {
  /**
   * Why this test matters:
   * The arWorldGroup MUST be a child of the scene for the alignment
   * matrix to work correctly. Without this, the GPS world frame cannot
   * transform the AR local frame.
   */
  it('creates scene with arWorldGroup as direct child', () => {
    const { scene, arWorldGroup } = createSceneHierarchy();

    expect(arWorldGroup.parent).toBe(scene);
    expect(arWorldGroup.name).toBe('ar-world');
  });

  /**
   * Why this test matters:
   * The camera MUST be a descendant of arWorldGroup (via arpose) so that:
   * - camera.matrix (local) = raw AR pose
   * - camera.matrixWorld = GPS world pose
   * If camera is directly in scene, we can't read the raw AR pose.
   */
  it('creates camera as descendant of arWorldGroup (via arpose)', () => {
    const { arpose, camera } = createSceneHierarchy();

    expect(camera.parent).toBe(arpose);
  });

  /**
   * Why this test matters:
   * Verifies the complete hierarchy depth:
   * scene -> arWorldGroup -> basisChangeNode -> arpose -> camera
   * The basisChangeNode holds the constant WEBXR_TO_NUE basis-change so
   * arWorldGroup's local space remains NUE (not WebXR).
   */
  it('maintains correct hierarchy depth (scene -> arWorldGroup -> basisChangeNode -> arpose -> camera)', () => {
    const { scene, arWorldGroup, arpose, camera } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    // Traverse from camera up to scene
    expect(camera.parent).toBe(arpose);
    expect(arpose.parent).toBe(basisChangeNode);
    expect(basisChangeNode.parent).toBe(arWorldGroup);
    expect(arWorldGroup.parent).toBe(scene);
    expect(scene.parent).toBeNull();
  });

  /**
   * Why this test matters:
   * The arWorldGroup's transform is where the alignment matrix is applied.
   * We need to verify we can modify it without affecting initial state.
   */
  it('arWorldGroup starts with identity transform', () => {
    const { arWorldGroup } = createSceneHierarchy();

    // Position should be (0,0,0)
    expect(arWorldGroup.position.x).toBe(0);
    expect(arWorldGroup.position.y).toBe(0);
    expect(arWorldGroup.position.z).toBe(0);

    // Rotation should be identity quaternion (0,0,0,1)
    expect(arWorldGroup.quaternion.x).toBe(0);
    expect(arWorldGroup.quaternion.y).toBe(0);
    expect(arWorldGroup.quaternion.z).toBe(0);
    expect(arWorldGroup.quaternion.w).toBe(1);
  });

  /**
   * Why this test matters:
   * Lighting should be in GPS world space (scene level), not AR space.
   * This ensures lighting stays consistent as AR frame moves.
   */
  it('adds lighting to scene (not arWorldGroup)', () => {
    const { scene, arWorldGroup } = createSceneHierarchy();

    // Scene should have lights
    const sceneLights = scene.children.filter(
      (child) =>
        child.type === 'AmbientLight' || child.type === 'DirectionalLight'
    );
    expect(sceneLights.length).toBeGreaterThanOrEqual(2);

    // arWorldGroup should NOT have lights (only camera)
    const arLights = arWorldGroup.children.filter(
      (child) =>
        child.type === 'AmbientLight' || child.type === 'DirectionalLight'
    );
    expect(arLights.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 6.1: arpose intermediate Object3D
  // -----------------------------------------------------------------------

  /**
   * Why this test matters:
   * The arpose node sits between arWorldGroup and camera so that replay
   * mode can write recorded odomPosition/odomRotation to it without
   * touching the camera's local transform. During recording, arpose
   * stays at identity, making it transparent in the transform chain.
   */
  it('returns an arpose Object3D in the hierarchy result', () => {
    const result = createSceneHierarchy();

    expect(result.arpose).toBeDefined();
    expect(result.arpose).toBeInstanceOf(Object);
    expect(result.arpose.name).toBe('ar-pose');
  });

  /**
   * Why this test matters:
   * basisChangeNode must exist as a direct child of arWorldGroup. It holds
   * the constant WEBXR_TO_NUE matrix so that arWorldGroup's local space is
   * NUE — objects placed at [1,0,0] in arWorldGroup are 1m North, not East.
   */
  it('basisChangeNode (webxr-to-nue) is a direct child of arWorldGroup', () => {
    const { arWorldGroup } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    );

    expect(basisChangeNode).toBeDefined();
    expect(basisChangeNode!.parent).toBe(arWorldGroup);
  });

  /**
   * Why this test matters:
   * The basisChangeNode matrix must equal WEBXR_TO_NUE (column-major) and
   * must have matrixAutoUpdate=false so Three.js never overwrites it from
   * position/quaternion/scale decomposition. This guarantees the basis
   * change is permanent and free (no per-frame recomputation).
   *
   * WEBXR_TO_NUE column-major elements:
   *   [0,0,1,0, 0,1,0,0, -1,0,0,0, 0,0,0,1]
   * Key entries: el[2]=1 (East→Z), el[5]=1 (Up→Up), el[8]=-1 (South→-North)
   */
  it('basisChangeNode has WEBXR_TO_NUE matrix frozen (matrixAutoUpdate=false)', () => {
    const { arWorldGroup } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(basisChangeNode.matrixAutoUpdate).toBe(false);
    const el = basisChangeNode.matrix.elements;
    // col0: [0,0,1,0] — WebXR X(East) → NUE Z(East)
    expect(el[0]).toBeCloseTo(0, 10);
    expect(el[1]).toBeCloseTo(0, 10);
    expect(el[2]).toBeCloseTo(1, 10);
    expect(el[3]).toBeCloseTo(0, 10);
    // col1: [0,1,0,0] — WebXR Y(Up) → NUE Y(Up)
    expect(el[5]).toBeCloseTo(1, 10);
    // col2: [-1,0,0,0] — WebXR Z(South) → NUE X(North) negated
    expect(el[8]).toBeCloseTo(-1, 10);
    expect(el[9]).toBeCloseTo(0, 10);
    expect(el[10]).toBeCloseTo(0, 10);
  });

  /**
   * Why this test matters:
   * arpose must be a child of basisChangeNode (not arWorldGroup directly).
   * Full chain: alignment × WEBXR_TO_NUE × arpose × camera.
   */
  it('arpose is a direct child of basisChangeNode, not arWorldGroup', () => {
    const { arWorldGroup, arpose } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(arpose.parent).toBe(basisChangeNode);
    expect(arWorldGroup.children).not.toContain(arpose);
  });

  /**
   * Why this test matters:
   * Camera must be a child of arpose (not directly of arWorldGroup or basisChangeNode).
   * Hierarchy: basisChangeNode → arpose → camera.
   */
  it('camera is a child of arpose, not arWorldGroup or basisChangeNode directly', () => {
    const { arWorldGroup, arpose, camera } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(camera.parent).toBe(arpose);
    expect(basisChangeNode.children).toContain(arpose);
    expect(arWorldGroup.children).not.toContain(arpose);
    expect(arWorldGroup.children).not.toContain(camera);
  });

  /**
   * Why this test matters:
   * The full hierarchy must be scene → arWorldGroup → basisChangeNode → arpose → camera.
   * This is the chain through which transforms compose.
   */
  it('full hierarchy is scene → arWorldGroup → basisChangeNode → arpose → camera', () => {
    const { scene, arWorldGroup, arpose, camera } = createSceneHierarchy();
    const basisChangeNode = arWorldGroup.children.find(
      (c) => c.name === SCENE_NODE.BASIS_CHANGE
    )!;

    expect(camera.parent).toBe(arpose);
    expect(arpose.parent).toBe(basisChangeNode);
    expect(basisChangeNode.parent).toBe(arWorldGroup);
    expect(arWorldGroup.parent).toBe(scene);
    expect(scene.parent).toBeNull();
  });

  /**
   * Why this test matters:
   * arpose must start at identity transform. During recording, WebXR
   * writes the pose to camera, and an identity arpose is transparent:
   * arWorldGroup × I × camera = arWorldGroup × camera.
   */
  it('arpose starts with identity transform', () => {
    const { arpose } = createSceneHierarchy();

    expect(arpose.position.x).toBe(0);
    expect(arpose.position.y).toBe(0);
    expect(arpose.position.z).toBe(0);
    expect(arpose.quaternion.x).toBe(0);
    expect(arpose.quaternion.y).toBe(0);
    expect(arpose.quaternion.z).toBe(0);
    expect(arpose.quaternion.w).toBe(1);
  });
});

describe('isWebXRSupported', () => {
  /**
   * Why this test matters:
   * When navigator.xr is not available, we should return false
   * rather than throwing an error.
   */
  it('returns false when navigator.xr is undefined', async () => {
    // navigator.xr is undefined in jsdom by default
    const result = await isWebXRSupported();
    expect(result).toBe(false);
  });

  /**
   * Why this test matters:
   * Even when navigator.xr exists, if isSessionSupported throws,
   * we should handle gracefully and return false.
   */
  it('returns false when isSessionSupported throws', async () => {
    const mockXR = {
      isSessionSupported: vi.fn().mockRejectedValue(new Error('Not supported')),
    };
    vi.stubGlobal('navigator', { xr: mockXR });

    const result = await isWebXRSupported();
    expect(result).toBe(false);

    vi.unstubAllGlobals();
  });

  /**
   * Why this test matters:
   * When WebXR reports immersive-ar is supported, we should return true.
   */
  it('returns true when immersive-ar is supported', async () => {
    const mockXR = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal('navigator', { xr: mockXR });

    const result = await isWebXRSupported();
    expect(result).toBe(true);
    expect(mockXR.isSessionSupported).toHaveBeenCalledWith('immersive-ar');

    vi.unstubAllGlobals();
  });
});

describe('module state accessors', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, these accessors should return null
   * rather than throwing errors.
   */
  it('getCurrentArPose returns null before initialization', () => {
    expect(getCurrentArPose()).toBeNull();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, getScene should return null.
   */
  it('getScene returns null before initialization', () => {
    expect(getScene()).toBeNull();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, getArWorldGroup should return null.
   */
  it('getArWorldGroup returns null before initialization', () => {
    expect(getArWorldGroup()).toBeNull();
  });

  /**
   * Why this test matters:
   * Before AR is initialized, getCamera should return null.
   */
  it('getCamera returns null before initialization', () => {
    expect(getCamera()).toBeNull();
  });

  /**
   * Why this test matters: `resetWebXRState()` is the single teardown chokepoint
   * every restart must pass through (initAR throws while a prior session is
   * live). Session-scoped resources that are not per-frame ticks — e.g. the
   * store subscription opened by `enableArWorldGroupAlignment` — register a
   * disposer that this flush must run, or they leak across sessions. This pins
   * the wiring so a future refactor of the teardown can't silently drop it.
   */
  it('resetWebXRState runs (and clears) registered session disposers', () => {
    const dispose = vi.fn();
    registerSessionDisposer(dispose);

    resetWebXRState();
    expect(dispose).toHaveBeenCalledTimes(1);

    // Cleared as it ran: a second teardown must not re-run it.
    resetWebXRState();
    expect(dispose).toHaveBeenCalledTimes(1);

    clearSessionDisposers();
  });

  /**
   * Why this test matters:
   * Before initialization, getArPose should return null so modules
   * that read it know the arpose node is not yet available.
   */
  it('getArPose returns null before initialization', () => {
    expect(getArPose()).toBeNull();
  });

  /**
   * Why this test matters:
   * Replay mode sets the arpose node via setArPose() so that
   * store subscribers can update it with recorded odom data.
   */
  it('setArPose makes getArPose return the provided object', () => {
    const mockArPose = new Group();
    setArPose(mockArPose);
    expect(getArPose()).toBe(mockArPose);
  });

  /**
   * Why this test matters:
   * resetWebXRState must clear the arpose reference alongside scene,
   * arWorldGroup, and camera.
   */
  it('resetWebXRState clears arpose', () => {
    const mockArPose = new Group();
    setArPose(mockArPose);
    resetWebXRState();
    expect(getArPose()).toBeNull();
  });

  /**
   * Why this test matters:
   * Replay mode needs to register its own scene with the module-global
   * getters so that existing visualizers (GpsEventVisualizer,
   * RefPointVisualizer) which call getScene() receive the replay scene.
   * Without setScene(), replay mode cannot make visualizers work.
   * @see docs/2026-02-19-replay-mode.md Risk R1
   */
  it('setScene makes getScene return the provided scene', () => {
    const mockScene = new Scene();
    setScene(mockScene);
    expect(getScene()).toBe(mockScene);
  });

  /**
   * Why this test matters:
   * Replay mode needs to register its own arWorldGroup so that
   * applyAlignmentMatrix() and visualizers that add content to the
   * AR world group work correctly during replay.
   * @see docs/2026-02-19-replay-mode.md Risk R1
   */
  it('setArWorldGroup makes getArWorldGroup return the provided group', () => {
    const mockGroup = new Group();
    setArWorldGroup(mockGroup);
    expect(getArWorldGroup()).toBe(mockGroup);
  });

  /**
   * Why this test matters:
   * Replay mode needs to register its own camera so that getCamera()
   * returns the replay camera for modules that read it.
   * @see docs/2026-02-19-replay-mode.md Risk R1
   */
  it('setCamera makes getCamera return the provided camera', () => {
    const mockCamera = new PerspectiveCamera();
    setCamera(mockCamera);
    expect(getCamera()).toBe(mockCamera);
  });

  /**
   * Why this test matters:
   * resetWebXRState must clear setter-provided values too, not just
   * initAR()-provided values. This ensures no stale replay scene
   * leaks into a subsequent AR session.
   */
  it('resetWebXRState clears values set via setters', () => {
    const mockScene = new Scene();
    const mockGroup = new Group();
    const mockCamera = new PerspectiveCamera();
    setScene(mockScene);
    setArWorldGroup(mockGroup);
    setCamera(mockCamera);

    resetWebXRState();

    expect(getScene()).toBeNull();
    expect(getArWorldGroup()).toBeNull();
    expect(getCamera()).toBeNull();
  });

  /**
   * Why this test matters:
   * setScene(null) must be a valid way to explicitly clear the scene,
   * for cleanup paths that don't use the full resetWebXRState.
   */
  it('setScene accepts null to clear the scene', () => {
    const mockScene = new Scene();
    setScene(mockScene);
    expect(getScene()).toBe(mockScene);

    setScene(null);
    expect(getScene()).toBeNull();
  });
});

describe('applyAlignmentMatrix', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * applyAlignmentMatrix should handle cases where arWorldGroup is not initialized.
   */
  it('does not throw when arWorldGroup is not initialized', () => {
    const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // Should not throw - just logs a warning
    expect(() => applyAlignmentMatrix(identityMatrix)).not.toThrow();
  });

  /**
   * Why this test matters:
   * Invalid matrix length should be rejected.
   */
  it('does not throw with invalid matrix length', () => {
    const shortMatrix = [1, 0, 0, 0];
    expect(() => applyAlignmentMatrix(shortMatrix)).not.toThrow();
  });

  /**
   * Why this test matters:
   * Empty matrix should be handled gracefully.
   */
  it('does not throw with empty matrix', () => {
    expect(() => applyAlignmentMatrix([])).not.toThrow();
  });

  /**
   * Why this test matters:
   * applyAlignmentMatrix now sets arWorldGroup.matrix to the alignment only
   * (no WEBXR_TO_NUE composition). WEBXR_TO_NUE lives permanently in
   * basisChangeNode. This confirms the simplified implementation.
   */
  it('sets arWorldGroup.matrix to alignment only (not composed with WEBXR_TO_NUE)', () => {
    const { arWorldGroup } = createSceneHierarchy();
    setArWorldGroup(arWorldGroup);

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    applyAlignmentMatrix(identity);

    // arWorldGroup.matrix must be exact identity — no WEBXR_TO_NUE folded in
    const el = arWorldGroup.matrix.elements;
    expect(el[0]).toBeCloseTo(1, 10); // diagonal
    expect(el[5]).toBeCloseTo(1, 10);
    expect(el[10]).toBeCloseTo(1, 10);
    expect(el[15]).toBeCloseTo(1, 10);
    expect(el[1]).toBeCloseTo(0, 10); // off-diagonal
    expect(el[2]).toBeCloseTo(0, 10);
    expect(el[4]).toBeCloseTo(0, 10);
    expect(el[8]).toBeCloseTo(0, 10);
  });

  /**
   * Why this test matters:
   * The full chain arWorldGroup × basisChangeNode must still map a WebXR
   * north position (z=-10) to NUE north (x=10). This verifies that moving
   * WEBXR_TO_NUE into the scene graph preserves the correct camera mapping.
   */
  it('full chain (arWorldGroup × basisChangeNode) maps WebXR north to NUE north', () => {
    const { arWorldGroup } = createSceneHierarchy();
    setArWorldGroup(arWorldGroup);

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    applyAlignmentMatrix(identity);

    const basisChangeNode = arWorldGroup.getObjectByName(
      SCENE_NODE.BASIS_CHANGE
    )!;
    const fullChain = new THREE.Matrix4().multiplyMatrices(
      arWorldGroup.matrix,
      basisChangeNode.matrix
    );

    // WebXR: x=0 (no east), y=0 (ground), z=-10 (north = -Z in WebXR)
    const webxrPos = new THREE.Vector4(0, 0, -10, 1);
    const result = webxrPos.applyMatrix4(fullChain);

    // Expected NUE: x=10 (north), y=0, z=0 (no east)
    expect(result.x).toBeCloseTo(10, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(0, 5);
  });

  /**
   * Why this test matters:
   * Walking east in WebXR (x increases) must still produce NUE Z increase
   * (east) through the full chain, confirming end-to-end correctness.
   */
  it('full chain (arWorldGroup × basisChangeNode) maps WebXR east to NUE Z-east', () => {
    const { arWorldGroup } = createSceneHierarchy();
    setArWorldGroup(arWorldGroup);

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    applyAlignmentMatrix(identity);

    const basisChangeNode = arWorldGroup.getObjectByName(
      SCENE_NODE.BASIS_CHANGE
    )!;
    const fullChain = new THREE.Matrix4().multiplyMatrices(
      arWorldGroup.matrix,
      basisChangeNode.matrix
    );

    const webxrPos = new THREE.Vector4(5, 0, 0, 1);
    const result = webxrPos.applyMatrix4(fullChain);

    // WebXR x=5 (east) → NUE z=5 (east)
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(5, 5);
  });
});

describe('nuePositionToWebXR', () => {
  /**
   * Why this test matters:
   * nuePositionToWebXR is the inverse of the WEBXR_TO_NUE transform applied
   * in applyAlignmentMatrix. Replay mode needs this to set arpose in WebXR
   * space so (alignment × W2N) × arpose_WebXR = alignment × odom_NUE.
   */
  it('converts NUE [north, up, east] to WebXR [east, up, -north]', () => {
    const nue = [10, 2, 5]; // north=10, up=2, east=5
    const webxr = nuePositionToWebXR(nue);

    // WebXR: x=east=5, y=up=2, z=south=-north=-10
    expect(webxr[0]).toBe(5);
    expect(webxr[1]).toBe(2);
    expect(webxr[2]).toBe(-10);
  });

  /**
   * Why this test matters:
   * Round-trip: WebXR→NUE (in extractOdomPosition) then NUE→WebXR should
   * recover the original WebXR position.
   */
  it('is the inverse of extractOdomPosition (round-trip)', () => {
    // Simulate extractOdomPosition: WebXR [3, 7, -11] → NUE [11, 7, 3]
    const webxrOriginal = [3, 7, -11];
    const nue = [-(webxrOriginal[2] ?? 0), webxrOriginal[1], webxrOriginal[0]]; // extractOdomPosition logic
    const webxrRecovered = nuePositionToWebXR(nue);

    expect(webxrRecovered[0]).toBeCloseTo(webxrOriginal[0], 10);
    expect(webxrRecovered[1]).toBeCloseTo(webxrOriginal[1], 10);
    expect(webxrRecovered[2]).toBeCloseTo(webxrOriginal[2], 10);
  });

  /**
   * Why this test matters:
   * Verifies that applying the composed arWorldGroup matrix to a round-tripped
   * WebXR position yields the same result as directly applying alignment to NUE.
   */
  it('composes correctly with applyAlignmentMatrix for replay', () => {
    const { arWorldGroup } = createSceneHierarchy();
    setArWorldGroup(arWorldGroup);

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    applyAlignmentMatrix(identity);

    // odomPosition in NUE: north=10, up=0, east=5
    const odomNUE = [10, 0, 5];
    // Convert to WebXR for arpose (arpose lives in WebXR space below basisChangeNode)
    const webxrPos = nuePositionToWebXR(odomNUE);
    // Apply the full chain: arWorldGroup (alignment) × basisChangeNode (WEBXR_TO_NUE)
    const basisChangeNode = arWorldGroup.getObjectByName(
      SCENE_NODE.BASIS_CHANGE
    )!;
    const fullChain = new THREE.Matrix4().multiplyMatrices(
      arWorldGroup.matrix,
      basisChangeNode.matrix
    );
    const v = new THREE.Vector4(webxrPos[0], webxrPos[1], webxrPos[2], 1);
    v.applyMatrix4(fullChain);

    // Should recover NUE position
    expect(v.x).toBeCloseTo(odomNUE[0], 5);
    expect(v.y).toBeCloseTo(odomNUE[1], 5);
    expect(v.z).toBeCloseTo(odomNUE[2], 5);
  });
});

describe('image capture functions', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * setImageCaptureCallback should be callable before AR is initialized
   */
  it('setImageCaptureCallback does not throw before AR init', () => {
    const onCaptured = vi.fn();
    const getRotation = () => 0;

    expect(() =>
      setImageCaptureCallback(onCaptured, getRotation)
    ).not.toThrow();
  });

  /**
   * Why this test matters:
   * startImageCapture should gracefully handle missing renderer
   */
  it('startImageCapture does not throw when renderer not initialized', () => {
    expect(() => startImageCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * startImageCapture should gracefully handle missing callbacks
   */
  it('startImageCapture does not throw when callbacks not set', () => {
    // Just test it doesn't throw
    expect(() => startImageCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * stopImageCapture should be safe to call when not capturing
   */
  it('stopImageCapture does not throw when not capturing', () => {
    expect(() => stopImageCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * Calling startImageCapture() again while a capture session is already
   * running (e.g. toggling capture settings mid-session) must dispose the
   * previous CameraBlitCapture (and its WebGLRenderTarget GPU memory) and
   * stop the previous ImageCaptureManager — otherwise the module-level
   * `blitCapture`/`imageCaptureManager` references are overwritten, leaking
   * GPU memory and leaving two managers competing over the same callbacks
   * plus a dangling safety timeout.
   *
   * initAR() (which sets the private `renderer`) can't run in jsdom, so we
   * assert on the source of startImageCapture that it stops any in-flight
   * session before allocating new resources — matching the source-inspection
   * pattern used for the resetWebXRState/endARSession cleanup tests above.
   */
  it('startImageCapture stops any in-flight capture before starting a new one', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );
    const startBlock = source.slice(
      source.indexOf('function startImageCapture'),
      source.indexOf('function stopImageCapture')
    );
    // The guard must check for an existing session and call stopImageCapture()
    // before the new CameraBlitCapture / ImageCaptureManager are constructed.
    const guardIndex = startBlock.indexOf('stopImageCapture()');
    const blitIndex = startBlock.indexOf('new CameraBlitCapture()');
    const managerIndex = startBlock.indexOf('new ImageCaptureManager(');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(blitIndex).toBeGreaterThan(-1);
    expect(managerIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(blitIndex);
    expect(guardIndex).toBeLessThan(managerIndex);
  });

  /**
   * Why this test matters:
   * getImageCaptureFrameCount should return 0 when not capturing
   */
  it('getImageCaptureFrameCount returns 0 when not capturing', () => {
    expect(getImageCaptureFrameCount()).toBe(0);
  });
});

describe('tracking callbacks', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * setTrackingCallbacks should be callable before AR is initialized
   */
  it('setTrackingCallbacks does not throw before AR init', () => {
    const onRestarted = vi.fn();
    expect(() => setTrackingCallbacks(onRestarted)).not.toThrow();
  });

  /**
   * Why this test matters:
   * Field Test Readiness Issue #3 - setTrackingLostCallback allows
   * the main module to be notified when AR tracking is lost.
   */
  it('setTrackingLostCallback does not throw before AR init', () => {
    const onLost = vi.fn();
    expect(() => setTrackingLostCallback(onLost)).not.toThrow();
  });

  /**
   * Why this test matters:
   * After resetWebXRState, the tracking lost callback should be cleared.
   */
  it('resetWebXRState clears tracking lost callback', () => {
    const onLost = vi.fn();
    setTrackingLostCallback(onLost);
    resetWebXRState();
    // Callback should be cleared - we can verify by setting a new one
    expect(() => setTrackingLostCallback(vi.fn())).not.toThrow();
  });

  /**
   * Why this test matters:
   * setTrackingRecoveredCallback allows the app to be notified when
   * tracking recovers seamlessly (Case 1: same coordinate frame),
   * e.g. to clear the "⚠️ LOST" UI warning.
   */
  it('setTrackingRecoveredCallback does not throw before AR init', () => {
    const onRecovered = vi.fn();
    expect(() => setTrackingRecoveredCallback(onRecovered)).not.toThrow();
  });

  /**
   * Why this test matters:
   * After resetWebXRState, the tracking recovered callback should be cleared.
   */
  it('resetWebXRState clears tracking recovered callback', () => {
    setTrackingRecoveredCallback(vi.fn());
    resetWebXRState();
    expect(() => setTrackingRecoveredCallback(vi.fn())).not.toThrow();
  });
});

describe('depth capture functions', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * setDepthCaptureCallback should be callable before AR is initialized
   */
  it('setDepthCaptureCallback does not throw before AR init', () => {
    const onCaptured = vi.fn();
    expect(() => setDepthCaptureCallback(onCaptured)).not.toThrow();
  });

  /**
   * Why this test matters:
   * startDepthCapture should gracefully handle missing sampler
   */
  it('startDepthCapture does not throw when sampler not initialized', () => {
    expect(() => startDepthCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * stopDepthCapture should be safe to call when not sampling
   */
  it('stopDepthCapture does not throw when not sampling', () => {
    expect(() => stopDepthCapture()).not.toThrow();
  });

  /**
   * Why this test matters:
   * getDepthSampleCount should return 0 when not sampling
   */
  it('getDepthSampleCount returns 0 when not sampling', () => {
    expect(getDepthSampleCount()).toBe(0);
  });
});

describe('frame callback', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * setFrameCallback should be callable before AR is initialized.
   * This allows consumers to register callbacks during setup.
   */
  it('setFrameCallback does not throw before AR init', () => {
    const callback = vi.fn();
    expect(() => setFrameCallback(callback)).not.toThrow();
  });

  /**
   * Why this test matters:
   * Setting callback to null should be safe and not throw.
   * This is used to clear callbacks when no longer needed.
   */
  it('setFrameCallback accepts null to clear callback', () => {
    const callback = vi.fn();
    setFrameCallback(callback);
    expect(() => setFrameCallback(null)).not.toThrow();
  });

  /**
   * Why this test matters:
   * resetWebXRState should clear the frame callback to prevent
   * stale callbacks from being invoked after state reset.
   */
  it('resetWebXRState clears the frame callback', () => {
    const callback = vi.fn();
    setFrameCallback(callback);
    resetWebXRState();
    // After reset, setting a new callback should work (proves old was cleared)
    const newCallback = vi.fn();
    expect(() => setFrameCallback(newCallback)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CSS3D renderer manager getter (Approach E)
// ---------------------------------------------------------------------------

describe('getLiveCss3dManager', () => {
  beforeEach(() => {
    resetWebXRState();
  });

  /**
   * Why this test matters:
   * Before initAR() is called, the CSS3D manager should be null.
   * initAR() requires WebXR and can't run in jsdom, so we verify
   * the getter returns null in the default state.
   */
  it('returns null before AR initialization', () => {
    expect(getLiveCss3dManager()).toBeNull();
  });

  /**
   * Why this test matters:
   * resetWebXRState must dispose and null out the CSS3D manager
   * to prevent memory leaks and stale DOM overlays between sessions.
   */
  it('resetWebXRState clears the CSS3D manager', () => {
    // Manager starts as null; reset should keep it null and not throw
    resetWebXRState();
    expect(getLiveCss3dManager()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractResetTransformData — distinguishes missing vs null vs present
// ---------------------------------------------------------------------------

describe('extractResetTransformData', () => {
  /**
   * Why this test matters:
   * When the XRReferenceSpaceEvent.transform property is present and contains
   * valid position/orientation data, the function must extract and return it
   * as a ResetTransformData object.
   */
  it('returns extracted data when transform is present with valid data', () => {
    const event = {
      transform: {
        position: { x: 0.5, y: 0, z: -0.3 },
        orientation: { x: 0, y: 0.1, z: 0, w: 0.995 },
      },
    };

    const result = extractResetTransformData(event);

    expect(result).toEqual({
      position: [0.5, 0, -0.3],
      orientation: [0, 0.1, 0, 0.995],
    });
  });

  /**
   * Why this test matters:
   * When the transform property exists but is null, the runtime could not
   * determine the delta between old and new coordinate systems. This must
   * return null (not undefined) to match OdometryTrackingRestartedPayload
   * semantics: null = "runtime explicitly could not determine the delta".
   */
  it('returns null when transform property exists but is null', () => {
    const event = { transform: null };

    const result = extractResetTransformData(event);

    expect(result).toBeNull();
  });

  /**
   * Why this test matters:
   * When the transform property does not exist on the event (older browsers),
   * the function must return undefined to match OdometryTrackingRestartedPayload
   * semantics: undefined = "the reset event did not provide a transform".
   * This is the key distinction the junior dev's comment identified.
   */
  it('returns undefined when transform property is missing (older browsers)', () => {
    const event = {};

    const result = extractResetTransformData(event);

    expect(result).toBeUndefined();
  });

  /**
   * Why this test matters:
   * Ensures null and undefined cases are not conflated. Both falsy, but
   * carry different diagnostic meaning in OdometryTrackingRestartedPayload.
   */
  it('distinguishes null transform from missing transform', () => {
    const nullTransformResult = extractResetTransformData({ transform: null });
    const missingTransformResult = extractResetTransformData({});

    expect(nullTransformResult).toBeNull();
    expect(missingTransformResult).toBeUndefined();
    expect(nullTransformResult).not.toBe(missingTransformResult);
  });
});

// ---------------------------------------------------------------------------
// DOM hardcoding audit — regression tests
// ---------------------------------------------------------------------------

describe('DOM hardcoding audit regressions', () => {
  /**
   * Why this test matters:
   * The renderer canvas must not have a hardcoded ID like 'ar-canvas'.
   * Hardcoded IDs are leaky abstractions: HTML IDs must be unique, and
   * multiple framework instances or host-app collisions would break.
   * The caller owns the container and can set attributes if needed.
   * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 1.
   */
  it('initAR does not assign a hardcoded id to the renderer canvas', async () => {
    // We cannot call initAR in jsdom (no WebXR), so we verify that the
    // source code no longer contains the hardcoded ID assignment.
    // This is a "grep-style" regression guard.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sourcePath = resolve(process.cwd(), 'src/ar/webxr-session.ts');
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toContain("domElement.id = 'ar-canvas'");
    expect(source).not.toContain('domElement.id = "ar-canvas"');
  });

  /**
   * Why this test matters:
   * resetWebXRState must stop the animation loop, remove the canvas from
   * the DOM, and dispose the renderer to avoid orphaned <canvas> elements
   * and leaked WebGL contexts (matching disposeReplayScene pattern).
   * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 11 (P2).
   */
  it('resetWebXRState disposes renderer and removes canvas from DOM', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );
    // The resetWebXRState function must call setAnimationLoop(null),
    // renderer.dispose(), and remove the domElement before nulling.
    const resetBlock = source.slice(
      source.indexOf('function resetWebXRState'),
      source.indexOf('renderer = null;')
    );
    expect(resetBlock).toContain('setAnimationLoop(null)');
    expect(resetBlock).toContain('renderer.dispose()');
    expect(resetBlock).toContain('removeChild(renderer.domElement)');
  });

  /**
   * Why this test matters:
   * endARSession is the production teardown path. It must perform the same
   * thorough cleanup as resetWebXRState() — ending the XR session AND
   * clearing every module-level reference — so no state leaks into the
   * next session. Asserting it delegates to resetWebXRState() (rather than
   * re-implementing a subset of the teardown inline) guards against the
   * leak class where new module state is added to resetWebXRState() but
   * forgotten in endARSession().
   * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 11 (P2).
   */
  it('endARSession ends the XR session and delegates teardown to resetWebXRState', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );
    const endBlock = source.slice(
      source.indexOf('function endARSession'),
      source.indexOf('function setImageCaptureCallback')
    );
    // Must still end the actual XR session — resetWebXRState() only nulls
    // the reference, it never calls XRSession.end().
    expect(endBlock).toContain('xrSession.end()');
    // Must reuse the comprehensive synchronous teardown rather than
    // re-implementing a subset of it.
    expect(endBlock).toContain('resetWebXRState()');
  });

  /**
   * Why this test matters:
   * This is the behavioural proof of the leak the delegation fixes. Before
   * delegating to resetWebXRState(), endARSession() left the scene-graph
   * references (scene, camera, arWorldGroup, arPose) dangling, so a fresh
   * session could observe stale objects via getScene()/getCamera()/etc.
   * We seed those references through the public setters (the same surface
   * replay mode uses) because initAR() cannot run under jsdom.
   */
  it('endARSession clears scene-graph references so they do not leak into the next session', async () => {
    resetWebXRState();
    setScene(new Scene());
    setCamera(new PerspectiveCamera());
    setArWorldGroup(new Group());
    setArPose(new THREE.Object3D());

    await endARSession();

    expect(getScene()).toBeNull();
    expect(getCamera()).toBeNull();
    expect(getArWorldGroup()).toBeNull();
    expect(getArPose()).toBeNull();
  });

  /**
   * Why this test matters:
   * endARSession must not throw when called before initAR.
   * This is a defensive check for the production cleanup path.
   */
  it('endARSession does not throw when not initialized', async () => {
    resetWebXRState();
    await expect(endARSession()).resolves.toBeUndefined();
  });

  it('initAR only creates CSS3D renderer when enableCss3dRenderer is true', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );

    expect(source).toContain(
      'if (currentArCrashIsolationOptions.enableCss3dRenderer)'
    );
    expect(source).toContain('createCss3dRendererManager');
  });

  it('onXRFrame gates camera texture acquisition and CSS3D render on the isolation flags', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/ar/webxr-session.ts'),
      'utf-8'
    );

    expect(source).toContain(
      'if (currentArCrashIsolationOptions.enableCameraTextureAcquisition)'
    );
    expect(source).toContain(
      'if (currentArCrashIsolationOptions.enableCss3dRenderer && css3dManager)'
    );
  });
});
