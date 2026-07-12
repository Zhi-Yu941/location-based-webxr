/**
 * Flat `refPoints` slice — the future single source of truth for
 * reference-point entries in the recorder app.
 *
 * Each `RefPointEntry` represents either:
 *  - a live observation (a "Capture" tap during recording / replay), or
 *  - an imported known landmark (from the OPFS sidecar fast-path).
 *
 * Multiple entries can share the same H3 cell `id`; grouping is a
 * selector concern (`selectKnownAnchorsByCell`).
 *
 * The slice is registered under a parallel root key (`refPoints`) so it
 * co-exists with the legacy `refPoints` slice until sub-step 5.7 collapses
 * the two. Until then the slice is **pure addition** — no consumer reads
 * from it yet.
 *
 * Plan: [2026-05-27-collapse-refpoint-and-frame-slices-plan.md §A.1, §B.5].
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSelector, createSlice } from '@reduxjs/toolkit';
import type { RawGpsPoint } from 'gps-plus-slam-app-framework/state';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';
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
   * Raw WebXR AR pose (odometry position) captured at mark-time. Optional
   * because imported sidecar entries and legacy recordings made before
   * this field landed carry no pose. Stored in the **raw WebXR** frame
   * (the action-stream convention); the recorder reducer / downstream
   * consumers apply `webxrToNUE` when they need NUE. The investigation
   * harness recomputes alignment from this pose, so for live marks it is
   * a load-bearing input (see
   * 2026-05-29-investigation-harness-refpoint-source-migration-plan.md §E).
   */
  position?: Vector3;
  /** Raw WebXR AR pose orientation captured at mark-time. Optional for the
   * same reasons as `position`. */
  rotation?: Quaternion;
  /**
   * Fused GPS snapshot derived at mark-time from the alignment matrix in
   * effect at that moment — a `RawGpsPoint`-shape with `latitude`,
   * `longitude`, and (optionally) `altitude` overridden by the fused
   * value. The only downstream consumer (visualizer) reads exactly those
   * three fields, so we store the slim raw shape rather than re-derive a
   * full state-side `GpsPoint`. Absent for imported entries and for
   * legacy entries replayed from recordings made before fused-at-mark-
   * time landed in Step 1 of the slice-collapse plan.
   */
  gpsPoint?: RawGpsPoint;
}

export interface RefPointsState {
  entries: RefPointEntry[];
}

const initialState: RefPointsState = {
  entries: [],
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const refPointsSlice = createSlice({
  name: 'refPoints',
  initialState,
  reducers: {
    addRefPointEntry(state, action: PayloadAction<RefPointEntry>) {
      // The pose fields are readonly tuples (`Vector3`/`Quaternion`), which
      // Immer's `Draft` widens to mutable tuples; assert to the draft's
      // element type to bridge that variance without pulling in `immer`
      // (not a direct dependency here).
      state.entries.push(action.payload as (typeof state.entries)[number]);
    },
    setImportedRefPointEntries(state, action: PayloadAction<RefPointEntry[]>) {
      state.entries = action.payload as typeof state.entries;
    },
    resetRefPoints() {
      return initialState;
    },
  },
});

export const { addRefPointEntry, setImportedRefPointEntries, resetRefPoints } =
  refPointsSlice.actions;

export const refPointsReducer = refPointsSlice.reducer;

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
  (state: RefPointsState) => state.entries,
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
  (state: RefPointsState) => state.entries,
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
 * Returns one `KnownGeoAnchor` per *imported* entry (those whose
 * `timestamp === 0` — the sidecar marker written by
 * `loadAndDisplayRefPoints` via `setImportedRefPointEntries`). Mirrors
 * the legacy `selectCachedKnownRefPoints` output so the §A.6 Option C
 * collapse of the parallel `refPoints` slice in
 * [2026-05-27-collapse-refpoint-and-frame-slices-plan.md] preserves the
 * imported-anchor projection as a documented derivation.
 *
 * Unlike `selectKnownAnchorsByCell`, this selector does **not** group by
 * H3 cell — duplicates in the imported list (rare) surface as separate
 * anchors. The proximity matcher uses `selectKnownAnchorsByCell` and is
 * unaffected.
 */
export const selectImportedKnownAnchors = createSelector(
  (state: RefPointsState) => state.entries,
  (entries): readonly KnownGeoAnchor[] => {
    const out: KnownGeoAnchor[] = [];
    for (const e of entries) {
      if (e.timestamp !== 0) continue;
      out.push({
        h3Index: e.id,
        displayName: e.name || e.id,
        lat: e.rawGpsPoint.latitude,
        lon: e.rawGpsPoint.longitude,
      });
    }
    return out.length === 0 ? EMPTY_ANCHORS : out;
  }
);

/**
 * Counts entries per H3 cell whose `timestamp` falls in the inclusive
 * range [start, end]. Useful for "what was added in this session".
 */
export function countEntriesByCellInSession(
  state: RefPointsState,
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
