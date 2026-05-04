/**
 * Replay Mode Orchestrator
 *
 * Wires together all replay building blocks from Iterations 1-5 into
 * a single entry point. Creates the store, scene, subscribers, and
 * engine, then returns a controller for UI integration.
 *
 * Key risks addressed:
 * - R6: Store identity â€” the same store is passed to wireStoreSubscribers
 *   and the ReplayEngine so dispatched actions trigger visualization updates.
 * - R7: Error handling â€” onError callback is wired from config to the engine.
 * - R8: Data flow â€” zip bytes â†’ loadActionsFromZip â†’ actions â†’ engine.
 *
 * @see docs/2026-02-19-replay-mode.md Iteration 6
 */

import {
  loadActionsFromZip,
  loadSessionMetadata,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  createRecorderStore,
  type RecorderStore,
} from '../state/recorder-store';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import {
  ReplayEngine,
  type ReplayAction,
  type ReplayState,
} from 'gps-plus-slam-app-framework/state/replay-engine';
import {
  initReplayScene,
  disposeReplayScene,
  updateOrbitTarget,
  getAlignmentLerper,
} from 'gps-plus-slam-app-framework/ar/replay-scene';
import { wireStoreSubscribers } from 'gps-plus-slam-app-framework/state/store-subscribers';
import { wireRefPointSubscribers } from '../state/ref-point-subscribers';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import {
  getArPose,
  nuePositionToWebXR,
  nueQuaternionToWebXR,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { migrateActionsIfNeeded } from '../storage/recording-migration.js';
import * as THREE from 'three';

const log = createLogger('ReplayMode');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplayModeConfig {
  /** DOM container for the Three.js canvas */
  container: HTMLElement;
  /** Called after each action dispatch: (current, total) */
  onProgress: (current: number, total: number) => void;
  /** Called when all actions have been dispatched */
  onComplete: () => void;
  /** Called when a dispatch error occurs: (message) */
  onError: (actionIndex: number, error: Error) => void;
}

export interface ReplayModeController {
  /** Start dispatching actions at the given speed factor */
  play(speedFactor: number): Promise<void>;
  /** Pause the replay */
  pause(): void;
  /** Resume from where we paused */
  resume(): Promise<void>;
  /** Change playback speed (takes effect on next delay) */
  setSpeed(factor: number): void;
  /** Get the current engine state */
  getState(): ReplayState;
  /** Get the underlying ReplayEngine */
  getEngine(): ReplayEngine;
  /** Get the replay store (R6: same instance used by subscribers) */
  getStore(): RecorderStore;
  /** Get the total number of loaded actions */
  getActionCount(): number;
  /** Set or clear the map overlay for GPS position updates via store subscribers */
  setMapOverlay(
    overlay: {
      setGpsPosition: (lat: number, lon: number) => void;
      addRawGpsPoint?: (lat: number, lon: number) => void;
      addFusedPoint?: (lat: number, lon: number) => void;
      addAlignmentSnapshot?: (lat: number, lon: number) => void;
      addRefPoint?: (lat: number, lon: number, name: string) => void;
    } | null
  ): void;
  /** Dispose all resources (scene, engine, subscribers) */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize replay mode: load actions from zip, create store + scene +
 * subscribers + engine, and return a controller.
 *
 * @param zipData - Raw zip file bytes
 * @param config - UI callbacks and container element
 * @returns Controller for driving replay from the UI
 */
export async function startReplayMode(
  zipData: Uint8Array,
  config: ReplayModeConfig
): Promise<ReplayModeController> {
  log.info('Starting replay mode...');

  // R8: Load actions from zip
  const [zipEntries, sessionMetadata] = await Promise.all([
    loadActionsFromZip(zipData),
    loadSessionMetadata(zipData),
  ]);
  const rawActions: ReplayAction[] = zipEntries.map((e) => e.action);
  // Migrate old recordings (pre-NUE convention) to the current coordinate frame
  const actions = migrateActionsIfNeeded(
    rawActions,
    sessionMetadata
  ) as ReplayAction[];
  log.info(`Loaded ${actions.length} actions from zip`);

  // Create store with NullStorageBackend (no persistence side effects)
  const store = createRecorderStore({
    storageBackend: new NullStorageBackend(),
  });

  // Initialize Three.js replay scene (no WebXR)
  initReplayScene(config.container);
  log.info('Replay scene initialized');

  // Get the alignment lerper (Issue 4) â€” store subscribers route alignment
  // updates through the lerper for smooth interpolation instead of snapping.
  const alignmentLerper = getAlignmentLerper();

  // Map overlay proxy â€” delegates to a late-bound real overlay so the
  // store subscriber can update the map even though it is created later.
  let mapOverlayTarget: {
    setGpsPosition: (lat: number, lon: number) => void;
    addRawGpsPoint?: (lat: number, lon: number) => void;
    addFusedPoint?: (lat: number, lon: number) => void;
    addAlignmentSnapshot?: (lat: number, lon: number) => void;
    addRefPoint?: (lat: number, lon: number, name: string) => void;
  } | null = null;
  const mapOverlayProxy = {
    setGpsPosition(lat: number, lon: number): void {
      mapOverlayTarget?.setGpsPosition(lat, lon);
    },
    addRawGpsPoint(lat: number, lon: number): void {
      mapOverlayTarget?.addRawGpsPoint?.(lat, lon);
    },
    addFusedPoint(lat: number, lon: number): void {
      mapOverlayTarget?.addFusedPoint?.(lat, lon);
    },
    addAlignmentSnapshot(lat: number, lon: number): void {
      mapOverlayTarget?.addAlignmentSnapshot?.(lat, lon);
    },
    addRefPoint(lat: number, lon: number, name: string): void {
      mapOverlayTarget?.addRefPoint?.(lat, lon, name);
    },
  };

  // R6: Wire store subscribers with THE SAME store the engine will dispatch to.
  // This ensures dispatched replay actions trigger visualization updates.
  //
  // NOTE: onNewGpsPosition is intentionally omitted. The onNewOdomPose
  // callback updates arpose with the recorded trajectory pose, but it no
  // longer drives the orbit target. Instead, onAlignmentSnapshot (Issue #3)
  // updates the orbit target only when alignment snapshots are created,
  // centering the orbit camera on the system's best-estimate GPS position.
  const unsubscribe = wireStoreSubscribers(store, {
    applyAlignmentMatrix: (matrix) => alignmentLerper?.setTarget(matrix),
    gpsEventVisualizer,
    mapOverlay: mapOverlayProxy, // Proxy delegates to real overlay once set via setMapOverlay()
    // 6.2: Update arpose Object3D with recorded odom pose during replay.
    // The arpose node sits between arWorldGroup and camera; writing the
    // recorded pose here makes the camera follow the recorded trajectory
    // while user controls only affect the camera's local offset.
    onNewOdomPose: (() => {
      return (
        odomPosition: readonly number[],
        odomRotation: readonly number[]
      ) => {
        const arpose = getArPose();
        if (!arpose) {
          return;
        }
        // Convert NUEâ†’WebXR so (alignment Ã— W2N) Ã— WebXR_pos = alignment Ã— NUE_pos
        const webxrPos = nuePositionToWebXR(odomPosition);
        arpose.position.fromArray(webxrPos);
        // Rotation is now NUE in state â€” convert back to WebXR for arpose
        // (arpose sits below basisChangeNode in WebXR-local space)
        const webxrRot = nueQuaternionToWebXR(odomRotation);
        arpose.quaternion.fromArray(webxrRot);
      };
    })(),
    // Issue #3: Update orbit target when alignment snapshots are created.
    // The snapshot NUE position is in scene-root space (A_k Ã— p_k), so it
    // can be passed directly to updateOrbitTarget.
    onAlignmentSnapshot: (() => {
      const snapshotPos = new THREE.Vector3();
      return (nuePosition: readonly number[]) => {
        snapshotPos.fromArray(nuePosition);
        updateOrbitTarget(snapshotPos);
      };
    })(),
  });
  const unsubscribeRefPoints = wireRefPointSubscribers(store, refPointVisualizer);

  // Create and configure the replay engine
  const engine = new ReplayEngine();
  engine.onProgress(config.onProgress);
  engine.onComplete(config.onComplete);
  engine.onError(config.onError);

  let disposed = false;

  const controller: ReplayModeController = {
    play(speedFactor: number): Promise<void> {
      if (disposed) {
        return Promise.resolve();
      }
      return engine.play(actions, store, speedFactor);
    },

    pause(): void {
      engine.pause();
    },

    resume(): Promise<void> {
      return engine.resume();
    },

    setSpeed(factor: number): void {
      engine.setSpeed(factor);
    },

    getState(): ReplayState {
      return engine.getState();
    },

    getEngine(): ReplayEngine {
      return engine;
    },

    getStore(): RecorderStore {
      return store;
    },

    getActionCount(): number {
      return actions.length;
    },

    setMapOverlay(
      overlay: {
        setGpsPosition: (lat: number, lon: number) => void;
        addRawGpsPoint?: (lat: number, lon: number) => void;
        addFusedPoint?: (lat: number, lon: number) => void;
        addAlignmentSnapshot?: (lat: number, lon: number) => void;
        addRefPoint?: (lat: number, lon: number, name: string) => void;
      } | null
    ): void {
      mapOverlayTarget = overlay;
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;

      engine.dispose();
      unsubscribe();
      unsubscribeRefPoints();
      disposeReplayScene();
      log.info('Replay mode disposed');
    },
  };

  return controller;
}
