/**
 * Ref-Point Handlers
 *
 * Encapsulates all reference-point state and event handlers, extracted from
 * main.ts (Finding #7 — main.ts decomposition, ref-point extraction).
 *
 * The factory pattern allows main.ts to inject dependencies that change over
 * the app lifecycle (e.g., the active store and current session name).
 *
 * All other dependencies (file system, UI, visualization) are imported
 * directly — the same modules they were imported from in main.ts.
 */

import { getCurrentArPose } from 'gps-plus-slam-app-framework/ar/webxr-session';
import { getCurrentScenarioHandle } from 'gps-plus-slam-app-framework/storage/file-system';
import {
  saveRefPointObservation,
  type RefPointObservation,
  type RefPointMark,
} from '../storage/ref-point-loader';
import type { ImportedRefPoint } from '../storage/ref-point-importer';
import {
  showRefPointPicker,
  isRefPointPickerVisible,
} from '../ui/ref-point-picker';
import {
  extractOdomPosition,
  extractOdomRotation,
} from 'gps-plus-slam-app-framework/state/gps-event-coordinator';
import { showError, updateStatus } from '../ui/hud';
import { showToast } from '../ui/toast';
import {
  markReferencePoint,
  setImportedRefPoints as setImportedRefPointsAction,
  incrementRefPointUsage,
  clearSessionRefPointUsage as clearSessionRefPointUsageAction,
  resetRefPointsState,
  addCurrentRefPointMark,
  selectCachedKnownRefPoints,
  type GpsPoint,
} from '../state/recorder-store';
import { fusedGpsFromOdom } from 'gps-plus-slam-app-framework/utils/fused-path';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  gpsToH3,
  findNearbyGeoAnchor,
} from 'gps-plus-slam-app-framework/geo/h3-proximity';
import { webxrToNUE } from 'gps-plus-slam-app-framework/core';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('RefPointHandlers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefPointHandlersDeps {
  /** Returns the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** Returns the current session name (set when recording starts). */
  getCurrentSessionName: () => string;
}

interface NearbyRefPointInfo {
  /** Display name of the nearby ref point. */
  readonly displayName: string;
  /** True when the user's H3 cell differs from the matched ref point's cell
   *  (i.e., in a gridDisk neighbor cell — a new ref point could be added). */
  readonly isNeighborCell: boolean;
}

export interface RefPointHandlers {
  // Primary handler. When forceNew is true, bypass re-observation and
  // show the picker for creating a new ref point even when near a known one.
  handleMarkRefPoint(options?: { forceNew?: boolean }): Promise<void>;

  // Proximity check for live button label + neighbor-cell detection
  checkNearbyRefPoint(lat: number, lng: number): NearbyRefPointInfo | undefined;

  // State accessors
  getImportedRefPoints(): ImportedRefPoint[];
  setImportedRefPoints(refPoints: ImportedRefPoint[]): void;
  getSessionRefPointUsage(): Map<string, number>;
  clearSessionRefPointUsage(): void;

