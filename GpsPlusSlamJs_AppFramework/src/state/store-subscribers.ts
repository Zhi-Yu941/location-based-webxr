/**
 * Store Subscribers Module
 *
 * Extracted from main.ts (Iteration 4, Risk R2 fix).
 * Provides a reusable function to wire store state-change listeners to
 * visualization dependencies (alignment matrix, GPS event markers, map overlay).
 *
 * Both the live recording path and the replay path call wireStoreSubscribers()
 * with the same interface, ensuring identical behavior.
 *
 * Uses subscribeToSelector for selective change detection — callbacks only
 * fire when the specific state slice they care about actually changes.
 * This replaces the manual lastX tracking variables from the original design.
 *
 * @see docs/2026-02-19-replay-mode.md Issue 2, Risk R2
 * @see docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import type { LatLong, Matrix4, Vector3, Quaternion } from 'gps-plus-slam-js';
import { calcGpsCoords } from 'gps-plus-slam-js';
import { vec3, mat4 } from 'gl-matrix';
import { fusedGpsFromOdom } from '../utils/fused-path';
import {
  subscribeToSelector,
  type SubscribableStore,
} from './subscribe-to-selector';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectOdometryRotations,
  selectZeroReference,
} from './app-selectors';

// Re-export SubscribableStore for backwards compatibility (it was
// originally defined here and is part of the public API via index.ts).
export type { SubscribableStore } from './subscribe-to-selector';

/**
 * Dependencies injected into wireStoreSubscribers.
 * Uses minimal interfaces — callers pass the real singletons or test mocks.
 */
export interface StoreSubscriberDeps {
  /** Apply alignment matrix to the AR world group (from webxr-session.ts). */
  applyAlignmentMatrix: (matrix: Matrix4) => void;

  /** GPS event visualizer — adds raw + fused marker spheres. */
  gpsEventVisualizer: {
    getZeroRef: () => LatLong | null;
    setZeroRef: (zero: LatLong) => void;
    addGpsEvent: (gpsCoords: Vector3, odomPosition: Vector3) => void;
    addAlignmentSnapshot: (nuePosition: Vector3) => void;
  };

  /** Map overlay — updates the 2D map position. Nullable (not present in all modes). */
  mapOverlay?: {
    setGpsPosition: (lat: number, lon: number) => void;
    addRawGpsPoint?: (lat: number, lon: number) => void;
    addFusedPoint?: (lat: number, lon: number) => void;
    addAlignmentSnapshot?: (lat: number, lon: number) => void;
  } | null;

  /**
   * Optional callback invoked with the GPS world-space coordinates of each
   * newly visualized GPS event. Used in replay mode to auto-follow the orbit
   * camera target to the latest position (Risk R9 fix).
   *
   * Not provided in live recording mode (camera is XR-controlled).
   */
  onNewGpsPosition?: (coords: Vector3) => void;

  /**
   * Optional callback invoked with the odom position and rotation of each
   * newly dispatched GPS event. Used in replay mode to update the arpose
   * Object3D so the camera follows the recorded AR trajectory.
   *
   * Not provided in live recording mode (arpose stays at identity).
   */
  onNewOdomPose?: (odomPosition: Vector3, odomRotation: Quaternion) => void;

  /**
   * Optional callback invoked with the transformed NUE position each time
   * an alignment snapshot is captured. Used in replay mode to update the
   * orbit camera target to the snapshot position (Issue #3).
   */
  onAlignmentSnapshot?: (nuePosition: Vector3) => void;

