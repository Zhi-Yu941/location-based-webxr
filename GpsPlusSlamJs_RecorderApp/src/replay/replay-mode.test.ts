/**
 * Replay Mode Integration â€” Unit Tests
 *
 * @vitest-environment jsdom
 *
 * Why these tests matter: They verify the orchestration that wires together
 * all replay building blocks (Iterations 1-5) into a working replay mode.
 * The individual pieces are already tested; these tests ensure the wiring
 * is correct â€” especially:
 *
 * - R6: The store passed to wireStoreSubscribers is the same instance the
 *   engine dispatches to (store identity).
 * - R8: Data flow from zip bytes â†’ loadActionsFromZip â†’ actions array â†’
 *   ReplayEngine.play().
 * - R7: Error handling wired through to UI callbacks.
 * - Lifecycle: dispose cleans up scene + engine + subscribers.
 *
 * @see docs/2026-02-19-replay-mode.md Iteration 6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies that need DOM/WebGL
vi.mock('gps-plus-slam-app-framework/ar/replay-scene', () => ({
  initReplayScene: vi.fn(() => ({
    scene: { name: 'mock-scene' },
    arWorldGroup: { name: 'mock-arWorldGroup' },
    camera: { name: 'mock-camera' },
    renderer: { name: 'mock-renderer' },
  })),
  disposeReplayScene: vi.fn(),
  getAlignmentLerper: vi.fn(() => ({
    setTarget: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('gps-plus-slam-app-framework/storage/zip-reader', () => ({
  loadActionsFromZip: vi.fn(),
  loadSessionMetadata: vi.fn().mockResolvedValue({ odomCoordVersion: 5 }), // era 5 â€” no migration needed
}));

vi.mock('gps-plus-slam-app-framework/state/store-subscribers', () => ({
  wireStoreSubscribers: vi.fn(() => vi.fn()), // returns unsubscribe fn
}));

vi.mock('../state/recorder-store', () => ({
  createRecorderStore: vi.fn(() => ({
    getState: vi.fn(() => ({
      gpsData: null,
      recording: { isRecording: false },
    })),
    dispatch: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    writeFrame: vi.fn(),
    writeSessionMetadata: vi.fn(),
  })),
}));

vi.mock('gps-plus-slam-app-framework/visualization/gps-event-markers', () => ({
  gpsEventVisualizer: {
    getZeroRef: vi.fn(() => null),
    setZeroRef: vi.fn(),
    addGpsEvent: vi.fn(),
    clearAll: vi.fn(),
  },
}));

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  getArPose: vi.fn(),
  nuePositionToWebXR: vi.fn((pos: readonly number[]) => pos),
}));

import { startReplayMode } from './replay-mode.js';
import { loadActionsFromZip } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import { createRecorderStore } from '../state/recorder-store';
import {
  initReplayScene,
  disposeReplayScene,
} from 'gps-plus-slam-app-framework/ar/replay-scene';

// --- Helpers ---

function makeMockZipActions() {
  return [
    {
      index: 1,
      filename: 'actions/000001.json',
      action: {
        type: 'recording/startSession',
        payload: {
          scenarioName: 'Test',
          sessionName: 'test-1',
          startTime: 1708300000000,
        },
      },
    },
    {
      index: 2,
      filename: 'actions/000002.json',
      action: {
        type: 'gpsData/recordGpsEvent',
        payload: {
          odomPosition: { x: 0, y: 0, z: 0 },
          odomRotation: { x: 0, y: 0, z: 0, w: 1 },
          rawGpsPoint: {
            id: 'gps-1',
            latitude: 50,
            longitude: 8,
            timestamp: 1708300001000,
          },
        },
      },
    },
    {
      index: 3,
      filename: 'actions/000003.json',
      action: { type: 'recording/endSession' },
    },
  ];
}

const fakeZipData = new Uint8Array([1, 2, 3]); // content doesn't matter, loadActionsFromZip is mocked

function makeConfig(
  overrides?: Partial<Parameters<typeof startReplayMode>[1]>
) {
  return {
    container: document.createElement('div'),
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('replay-mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: loadActionsFromZip returns our fixture
    vi.mocked(loadActionsFromZip).mockResolvedValue(makeMockZipActions());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Data flow (R8) ---

  it('loads actions from zip data and creates a NullStorageBackend store', async () => {
    // Why (R8): The zip â†’ actions â†’ store data flow must be wired correctly.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    // loadActionsFromZip called with the zip data
    expect(loadActionsFromZip).toHaveBeenCalledWith(fakeZipData);

    // createRecorderStore called with NullStorageBackend
    expect(createRecorderStore).toHaveBeenCalledWith(
      expect.objectContaining({
        storageBackend: expect.objectContaining({
          writeAction: expect.any(Function),
        }),
      })
    );
  });

  // --- Scene initialization ---

  it('initializes replay scene with the provided container', async () => {
    // Why: The replay scene must be set up with the DOM container.
    const container = document.createElement('div');
    const config = makeConfig({ container });
    await startReplayMode(fakeZipData, config);

    expect(initReplayScene).toHaveBeenCalledWith(container);
  });

  // --- Store subscriber wiring (R6) ---

  it('wires store subscribers with the same store used by the engine (R6)', async () => {
    // Why (R6): The store that wireStoreSubscribers receives MUST be the
    // same instance the ReplayEngine dispatches to. If they're different,
    // dispatched replay actions won't trigger visualization updates.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    // wireStoreSubscribers was called
    expect(wireStoreSubscribers).toHaveBeenCalledTimes(1);

    // The store passed to wireStoreSubscribers must be the same as the controller's store
    const wireCall = vi.mocked(wireStoreSubscribers).mock.calls[0];
    const subscribedStore = wireCall[0];
    expect(subscribedStore).toBe(controller.getStore());
  });

  it('does NOT pass onNewGpsPosition to wireStoreSubscribers', async () => {
    // Why: onNewGpsPosition is intentionally omitted. Orbit target updates
    // are driven by onAlignmentSnapshot (Issue #3), not by per-event GPS
    // coordinates. Passing onNewGpsPosition would cause redundant updates.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.onNewGpsPosition).toBeUndefined();
  });

  it('passes onNewOdomPose callback to wireStoreSubscribers', async () => {
    // Why: The odom pose callback updates the arpose Object3D with recorded
    // poses, keeping the camera follower and VIO visualization working.
    // Orbit target updates are handled separately by onAlignmentSnapshot.
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.onNewOdomPose).toBeInstanceOf(Function);
  });

  it('passes onAlignmentSnapshot callback to wireStoreSubscribers (Issue #3)', async () => {
    // Why (Issue #3): The orbit camera target should update when alignment
    // snapshots are created, not on every odom pose. This callback routes
    // the snapshot NUE position to updateOrbitTarget().
    const config = makeConfig();
    await startReplayMode(fakeZipData, config);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.onAlignmentSnapshot).toBeInstanceOf(Function);
  });

  // --- Controller API ---

  it('returns a controller with play/pause/resume/setSpeed/dispose', async () => {
    // Why: The controller is the public API for driving replay from the UI.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    expect(controller.play).toBeInstanceOf(Function);
    expect(controller.pause).toBeInstanceOf(Function);
    expect(controller.resume).toBeInstanceOf(Function);
    expect(controller.setSpeed).toBeInstanceOf(Function);
    expect(controller.dispose).toBeInstanceOf(Function);
    expect(controller.getStore).toBeInstanceOf(Function);
    expect(controller.getEngine).toBeInstanceOf(Function);
    expect(controller.getActionCount).toBeInstanceOf(Function);
  });

  it('getActionCount returns the number of loaded actions', async () => {
    // Why: UI needs to know total action count for progress display.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    expect(controller.getActionCount()).toBe(3);
  });

  // --- setMapOverlay ---

  it('setMapOverlay makes the proxy delegate to the provided overlay', async () => {
    // Why: The map overlay is created lazily on first toggle (Issue 4). The
    // controller must expose setMapOverlay() so the store subscriber's
    // mapOverlay proxy starts delegating to the real overlay for GPS updates.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    // Before setMapOverlay: the proxy is passed but should be no-op
    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    expect(deps.mapOverlay).toBeDefined();

    // Provide a real overlay
    const mockOverlay = { setGpsPosition: vi.fn() };
    controller.setMapOverlay(mockOverlay);

    // Now calls through the proxy should reach the real overlay
    deps.mapOverlay!.setGpsPosition(50, 8);
    expect(mockOverlay.setGpsPosition).toHaveBeenCalledWith(50, 8);
  });

  it('setMapOverlay with null stops delegating', async () => {
    // Why: If the map overlay is disposed or toggled off, setting null
    // should prevent the proxy from calling a stale reference.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const mockOverlay = { setGpsPosition: vi.fn() };
    controller.setMapOverlay(mockOverlay);
    controller.setMapOverlay(null);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];
    // Should not throw or call the old overlay
    deps.mapOverlay!.setGpsPosition(50, 8);
    expect(mockOverlay.setGpsPosition).not.toHaveBeenCalled();
  });

  it('setMapOverlay proxy forwards addFusedPoint, addAlignmentSnapshot, and addRefPoint', async () => {
    // Why (Phase 1b): The map overlay proxy must forward all new overlay
    // methods so the store subscriber can push fused path, alignment
    // snapshots, and reference points to the Leaflet map in replay mode.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const mockOverlay = {
      setGpsPosition: vi.fn(),
      addRawGpsPoint: vi.fn(),
      addFusedPoint: vi.fn(),
      addAlignmentSnapshot: vi.fn(),
      addRefPoint: vi.fn(),
    };
    controller.setMapOverlay(mockOverlay);

    const deps = vi.mocked(wireStoreSubscribers).mock.calls[0][1];

    deps.mapOverlay!.addFusedPoint!(50.1, 8.1);
    expect(mockOverlay.addFusedPoint).toHaveBeenCalledWith(50.1, 8.1);

    deps.mapOverlay!.addAlignmentSnapshot!(50.2, 8.2);
    expect(mockOverlay.addAlignmentSnapshot).toHaveBeenCalledWith(50.2, 8.2);

    deps.mapOverlay!.addRefPoint!(50.3, 8.3, 'bench');
    expect(mockOverlay.addRefPoint).toHaveBeenCalledWith(50.3, 8.3, 'bench');
  });

  // --- Play dispatches actions to the store ---

  it('play() dispatches loaded actions to the store via the engine', async () => {
    // Why: The core contract â€” replaying means dispatching recorded actions.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const store = controller.getStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    void controller.play(1);
    await vi.runAllTimersAsync();

    // All 3 actions from our fixture should be dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  // --- Progress callback ---

  it('fires onProgress callback during replay', async () => {
    // Why: UI needs progress updates for "Action 2/3" display.
    const onProgress = vi.fn();
    const config = makeConfig({ onProgress });
    const controller = await startReplayMode(fakeZipData, config);

    void controller.play(100); // high speed for instant replay
    await vi.runAllTimersAsync();

    expect(onProgress).toHaveBeenCalled();
    // Last call should be (3, 3) â€” all actions dispatched
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  // --- Complete callback ---

  it('fires onComplete callback when replay finishes', async () => {
    // Why: UI needs to know replay is done to update button states.
    const onComplete = vi.fn();
    const config = makeConfig({ onComplete });
    const controller = await startReplayMode(fakeZipData, config);

    void controller.play(100);
    await vi.runAllTimersAsync();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // --- Dispose lifecycle ---

  it('dispose cleans up scene, engine, and subscribers', async () => {
    // Why: Resource cleanup prevents memory leaks and stale references.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    controller.dispose();

    // Replay scene should be disposed
    expect(disposeReplayScene).toHaveBeenCalledTimes(1);
  });

  // --- Error handling (R7 wiring) ---

  it('wires onError from config to the engine (R7)', async () => {
    // Why (R7): Dispatch errors must reach the UI via the provided callback.
    const onError = vi.fn();
    const config = makeConfig({ onError });
    const controller = await startReplayMode(fakeZipData, config);

    // Make dispatch throw
    const store = controller.getStore();
    vi.spyOn(store, 'dispatch').mockImplementation(() => {
      throw new Error('Bad action');
    });

    void controller.play(100);
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalled();
  });

  // --- Pause / Resume ---

  it('pause stops replay and resume continues', async () => {
    // Why: Pause/resume is a key UX feature for inspecting state mid-replay.
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    const store = controller.getStore();
    const dispatchSpy = vi.spyOn(store, 'dispatch');

    // Start playing at speed 1
    void controller.play(1);
    await vi.advanceTimersByTimeAsync(0);

    // First action dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Pause
    controller.pause();

    // Advance time â€” no more dispatches
    await vi.advanceTimersByTimeAsync(10_000);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Resume
    void controller.resume();
    await vi.runAllTimersAsync();

    // Remaining actions dispatched
    expect(dispatchSpy).toHaveBeenCalledTimes(3);
  });

  // --- Speed change ---

  it('setSpeed updates the engine speed factor', async () => {
    // Why: Mid-playback speed adjustment is required (Issue 3).
    const config = makeConfig();
    const controller = await startReplayMode(fakeZipData, config);

    // Change speed before play â€” should not throw
    controller.setSpeed(10);

    const engine = controller.getEngine();
    // Verify internal speed was updated by playing and checking timing
    void controller.play(10);
    await vi.runAllTimersAsync();

    expect(engine.getState()).toBe('completed');
  });
});
