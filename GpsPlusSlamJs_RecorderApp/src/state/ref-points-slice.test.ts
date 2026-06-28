/**
 * Failing-first tests for the new flat `refPoints` slice.
 *
 * Plan: [2026-05-27-collapse-refpoint-and-frame-slices-plan.md §B.5 5.1].
 * Reducer cases under test:
 *   - `addRefPointEntry` appends a single observation/imported entry
 *   - `setImportedRefPointEntries` replaces the entries array wholesale
 *     (used by the OPFS sidecar fast-path on startup)
 *   - `resetRefPoints` restores the initial empty state
 *
 * Why these matter: the slice is the future single source of truth for
 * ref points (recorder-only domain). Multiple entries per H3 cell `id`
 * are valid and grouping is a selector concern (see
 * `ref-points-v2-selectors.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import type { RawGpsPoint } from './recorder-store';
import {
  addRefPointEntry,
  refPointsReducer,
  resetRefPoints,
  setImportedRefPointEntries,
  type RefPointEntry,
  type RefPointsState,
} from './ref-points-slice';

const RAW: RawGpsPoint = {
  id: 'gps-1',
  latitude: 50.123,
  longitude: 6.789,
  altitude: 200,
  latLongAccuracy: 4,
  altitudeAccuracy: 3,
  timestamp: 1_700_000_000_000,
};

const FUSED: RawGpsPoint = {
  ...RAW,
  latitude: 50.124,
  longitude: 6.79,
};

const baseEntry: RefPointEntry = {
  id: '8a1fb46622dffff',
  timestamp: 1_700_000_000_000,
  rawGpsPoint: RAW,
  gpsPoint: FUSED,
};

describe('refPoints slice — reducer', () => {
  it('starts with an empty entries array', () => {
    const state = refPointsReducer(undefined, { type: '@@INIT' });
    expect(state.entries).toEqual([]);
  });

  it('addRefPointEntry appends a single entry', () => {
    const state = refPointsReducer(undefined, addRefPointEntry(baseEntry));
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toEqual(baseEntry);
  });

  it('addRefPointEntry preserves insertion order for multiple entries with the same id', () => {
    let state = refPointsReducer(undefined, addRefPointEntry(baseEntry));
    const second: RefPointEntry = {
      ...baseEntry,
      timestamp: baseEntry.timestamp + 1000,
    };
    state = refPointsReducer(state, addRefPointEntry(second));
    expect(state.entries.map((e) => e.timestamp)).toEqual([
      baseEntry.timestamp,
      baseEntry.timestamp + 1000,
    ]);
  });

  it('setImportedRefPointEntries replaces the entries array wholesale', () => {
    let state = refPointsReducer(undefined, addRefPointEntry(baseEntry));
    const imported: RefPointEntry[] = [
      {
        id: 'cell-a',
        timestamp: 1,
        name: 'Bench Corner',
        rawGpsPoint: RAW,
      },
      {
        id: 'cell-b',
        timestamp: 2,
        name: 'Front Door',
        rawGpsPoint: RAW,
      },
    ];
    state = refPointsReducer(state, setImportedRefPointEntries(imported));
    expect(state.entries).toEqual(imported);
  });

  it('resetRefPoints returns to the initial empty state', () => {
    const populated: RefPointsState = {
      entries: [baseEntry, { ...baseEntry, timestamp: 2 }],
    };
    const reset = refPointsReducer(populated, resetRefPoints());
    expect(reset.entries).toEqual([]);
  });

  it('action types use the `refPoints/` namespace', () => {
    expect(addRefPointEntry(baseEntry).type).toBe('refPoints/addRefPointEntry');
    expect(setImportedRefPointEntries([]).type).toBe(
      'refPoints/setImportedRefPointEntries'
    );
    expect(resetRefPoints().type).toBe('refPoints/resetRefPoints');
  });
});