  /**
   * Optional callback invoked with raw lat/lng of each newly processed GPS
   * event. Used in live recording to drive ref-point proximity detection
   * for dynamic button label updates.
   */
  onNewGpsLatLng?: (lat: number, lng: number) => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wire store state-change subscriptions to visualization dependencies.
 *
 * Uses subscribeToSelector to decompose the monolithic subscriber into
 * focused, change-gated callbacks:
 * 1. Alignment matrix changes → apply matrix + capture snapshots
 * 2. GPS position changes → incremental event visualization + map overlay
 * 3. Reference point changes → forward to map overlay
 *
 * Each subscription uses reference equality to detect changes — callbacks
 * only fire when the selector output actually differs between dispatches.
 *
 * Each call creates **fresh subscriptions** — no manual reset needed between
 * sessions. Call the returned unsubscribe function to tear down all.
 *
 * @param store — any object satisfying SubscribableStore (RecorderStore, replay store, mock)
 * @param deps  — visualization dependencies (real singletons or test mocks)
 * @returns An unsubscribe function that removes all listeners from the store.
 */
export function wireStoreSubscribers(
  store: SubscribableStore,
  deps: StoreSubscriberDeps
): () => void {
  // Pre-allocate gl-matrix scratch vectors for alignment snapshot computation.
  const _odomVec = vec3.create();
  const _alignedVec = vec3.create();

  const unsubs: Array<() => void> = [];

  // 1. Alignment matrix → apply to AR world group + capture snapshots
  unsubs.push(
    subscribeToSelector(store, selectAlignmentMatrix, (matrix) => {
      if (!matrix) return;
      deps.applyAlignmentMatrix(matrix);

      // Capture alignment snapshot (Issue #1)
      const state = store.getState();
      const odomPositions = selectOdometryPositions(state);
      if (odomPositions.length > 0) {
        const latestOdom = odomPositions[odomPositions.length - 1]!;
        const glMat = mat4.fromValues(...matrix);
        vec3.set(_odomVec, latestOdom[0], latestOdom[1], latestOdom[2]);
        vec3.transformMat4(_alignedVec, _odomVec, glMat);
        const snapshotPos: Vector3 = [
          _alignedVec[0],
          _alignedVec[1],
          _alignedVec[2],
        ];
        deps.gpsEventVisualizer.addAlignmentSnapshot(snapshotPos);
        deps.onAlignmentSnapshot?.(snapshotPos);

        // Feed alignment snapshot to map overlay as GPS lat/lon (Phase 1b)
        const zeroRef = selectZeroReference(state);
        if (zeroRef && deps.mapOverlay?.addAlignmentSnapshot) {
          const gps = calcGpsCoords(zeroRef, _alignedVec);
          deps.mapOverlay.addAlignmentSnapshot(gps.lat, gps.lon);
        }
      }
    })
  );

  // 2. GPS positions → incremental event visualization + map overlay position
  unsubs.push(
    subscribeToSelector(
      store,
      selectGpsPositions,
      (gpsPositions, prevPositions) => {
        const prevCount = prevPositions?.length ?? 0;
        const state = store.getState();

        // Set zero reference if not already set
        const zeroRef = selectZeroReference(state);
        if (zeroRef && !deps.gpsEventVisualizer.getZeroRef()) {
          deps.gpsEventVisualizer.setZeroRef(zeroRef);
        }

        const odomPositions = selectOdometryPositions(state);
        const odomRotations = selectOdometryRotations(state);

        // Add markers for any new GPS events
        for (let i = prevCount; i < gpsPositions.length; i++) {
          const gpsPoint = gpsPositions[i];
          const odomPos = odomPositions[i];
          if (gpsPoint && odomPos) {
            deps.gpsEventVisualizer.addGpsEvent(gpsPoint.coordinates, odomPos);
            deps.onNewGpsPosition?.(gpsPoint.coordinates);
            deps.onNewGpsLatLng?.(gpsPoint.latitude, gpsPoint.longitude);

            // Feed raw GPS point to map overlay (Approach E — Leaflet breadcrumb trail)
            deps.mapOverlay?.addRawGpsPoint?.(
              gpsPoint.latitude,
              gpsPoint.longitude
            );

            // Feed fused GPS point to map overlay (Phase 1b — cyan polyline)
            const alignmentMatrix = selectAlignmentMatrix(state);
            const zero = selectZeroReference(state);
            if (alignmentMatrix && zero && deps.mapOverlay?.addFusedPoint) {
              const fusedGps = fusedGpsFromOdom(alignmentMatrix, odomPos, zero);
              deps.mapOverlay.addFusedPoint(fusedGps.lat, fusedGps.lon);
            }

            // Update arpose with recorded odom pose (replay mode)
            const odomRot = odomRotations[i];
            if (odomRot) {
              deps.onNewOdomPose?.(odomPos, odomRot);
            }
          }
        }

        // Update map overlay GPS position (latest GPS point)
        if (deps.mapOverlay && gpsPositions.length > 0) {
          const lastGpsPoint = gpsPositions[gpsPositions.length - 1]!;
          deps.mapOverlay.setGpsPosition(
            lastGpsPoint.latitude,
            lastGpsPoint.longitude
          );
        }
      }
    )
  );

  // 3. Reference points — the recorder app owns the ref-points slice and
  // wires its own visualizer + map-overlay subscription on top of this
  // function (see RecorderApp's wireRefPointSubscribers). Framework remains
  // agnostic of ref points after Iter 4 of the boundary migration.

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
