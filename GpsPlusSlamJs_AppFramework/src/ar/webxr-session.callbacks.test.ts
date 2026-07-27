/**
 * initAR `callbacks` contract tests (surface-reduction step 1, 2026-07-11).
 *
 * Why these tests matter:
 * The 13 pre-init setter exports were folded into a single `ArSessionCallbacks`
 * struct passed to initAR. These tests pin the new contract:
 *  - the `tracking` group arrives as store + callbacks TOGETHER: initAR resets
 *    the slice and wires the phase→callback translation in one step (the old
 *    half-wired setTrackingStore/setTrackingCallbacks split is impossible),
 *  - phase transitions on the injected store fire the host's
 *    onLost / onRestarted / onRecovered callbacks,
 *  - `rebindTrackingStore` (the ONE runtime mutation that survived the fold,
 *    for the recorder's per-recording store swap) detaches the previous
 *    store's phase subscription — exactly the old setter's semantics.
 *
 * This file is isolated from webxr-session.test.ts because it mocks
 * THREE.WebGLRenderer and navigator.xr (same pattern as
 * webxr-session.init-guard.test.ts / webxr-session.session-end.test.ts).
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
  resetWebXRState,
  rebindTrackingStore,
  type TrackingSubscribableStore,
} from './webxr-session.js';
import {
  resetTracking,
  type TrackingPhase,
  type TrackingSliceState,
} from '../state/tracking-slice.js';
import type { OdometryTrackingRestartedPayload } from 'gps-plus-slam-js';

const MINIMAL_ISOLATION = {
  enableDomOverlay: false,
  enableCameraAccess: false,
  enableDepthSensingFeature: false,
  enableCss3dRenderer: false,
  enableCameraTextureAcquisition: false,
  applyChromiumProjectionLayerWorkaround: false,
};

/**
 * Minimal hand-rolled store satisfying {@link TrackingSubscribableStore}:
 * records dispatches, lets the test flip the tracking phase and notify
 * subscribers synchronously (like a real Redux store would).
 */
function createFakeTrackingStore() {
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const listeners = new Set<() => void>();
  let phase: TrackingPhase = 'initializing';
  let lastRestartedPayload: OdometryTrackingRestartedPayload | null = null;

  const store: TrackingSubscribableStore = {
    dispatch: (action) => {
      dispatched.push(action);
      return action;
    },
    getState: () => ({
      tracking: { phase, lastRestartedPayload } as TrackingSliceState,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    store,
    dispatched,
    listeners,
    setPhase(
      next: TrackingPhase,
      payload: OdometryTrackingRestartedPayload | null = null
    ): void {
      phase = next;
      lastRestartedPayload = payload;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('initAR callbacks.tracking wiring', () => {
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

  it('resets the tracking slice and subscribes to the injected store at init', async () => {
    const fake = createFakeTrackingStore();

    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      {
        tracking: { store: fake.store },
      }
    );

    // Clean-slate dispatch so the previous session's phase cannot leak.
    expect(fake.dispatched).toContainEqual(resetTracking());
    // Phase subscription established (store + callbacks arrive together —
    // there is no half-wired state to warn about any more).
    expect(fake.listeners.size).toBe(1);
  });

  it('translates phase transitions into the host onLost/onRestarted/onRecovered callbacks', async () => {
    const fake = createFakeTrackingStore();
    const onLost = vi.fn();
    const onRecovered = vi.fn();
    const onRestarted = vi.fn();

    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      {
        tracking: { store: fake.store, onLost, onRecovered, onRestarted },
      }
    );

    // initializing → tracking: initial acquisition, no callback.
    fake.setPhase('tracking');
    // tracking → lost
    fake.setPhase('lost');
    expect(onLost).toHaveBeenCalledTimes(1);
    // lost → tracking with a restart payload (Case 2)
    const payload = {
      odomOffset: [0, 0, 0],
    } as unknown as OdometryTrackingRestartedPayload;
    fake.setPhase('tracking', payload);
    expect(onRestarted).toHaveBeenCalledWith(payload);
    // tracking → lost → tracking with NO payload (Case 1: seamless recovery)
    fake.setPhase('lost');
    fake.setPhase('tracking');
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it('rebindTrackingStore detaches the previous store phase subscription (mid-session store swap)', async () => {
    const first = createFakeTrackingStore();

    await initAR(
      container,
      MINIMAL_ISOLATION,
      {},
      {
        tracking: { store: first.store },
      }
    );
    expect(first.listeners.size).toBe(1);

    const second = createFakeTrackingStore();
    rebindTrackingStore(second.store);

    // The old subscription is torn down; the new subscription is only
    // (re)established by the next initAR — old setTrackingStore semantics.
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(0);
  });

  it('does not touch tracking when the group is absent', async () => {
    const fake = createFakeTrackingStore();

    await initAR(container, MINIMAL_ISOLATION);

    expect(fake.dispatched).toHaveLength(0);
    expect(fake.listeners.size).toBe(0);
  });
});
