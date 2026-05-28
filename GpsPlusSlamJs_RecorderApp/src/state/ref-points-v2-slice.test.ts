/**
 * Failing-first tests for the new flat `refPointsV2` slice.
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
import type { GpsPoint, RawGpsPoint } from './recorder-store';
import {
  addRefPointEntry,
  refPointsV2Reducer,
  resetRefPoints,
  setImportedRefPointEntries,
  type RefPointEntry,
  type RefPointsV2State,
} from './ref-points-v2-slice';

const RAW: RawGpsPoint = {
  id: 'gps-1',
  latitude: 50.123,
  longitude: 6.789,
  altitude: 200,
  latLongAccuracy: 4,
  altitudeAccuracy: 3,
  compassAbsolute: false,
  timestamp: 1_700_000_000_000,
};

const FUSED: GpsPoint = {
  ...RAW,
  zeroRef: { latitude: 50.0, longitude: 6.0 },
  coordinates: [0, 0, 0],
  weight: 1,
};

const baseEntry: RefPointEntry = {
  id: '8a1fb46622dffff',
  timestamp: 1_700_000_000_000,
  rawGpsPoint: RAW,
  gpsPoint: FUSED,
};

describe('refPointsV2 slice — reducer', () => {
  it('starts with an empty entries array', () => {
    const state = refPointsV2Reducer(undefined, { type: '@@INIT' });
    expect(state.entries).toEqual([]);
  });

  it('addRefPointEntry appends a single entry', () => {
    const state = refPointsV2Reducer(undefined, addRefPointEntry(baseEntry));
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toEqual(baseEntry);
  });

  it('addRefPointEntry preserves insertion order for multiple entries with the same id', () => {
    let state = refPointsV2Reducer(undefined, addRefPointEntry(baseEntry));
    const second: RefPointEntry = {
      ...baseEntry,
      timestamp: baseEntry.timestamp + 1000,
    };
    state = refPointsV2Reducer(state, addRefPointEntry(second));
    expect(state.entries.map((e) => e.timestamp)).toEqual([
      baseEntry.timestamp,
      baseEntry.timestamp + 1000,
    ]);
  });

  it('setImportedRefPointEntries replaces the entries array wholesale', () => {
    let state = refPointsV2Reducer(undefined, addRefPointEntry(baseEntry));
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
    state = refPointsV2Reducer(state, setImportedRefPointEntries(imported));
    expect(state.entries).toEqual(imported);
  });

  it('resetRefPoints returns to the initial empty state', () => {
    const populated: RefPointsV2State = {
      entries: [baseEntry, { ...baseEntry, timestamp: 2 }],
    };
    const reset = refPointsV2Reducer(populated, resetRefPoints());
    expect(reset.entries).toEqual([]);
  });

  it('action types use the `refPointsV2/` namespace', () => {
    expect(addRefPointEntry(baseEntry).type).toBe(
      'refPointsV2/addRefPointEntry'
    );
    expect(setImportedRefPointEntries([]).type).toBe(
      'refPointsV2/setImportedRefPointEntries'
    );
    expect(resetRefPoints().type).toBe('refPointsV2/resetRefPoints');
  });
});
