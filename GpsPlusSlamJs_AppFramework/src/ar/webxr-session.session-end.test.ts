/**
 * Session-end hook tests (F3, 2026-07-04 user feedback).
 *
 * Why these tests matter:
 * On Android Chrome the system back gesture ends an immersive XRSession
 * directly — no popstate, no beforeunload, not cancelable. Before F3 the
 * framework's 'end' listener only nulled xrSession/latestArPose, leaving the
 * renderer compositing the 3D scene over a black camera background (the
 * "haunted scene"), and the host app was never notified. These tests pin the
 * fixed contract:
 *  - BOTH end paths (system gesture and app-initiated endARSession()) run the
 *    full resetWebXRState() teardown,
 *  - the host callback registered via setSessionEndCallback() fires exactly
 *    once per session end with the correct `requestedByApp` discriminator
 *    (endARSession()'s own session.end() fires the same 'end' event — the
 *    module must not double-fire),
 *  - a throwing callback never breaks the teardown.
 * See docs/2026-07-04-ar-clipping-planes-and-lifecycle-plan.md (F3) and
 * docs/2026-02-15-lifecycle-orphans.md §1.
 *
 * This file is isolated from webxr-session.test.ts because it mocks
 * THREE.WebGLRenderer and navigator.xr (same pattern as
 * webxr-session.init-guard.test.ts).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as THREE from 'three';

// Mock only WebGLRenderer (jsdom has no WebGL context). Spreading `...actual`
// keeps every other THREE export real.
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

import {
  initAR,
  endARSession,
  resetWebXRState,
  setSessionEndCallback,
  getScene,
  type SessionEndInfo,
} from './webxr-session.js';

const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

describe('session-end hook (F3)', () => {
  let container: HTMLDivElement;
  /** The 'end' listener initAR registered on the mock session. */
  let capturedEndListener: (() => void) | null;

  beforeEach(() => {
    resetWebXRState();
    container = document.createElement('div');
    document.body.appendChild(container);
    capturedEndListener = null;

    const mockSession = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'end') {
          capturedEndListener = listener;
        }
      }),
      // Mirror real browser behaviour: ending the session fires the 'end'
      // event (this is why app-initiated endARSession() must not double-fire
      // the host callback).
      end: vi.fn().mockImplementation(() => {
        capturedEndListener?.();
        return Promise.resolve();
      }),
    };
    vi.stubGlobal('navigator', {
      xr: {
        requestSession: vi.fn().mockResolvedValue(mockSession),
      },
    });
  });

  afterEach(() => {
    setSessionEndCallback(null);
    resetWebXRState();
    vi.unstubAllGlobals();
    container.remove();
  });

  it('system-initiated end runs full teardown and fires the callback with requestedByApp=false', async () => {
    const events: SessionEndInfo[] = [];
    setSessionEndCallback((info) => events.push(info));

    await initAR(container, MINIMAL_ISOLATION);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);

    // Simulate the Android back gesture: the browser ends the session and
    // fires 'end' — the app never called endARSession().
    capturedEndListener?.();

    expect(events).toEqual([{ requestedByApp: false }]);
    // Full teardown, not the old minimal cleanup: scene refs cleared AND the
    // canvas removed (before F3 the canvas kept rendering the haunted scene).
    expect(getScene()).toBeNull();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('app-initiated endARSession() fires the callback exactly once with requestedByApp=true', async () => {
    const events: SessionEndInfo[] = [];
    setSessionEndCallback((info) => events.push(info));

    await initAR(container, MINIMAL_ISOLATION);
    await endARSession();

    // The mock end() fired the 'end' event (like a real browser) and
    // endARSession() also runs its own finally-teardown — the callback must
    // still fire exactly once.
    expect(events).toEqual([{ requestedByApp: true }]);
    expect(getScene()).toBeNull();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('a throwing callback does not break the teardown', async () => {
    setSessionEndCallback(() => {
      throw new Error('host callback exploded');
    });

    await initAR(container, MINIMAL_ISOLATION);

    expect(() => capturedEndListener?.()).not.toThrow();
    expect(getScene()).toBeNull();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('does not fire the callback again for a later session it was cleared for', async () => {
    // resetWebXRState() clears the callback (like every other module-level
    // callback) so a stale host handler can never fire for a session it was
    // not registered for.
    const events: SessionEndInfo[] = [];
    setSessionEndCallback((info) => events.push(info));

    await initAR(container, MINIMAL_ISOLATION);
    capturedEndListener?.(); // system end — fires + tears down + clears
    expect(events).toHaveLength(1);

    await initAR(container, MINIMAL_ISOLATION); // host did NOT re-register
    capturedEndListener?.();

    expect(events).toHaveLength(1);
  });

  it('requestedByApp does not stay latched after an app-initiated end', async () => {
    // A failed/aborted endARSession() must not make a LATER system-initiated
    // end masquerade as app-initiated.
    const events: SessionEndInfo[] = [];

    await initAR(container, MINIMAL_ISOLATION);
    await endARSession(); // no callback registered yet — nothing fires

    setSessionEndCallback((info) => events.push(info));
    await initAR(container, MINIMAL_ISOLATION);
    capturedEndListener?.(); // system end of the SECOND session

    expect(events).toEqual([{ requestedByApp: false }]);
  });
});
