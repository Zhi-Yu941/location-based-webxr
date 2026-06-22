/**
 * Replay Mode Orchestrator
 *
 * Wires together all replay building blocks from Iterations 1-5 into
 * a single entry point. Creates the store, scene, subscribers, and
 * engine, then returns a controller for UI integration.
 *
 * Key risks addressed:
 * - R6: Store identity — the same store is passed to wireStoreSubscribers
 *   and the ReplayEngine so dispatched actions trigger visualization updates.
 * - R7: Error handling — onError callback is wired from config to the engine.
 * - R8: Data flow — zip bytes → loadActionsFromZip → actions → engine.
 *
 * @see docs/2026-02-19-replay-mode.md Iteration 6
 */

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
import type { MapData } from 'gps-plus-slam-app-framework/visualization/map-data';
import { wireRefPointSubscribers } from '../state/ref-point-subscribers';
import { gpsEventVisualizer } from 'gps-plus-slam-app-framework/visualization/gps-event-markers';
import { refPointVisualizer } from '../visualization/ref-point-visualizer';
import {
  getArPose,
  nuePositionToWebXR,
  nueQuaternionToWebXR,
} from 'gps-plus-slam-app-framework/ar/webxr-session';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { loadRecording } from '../storage/recording-loader.js';
import { createStoreRef } from '../state/store-ref';
import { FrameTileVisualizer } from '../visualization/frame-tile-visualizer';
import { decodeFrameTexture } from '../visualization/frame-texture-decoder';
import { wireFrameTileSubscribers } from '../visualization/wire-frame-tile-subscribers';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { loadRecordingOptions } from 'gps-plus-slam-app-framework/state/recording-options';
import { OccupancyCubesVisualizer } from '../visualization/occupancy-cubes-visualizer';
import { wireOccupancyGridSubscribers } from '../visualization/wire-occupancy-grid-subscribers';
import { createZipFrameBlobSource } from '../storage/zip-frame-blob-source';
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

/**
 * Subset of the recorder's `LeafletMapOverlay` API that replay mode forwards
 * GPS / marker updates to. Declared structurally (instead of importing the
 * concrete type) so replay mode stays decoupled from the live recorder map.
 */
interface ReplayMapOverlay {
  setGpsPosition: (lat: number, lon: number) => void;
  render?: (data: MapData) => void;
  addCurrentMarker?: (lat: number, lon: number, name: string) => void;
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
  setMapOverlay(overlay: ReplayMapOverlay | null): void;
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

  // R8: Load + migrate the recording through the canonical version-transparent
  // loader. `loadRecording` parses session metadata, migrates actions to the
  // current schema, and exposes a memoised final state — replay only needs
  // the migrated action list, which it forwards to the ReplayEngine.
  const recording = await loadRecording(zipData);
  const actions: ReplayAction[] = recording.actions.map((e) => e.action);
  log.info(`Loaded ${actions.length} actions from zip`);

  // Create store with NullStorageBackend (no persistence side effects)
  const store = createRecorderStore({
    storageBackend: new NullStorageBackend(),
  });

  // Initialize Three.js replay scene (no WebXR)
  const replaySceneState = initReplayScene(config.container);
  log.info('Replay scene initialized');

  // F3.5 — wire frame-tile visualization for add2dImage actions so the
  // 2D camera frames recorded during the original session reappear as
  // textured planes in the replay scene. Failure here (e.g. zip lacks a
  // frames/ subdir) must not crash replay, so the whole wire-up is
  // best-effort.
  let unsubscribeFrameTiles: (() => void) | null = null;
  let frameTileVisualizer: FrameTileVisualizer | null = null;
  try {
    const blobSource = await createZipFrameBlobSource(zipData);
    // Parent under arWorldGroup (NOT the scene root): frame tiles are
    // raw-WebXR poses and must ride the alignment × WEBXR_TO_NUE chain,
    // exactly like the occupancy cubes below. See the frame-check doc.
    frameTileVisualizer = new FrameTileVisualizer(
      replaySceneState.arWorldGroup
    );
    const storeRef = createStoreRef(store);
    // D7-resolution: downscale the display texture by the CURRENT
    // frameTileDisplay divisor (a display preference, not part of the
    // recording — same pattern as occupancy.cellSizeM above, which also
    // re-quantizes an old recording at the current setting).
    const frameTileDivisor = loadRecordingOptions().frameTileDisplay.divisor;
    unsubscribeFrameTiles = wireFrameTileSubscribers({
      storeRef,
      visualizer: frameTileVisualizer,
      blobSource,
      decodeTexture: (blob) => decodeFrameTexture(blob, frameTileDivisor),
      onError: (err, imageFile) => {
        log.warn(`Frame tile decode failed for "${imageFile}"`, err);
      },
    });
  } catch (err) {
    log.warn(
      'Frame tile visualizer wiring skipped; replay continues without frame tiles',
      err
    );
  }