  // Lifecycle
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRefPointHandlers(
  deps: RefPointHandlersDeps
): RefPointHandlers {
  // --- State ---
  // Only markRefPointInProgress remains as closure state (transient concurrency guard).
  // importedRefPoints, cachedKnownRefPoints, sessionRefPointUsage are now in Redux
  // (refPointsSlice) and accessed via deps.getStore().getState().refPoints.
  let markRefPointInProgress = false;

  /** Per-H3-cell cooldown to prevent accidental duplicate re-observations (Aachen audit Issue 3). */
  const RE_OBSERVATION_COOLDOWN_MS = 10_000;
  const lastReObservationTimestamp = new Map<string, number>();

  // --- Internal helpers ---

  function validateRefPointPrerequisites(): {
    arPose: NonNullable<ReturnType<typeof getCurrentArPose>>;
    lastGpsPoint: GpsPoint;
  } | null {
    const arPose = getCurrentArPose();
    if (!arPose) {
      showError('Cannot mark reference point - AR tracking not available');
      return null;
    }

    const state = deps.getStore().getState();
    const lastGpsPoint = state.gpsData?.gpsEvents?.gpsPositions?.at(-1) ?? null;

    if (!lastGpsPoint) {
      showError('Cannot mark reference point - no GPS data available');
      return null;
    }

    return { arPose, lastGpsPoint };
  }

  function buildRefPointObservation(
    odomPosition: Vector3,
    odomRotation: Quaternion,
    lastGpsPoint: GpsPoint,
    timestamp: number,
    fusedGpsPoint?: { latitude: number; longitude: number; altitude?: number }
  ): RefPointObservation {
    const obs: RefPointObservation = {
      sessionId: deps.getCurrentSessionName(),
      timestamp,
      arPose: {
        position: odomPosition,
        rotation: odomRotation,
      },
      gpsPoint: lastGpsPoint,
    };
    if (fusedGpsPoint) {
      return { ...obs, fusedGpsPoint };
    }
    return obs;
  }

  function dispatchRefPointAction(
    refPointId: string,
    odomPosition: Vector3,
    odomRotation: Quaternion,
    gpsPoint: GpsPoint,
    timestamp: number
  ): void {
    // Extract raw sensor fields from state-side GpsPoint for the action payload.
    // Derived fields (coordinates, weight, zeroRef, deviceRotation) are
    // recomputed by the reducer (raw-storage pattern).
    const {
      zeroRef: _z,
      coordinates: _c,
      weight: _w,
      deviceRotation: _d,
      ...rawGpsPoint
    } = gpsPoint;
    deps.getStore().dispatch(
      markReferencePoint({
        id: refPointId,
        position: odomPosition,
        rotation: odomRotation,
        rawGpsPoint,
        timestamp,
      })
    );
  }

  async function persistRefPointObservation(
    scenarioHandle: FileSystemDirectoryHandle,
    refPointId: string,
    refPointName: string,
    observation: RefPointObservation
  ): Promise<boolean> {
    try {
      await saveRefPointObservation(
        scenarioHandle,
        refPointId,
        refPointName,
        observation
      );
      log.info(`Saved reference point ${refPointId} to scenario refPoints/`);
      return true;
    } catch (err) {
      log.error('Failed to save reference point:', err);
      showError('Failed to save reference point to disk');
      return false;
    }
  }

  function visualizeRefPoint(
    refPointId: string,
    odomPosition: Vector3,
    odomRotation: Quaternion,
    lastGpsPoint: GpsPoint,
    timestamp: number,
    fusedGpsPoint?: { latitude: number; longitude: number; altitude?: number }
  ): void {
    // Prefer fused GPS so the red current-session sphere sits where the
    // next session's green sphere will appear (loader also prefers fused —
    // see 2026-04-24-refpoint-positioning-investigation.md §7).
    //
    // Per-field fallback (Option B, 2026-04-29 user-feedback Finding 1):
    // mirrors `flattenRefPointsToMarks` in the loader. Fused altitude may
    // be undefined on legacy recordings (calcGpsCoords altitude-discard
    // bug); falling back to raw altitude recovers the value the recorder
    // originally intended. New recordings (post-fix) populate fused
    // altitude themselves, so the fallback only fires for legacy data.
    const gpsPosition = {
      lat: fusedGpsPoint?.latitude ?? lastGpsPoint.latitude,
      lon: fusedGpsPoint?.longitude ?? lastGpsPoint.longitude,
      altitude: fusedGpsPoint?.altitude ?? lastGpsPoint.altitude,
    };
    const refPointMark: RefPointMark = {
      id: refPointId,
      odomPosition,
      odomRotation,
      gpsPosition,
      timestamp,
    };
    // Finding 5: dispatch into the slice; the visualizer subscribes via
    // wireStoreSubscribers and renders the red sphere from there.
    // See docs/2026-04-30-refpoint-marks-into-redux-plan.md.
    deps.getStore().dispatch(addCurrentRefPointMark(refPointMark));
  }

  // --- Main handler ---

  async function handleMarkRefPoint(options?: {
    forceNew?: boolean;
  }): Promise<void> {
    // Guard: ignore if picker is already open (prevents overwriting currentResolver)
    if (isRefPointPickerVisible()) {
      log.warn('Reference point picker already open, ignoring duplicate call');
      return;
    }

    // Synchronous lock: prevents concurrent calls that pass the visibility check
    // before the picker is actually shown (async gap between check and show)
    if (markRefPointInProgress) {
      log.warn('Mark ref point already in progress, ignoring duplicate call');
      return;
    }
    markRefPointInProgress = true;

    try {
      log.info('Mark reference point');

      // Validate prerequisites
      const validated = validateRefPointPrerequisites();
      if (!validated) {
        return;
      }

      const { arPose, lastGpsPoint } = validated;

      // Compute H3 index for the current GPS position
      const currentH3 = gpsToH3(lastGpsPoint.latitude, lastGpsPoint.longitude);
      const scenarioHandle = getCurrentScenarioHandle();

      // Read cached known ref points from Redux (memoized selector)
      const cachedKnownRefPoints = selectCachedKnownRefPoints(
        deps.getStore().getState().refPoints
      );

      // Check if we're near a known ref point (re-observation).
      // When forceNew is set, skip the proximity check to force the picker.
      const nearbyMatch = options?.forceNew
        ? undefined
        : findNearbyGeoAnchor(
            lastGpsPoint.latitude,
            lastGpsPoint.longitude,
            cachedKnownRefPoints
          );

      let refPointId: string;
      let refPointName: string;

      if (nearbyMatch) {
        // Re-observation: use the matched ref point's H3 index, skip picker
        refPointId = currentH3;
        refPointName = nearbyMatch.displayName ?? currentH3;

        // Per-cell cooldown: reject rapid duplicate taps (Aachen audit Issue 3)
        const lastMark = lastReObservationTimestamp.get(nearbyMatch.h3Index);
        if (
          lastMark !== undefined &&
          Date.now() - lastMark < RE_OBSERVATION_COOLDOWN_MS
        ) {
          log.warn(
            `Re-observation of ${refPointId} ignored — cooldown active (${RE_OBSERVATION_COOLDOWN_MS}ms)`
          );
          return;
        }

        log.info(
          `Re-observation of ref point: ${refPointId} (${refPointName})`
        );
      } else {
        // New ref point: show picker for optional display name only.
        // No suggestion list — scenario IDs are H3 hex strings (meaningless to users)
        // and imported names refer to distant locations (no nearby match).
        const sessionUsage = deps.getStore().getState()
          .refPoints.sessionRefPointUsage;
        const usageMap = new Map(Object.entries(sessionUsage));
        const pickerResult = await showRefPointPicker([], usageMap);
        if (!pickerResult) {
          log.info('Reference point marking cancelled');
          return;
        }

        refPointId = currentH3;
        refPointName = pickerResult.id; // user-entered name is display metadata only
        log.info(`New ref point: ${refPointId} (${refPointName})`);
      }

      const timestamp = Date.now();

      // Extract odometry data once from AR pose (used by dispatch, persist, visualize)
      const odomPosition = extractOdomPosition(arPose);
      const odomRotation = extractOdomRotation(arPose);

      // Compute fused GPS if alignment matrix is available
      let fusedGpsPoint:
        | { latitude: number; longitude: number; altitude?: number }
        | undefined;
      const state = deps.getStore().getState();
      const alignmentMatrix = state.gpsData?.gpsEvents?.alignmentMatrix;
      const zeroRef = state.gpsData?.zero;
      if (alignmentMatrix && zeroRef) {
        const gps = fusedGpsFromOdom(
          alignmentMatrix,
          webxrToNUE(odomPosition),
          zeroRef
        );
        fusedGpsPoint = {
          latitude: gps.lat,
          longitude: gps.lon,
          altitude: gps.altitude,
        };
      }

      // Dispatch action to library
      dispatchRefPointAction(
        refPointId,
        odomPosition,
        odomRotation,
        lastGpsPoint,
        timestamp
      );

      // Persist to disk
      let persistOk = true;
      if (scenarioHandle) {
        const observation = buildRefPointObservation(
          odomPosition,
          odomRotation,
          lastGpsPoint,
          timestamp,
          fusedGpsPoint
        );
        persistOk = await persistRefPointObservation(
          scenarioHandle,
          refPointId,
          refPointName,
          observation
        );
      }

      // Visualize in scene
      visualizeRefPoint(
        refPointId,
        odomPosition,
        odomRotation,
        lastGpsPoint,
        timestamp,
        fusedGpsPoint
      );

      updateStatus(`Marked reference point: ${refPointId}`);

      // Re-observation toast feedback (Finding 3, 2026-04-29 user feedback):
      // the single-click re-observation branch shows no picker, so the user
      // otherwise has no confirmation. Picker-driven new-ref-point flow has
      // implicit feedback via the picker UI itself, so it does NOT toast.
      // Only fire after the OPFS write succeeds — the toast reflects the
      // durable end state, not just the dispatch.
      if (nearbyMatch && persistOk) {
        showToast(`Re-observed "${refPointName}"`, { severity: 'info' });
      }

      // Track usage in current session (Issue 6) via Redux
      deps.getStore().dispatch(incrementRefPointUsage(refPointId));

      // Record re-observation timestamp for cooldown (Aachen audit Issue 3)
      if (nearbyMatch) {
        lastReObservationTimestamp.set(nearbyMatch.h3Index, Date.now());
      }
    } finally {
      markRefPointInProgress = false;
    }
  }

  // --- Public API ---

  return {
    handleMarkRefPoint,

    checkNearbyRefPoint(
      lat: number,
      lng: number
    ): NearbyRefPointInfo | undefined {
      const cachedKnown = selectCachedKnownRefPoints(
        deps.getStore().getState().refPoints
      );
      const match = findNearbyGeoAnchor(lat, lng, cachedKnown);
      if (!match) return undefined;
      const currentCell = gpsToH3(lat, lng);
      return {
        displayName: match.displayName ?? currentCell,
        isNeighborCell: match.h3Index !== currentCell,
      };
    },

    getImportedRefPoints: () =>
      deps.getStore().getState().refPoints.importedRefPoints,
    setImportedRefPoints: (refPoints: ImportedRefPoint[]) => {
      deps.getStore().dispatch(setImportedRefPointsAction(refPoints));
    },
    getSessionRefPointUsage: () => {
      const record = deps.getStore().getState().refPoints.sessionRefPointUsage;
      return new Map(Object.entries(record));
    },
    clearSessionRefPointUsage: () => {
      deps.getStore().dispatch(clearSessionRefPointUsageAction());
    },

    reset: () => {
      deps.getStore().dispatch(resetRefPointsState());
      markRefPointInProgress = false;
      lastReObservationTimestamp.clear();
    },
  };
}
