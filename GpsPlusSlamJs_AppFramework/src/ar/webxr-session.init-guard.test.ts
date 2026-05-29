/**
 * Re-entry guard tests for initAR().
 *
 * Why these tests matter:
 * initAR() creates a THREE.WebGLRenderer and inserts its canvas into the
 * host container, then overwrites the module-level renderer/scene/camera
 * references. Without a guard, a second call while a session is still
 * active would orphan the previous renderer's canvas in the DOM and leak
 * its GPU resources while silently clobbering the live references. These
 * tests prove the guard throws on re-entry and leaves the first session's
 * state intact.
 *
 * This file is isolated from webxr-session.test.ts because it mocks
 * THREE.WebGLRenderer and navigator.xr — the rest of the suite relies on
 * the real THREE classes and an absent navigator.xr.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

// Mock only WebGLRenderer (jsdom has no WebGL context). Spreading `...actual`
// keeps every other THREE export real so the scene hierarchy built by
// createSceneHierarchy() behaves normally.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();

  class MockWebGLRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    setAnimationLoop = vi.fn();
    xr = {
      enabled: false,
      setSession: vi.fn().mockResolvedValue(undefined),
      getReferenceSpace: vi.fn().mockReturnValue(null),
    };
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

import { initAR, resetWebXRState, getScene } from './webxr-session.js';

// Isolation options that avoid the CSS3D renderer / DOM overlay paths so the
// guard test exercises the minimal renderer+session setup.
const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

describe('initAR re-entry guard', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetWebXRState();
    container = document.createElement('div');
    document.body.appendChild(container);

    const mockSession = {
      addEventListener: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
    });
  });

  afterEach(() => {
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
  });

  /**
   * Why this test matters: a second initAR() while the first session is
   * still active must be rejected rather than silently leaking the previous
   * renderer/canvas.
   */
  it('throws when called again before endARSession()', async () => {
    await initAR(container, MINIMAL_ISOLATION);

    await expect(initAR(container, MINIMAL_ISOLATION)).rejects.toThrow(
      /already initialized/i
    );
  });

  /**
   * Why this test matters: the guard must fire before any new renderer is
   * constructed, so the host container keeps exactly one canvas and the
   * first session's scene reference is untouched.
   */
  it('does not orphan a canvas or overwrite module state on re-entry', async () => {
    await initAR(container, MINIMAL_ISOLATION);
    const sceneAfterFirst = getScene();
    expect(container.querySelectorAll('canvas')).toHaveLength(1);

    await expect(initAR(container, MINIMAL_ISOLATION)).rejects.toThrow();

    // No second canvas was inserted and the live scene is unchanged.
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(getScene()).toBe(sceneAfterFirst);
  });

  /**
   * Why this test matters: after a clean teardown the guard must release,
   * allowing a fresh session to start (the legacy
   * resetWebXRState()-then-initAR() cycle).
   */
  it('allows a new session after resetWebXRState()', async () => {
    await initAR(container, MINIMAL_ISOLATION);
    resetWebXRState();

    await expect(
      initAR(container, MINIMAL_ISOLATION)
    ).resolves.toBeUndefined();
  });
});