  // Occupancy-grid cubes — recordDepthSample actions re-dispatched during
  // replay rebuild the voxel grid in the replay scene (port plan Iter 5).
  // The cells are raw-WebXR coordinates, so the visualizer hangs off
  // arWorldGroup (NOT the scene root) and rides the alignment like the
  // recorded camera path (Iter 7 reparenting fix). Recordings made before
  // intrinsics capture carry no projectionMatrix, so their samples are
  // skipped and the grid simply stays empty; replay continues normally.
  // Best-effort like the frame tiles above.
  let unsubscribeOccupancyGrid: (() => void) | null = null;
  let occupancyCubesVisualizer: OccupancyCubesVisualizer | null = null;
  try {
    // Re-derive the grid from the recorded depth points at the user's current
    // voxel size (recording-options `occupancy.cellSizeM`, clamped 1–20 cm).
    // Reading it here lets the same recording be re-quantized at a different
    // resolution without re-capturing — 2026-06-13 occupancy-grid-settings
    // review, item 1. `loadRecordingOptions` is self-defending (returns the
    // validated default on any storage error), so this stays best-effort.
    const replayOptions = loadRecordingOptions();
    const occupancyOptions = replayOptions.occupancy;
    const occupancyGrid = new OccupancyGrid({
      cellSizeM: occupancyOptions.cellSizeM,
    });
    // Same noise filter as live (main.ts): render only voxels seen ≥
    // minConfidence times, re-quantizable per replay like cellSizeM.
    occupancyCubesVisualizer = new OccupancyCubesVisualizer(
      replaySceneState.arWorldGroup,
      { minObservations: occupancyOptions.minConfidence }
    );
    unsubscribeOccupancyGrid = wireOccupancyGridSubscribers({
      storeRef: createStoreRef(store),
      grid: occupancyGrid,
      visualizer: occupancyCubesVisualizer,
      // Coalesce the replay burst to the user's current `depth.intervalMs`
      // rather than a fixed 1 s — re-quantization parity with cellSizeM /
      // minConfidence above (the same global setting re-read per replay),
      // NOT the recording's original capture cadence (2026-06-22 cube
      // cadence/locality plan §2).
      refreshIntervalMs: replayOptions.depth.intervalMs,
      onError: (err) => {
        log.warn('Occupancy grid update failed during replay', err);
      },
    });
  } catch (err) {
    log.warn(
      'Occupancy grid wiring skipped; replay continues without depth cubes',
      err
    );
  }

  // Get the alignment lerper (Issue 4) — store subscribers route alignment
  // updates through the lerper for smooth interpolation instead of snapping.
  const alignmentLerper = getAlignmentLerper();

  // Map overlay proxy — delegates to a late-bound real overlay so the
  // store subscriber can update the map even though it is created later.
  let mapOverlayTarget: ReplayMapOverlay | null = null;
  const mapOverlayProxy = {
    setGpsPosition(lat: number, lon: number): void {
      mapOverlayTarget?.setGpsPosition(lat, lon);
    },
    render(data: MapData): void {
      mapOverlayTarget?.render?.(data);
    },
    addCurrentMarker(lat: number, lon: number, name: string): void {
      mapOverlayTarget?.addCurrentMarker?.(lat, lon, name);
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
        // Convert NUE→WebXR so (alignment × W2N) × WebXR_pos = alignment × NUE_pos
        const webxrPos = nuePositionToWebXR(odomPosition);
        arpose.position.fromArray(webxrPos);
        // Rotation is now NUE in state — convert back to WebXR for arpose
        // (arpose sits below basisChangeNode in WebXR-local space)
        const webxrRot = nueQuaternionToWebXR(odomRotation);
        arpose.quaternion.fromArray(webxrRot);
      };
    })(),
    // Issue #3: Update orbit target when alignment snapshots are created.
    // The snapshot NUE position is in scene-root space (A_k × p_k), so it
    // can be passed directly to updateOrbitTarget.
    onAlignmentSnapshot: (() => {
      const snapshotPos = new THREE.Vector3();
      return (nuePosition: readonly number[]) => {
        snapshotPos.fromArray(nuePosition);
        updateOrbitTarget(snapshotPos);
      };
    })(),
  });
  const unsubscribeRefPoints = wireRefPointSubscribers(
    store,
    refPointVisualizer
  );

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

    setMapOverlay(overlay: ReplayMapOverlay | null): void {
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
      unsubscribeFrameTiles?.();
      frameTileVisualizer?.dispose();
      unsubscribeOccupancyGrid?.();
      occupancyCubesVisualizer?.dispose();
      disposeReplayScene();
      log.info('Replay mode disposed');
    },
  };

  return controller;
}
