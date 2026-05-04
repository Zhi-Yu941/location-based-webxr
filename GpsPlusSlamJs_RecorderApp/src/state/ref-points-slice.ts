/**
 * Redux slice for reference point state that was previously stored
 * in closure variables inside ref-point-handlers.ts.
 *
 * Moving this state into Redux enables:
 * - Store subscribers to react to imported ref-point changes (e.g., 2D map overlay)
 * - DevTools inspection and time-travel debugging
 * - Clean dependency boundaries for framework extraction
 *
 * @see docs/2026-03-26-state-management-audit.md §3.1 / §8.3.1
 * @see docs/2026-03-27-library-extraction-plan.md §4.1 Priority 1
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSelector, createSlice } from '@reduxjs/toolkit';
import type { ImportedRefPoint } from '../storage/ref-point-importer';
import type { RefPointMark } from '../storage/ref-point-loader';
import { gpsToH3, type KnownGeoAnchor } from 'gps-plus-slam-app-framework/geo/h3-proximity';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface RefPointsState {
  /** Prior ref points loaded from previous session ZIPs. */
  importedRefPoints: ImportedRefPoint[];
  /**
   * Tracks how many times each ref point was marked in the current session.
   * Keyed by ref-point ID (H3 index). Plain object for Redux serializability
   * (replaces the Map<string, number> that lived in the closure).
   */
  sessionRefPointUsage: Record<string, number>;
  /**
   * Per-observation ref point marks loaded from prior sessions.
   * Drives green-sphere 3D rendering via store subscription.
   * See docs/2026-04-30-refpoint-marks-into-redux-plan.md (Finding 5).
   *
   * Optional in the type for backward compatibility with test fixtures
   * authored before this slice grew the field; the reducer always sets
   * it, so consumers in production code can treat it as defined.
   */
  priorMarks?: RefPointMark[];
  /**
   * Per-observation ref point marks added during the current session.
   * Drives red-sphere 3D rendering via store subscription.
   */
  currentMarks?: RefPointMark[];
}

const initialState: RefPointsState = {
  importedRefPoints: [],
  sessionRefPointUsage: {},
  priorMarks: [],
  currentMarks: [],
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const refPointsSlice = createSlice({
  name: 'refPoints',
  initialState,
  reducers: {
    setImportedRefPoints(state, action: PayloadAction<ImportedRefPoint[]>) {
      state.importedRefPoints = action.payload;
    },
    incrementRefPointUsage(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.sessionRefPointUsage[id] =
        (state.sessionRefPointUsage[id] ?? 0) + 1;
    },
    clearSessionRefPointUsage(state) {
      state.sessionRefPointUsage = {};
    },
    setPriorRefPointMarks(state, action: PayloadAction<RefPointMark[]>) {
      // RefPointMark contains readonly tuple types (Vector3 / Quaternion)
      // that Immer's WritableNonArrayDraft refuses to widen. The slice
      // never mutates these tuples in place — it replaces the array
      // wholesale — so a structural cast is sound.
      (state as { priorMarks?: RefPointMark[] }).priorMarks = action.payload;
    },
    addCurrentRefPointMark(state, action: PayloadAction<RefPointMark>) {
      const s = state as { currentMarks?: RefPointMark[] };
      if (!s.currentMarks) s.currentMarks = [];
      // See setPriorRefPointMarks for rationale on the structural cast.
      s.currentMarks.push(action.payload);
    },
    clearCurrentRefPointMarks(state) {
      state.currentMarks = [];
    },
    resetRefPointsState() {
      return initialState;
    },
  },
});

export const {
  setImportedRefPoints,
  incrementRefPointUsage,
  clearSessionRefPointUsage,
  setPriorRefPointMarks,
  addCurrentRefPointMark,
  clearCurrentRefPointMarks,
  resetRefPointsState,
} = refPointsSlice.actions;

export const refPointsReducer = refPointsSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Memoized selector that derives KnownGeoAnchor[] (with H3 indices) from
 * importedRefPoints. Replaces the closure-based `recomputeKnownRefPoints()`
 * in ref-point-handlers.ts.
 *
 * Uses createSelector (reselect) for standard RTK memoization — recomputes
 * only when the importedRefPoints array reference changes.
 */
export const selectCachedKnownRefPoints = createSelector(
  (state: RefPointsState) => state.importedRefPoints,
  (importedRefPoints): KnownGeoAnchor[] =>
    importedRefPoints.map((rp) => ({
      h3Index: gpsToH3(rp.lat, rp.lon),
      displayName: rp.name || rp.id,
      lat: rp.lat,
      lon: rp.lon,
    }))
);
