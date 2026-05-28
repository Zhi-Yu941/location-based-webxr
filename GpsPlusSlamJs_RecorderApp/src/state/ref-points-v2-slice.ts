/**
 * Flat `refPointsV2` slice — the future single source of truth for
 * reference-point entries in the recorder app.
 *
 * Each `RefPointEntry` represents either:
 *  - a live observation (a "Capture" tap during recording / replay), or
 *  - an imported known landmark (from the OPFS sidecar fast-path).
 *
 * Multiple entries can share the same H3 cell `id`; grouping is a
 * selector concern (`selectKnownAnchorsByCell`).
 *
 * The slice is registered under a parallel root key (`refPointsV2`) so it
 * co-exists with the legacy `refPoints` slice until sub-step 5.7 collapses
 * the two. Until then the slice is **pure addition** — no consumer reads
 * from it yet.
 *
 * Plan: [2026-05-27-collapse-refpoint-and-frame-slices-plan.md §A.1, §B.5].
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSelector, createSlice } from '@reduxjs/toolkit';
import type { GpsPoint, RawGpsPoint } from './recorder-store';
import { type KnownGeoAnchor } from 'gps-plus-slam-app-framework/geo/h3-proximity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefPointEntry {
  /** H3 cell id at the recording's resolution. */
  id: string;
  /** Epoch ms when this entry was created or observed. */
  timestamp: number;
  /** Human-readable label, propagated from imported list (when present). */
  name?: string;
  /** Raw GPS sample at mark-time. Always present. */
  rawGpsPoint: RawGpsPoint;
  /**
   * Fused GPS snapshot derived at mark-time from the alignment matrix in
   * effect at that moment. Absent for imported entries and for legacy
   * entries replayed from recordings made before fused-at-mark-time
   * landed in Step 1 of the slice-collapse plan.
   */
  gpsPoint?: GpsPoint;
}

export interface RefPointsV2State {
  entries: RefPointEntry[];
}

const initialState: RefPointsV2State = {
  entries: [],
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const refPointsV2Slice = createSlice({
  name: 'refPointsV2',
  initialState,
  reducers: {
    // `RefPointEntry` contains readonly tuple shapes (Vector3 in `GpsPoint`)
    // that Immer's WritableNonArrayDraft refuses to widen. The slice only
    // ever replaces or appends entries — never mutates them in-place — so a
    // structural cast on `state.entries` is sound. Same pattern as the
    // legacy `refPoints` slice (`setPriorRefPointMarks`).
    addRefPointEntry(state, action: PayloadAction<RefPointEntry>) {
      (state as { entries: RefPointEntry[] }).entries.push(action.payload);
    },
    setImportedRefPointEntries(
      state,
      action: PayloadAction<RefPointEntry[]>
    ) {
      (state as { entries: RefPointEntry[] }).entries = action.payload;
    },
    resetRefPoints() {
      return initialState;
    },
  },
});

export const { addRefPointEntry, setImportedRefPointEntries, resetRefPoints } =
  refPointsV2Slice.actions;

export const refPointsV2Reducer = refPointsV2Slice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const EMPTY_ENTRIES: readonly RefPointEntry[] = Object.freeze([]);

/**
 * Returns the flat entries array. When the slice is empty a stable
 * sentinel is returned so reselect-based subscribers don't re-render on
 * unrelated dispatches.
 */
export const selectRefPointEntries = createSelector(
  (state: RefPointsV2State) => state.entries,
  (entries): readonly RefPointEntry[] =>
    entries.length === 0 ? EMPTY_ENTRIES : entries
);

/**
 * Groups entries by H3 cell `id` and returns one `KnownGeoAnchor` per
 * cell. `displayName` is the first non-null `name` seen for that cell;
 * `lat`/`lon` come from the first entry encountered (used only for
 * distance ranking in `findNearbyGeoAnchor`).
 */
export const selectKnownAnchorsByCell = createSelector(
  (state: RefPointsV2State) => state.entries,
  (entries): readonly KnownGeoAnchor[] => {
    if (entries.length === 0) return EMPTY_ANCHORS;
    const byId = new Map<
      string,
      { lat: number; lon: number; name: string | undefined }
    >();
    for (const e of entries) {
      const existing = byId.get(e.id);
      if (existing) {
        if (!existing.name && e.name) existing.name = e.name;
      } else {
        byId.set(e.id, {
          lat: e.rawGpsPoint.latitude,
          lon: e.rawGpsPoint.longitude,
          name: e.name,
        });
      }
    }
    const out: KnownGeoAnchor[] = [];
    for (const [id, v] of byId) {
      out.push({
        h3Index: id,
        displayName: v.name || id,
        lat: v.lat,
        lon: v.lon,
      });
    }
    return out;
  }
);

const EMPTY_ANCHORS: readonly KnownGeoAnchor[] = Object.freeze([]);

/**
 * Counts entries per H3 cell whose `timestamp` falls in the inclusive
 * range [start, end]. Useful for "what was added in this session".
 */
export function countEntriesByCellInSession(
  state: RefPointsV2State,
  start: number,
  end: number
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of state.entries) {
    if (e.timestamp < start || e.timestamp > end) continue;
    counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  }
  return counts;
}
