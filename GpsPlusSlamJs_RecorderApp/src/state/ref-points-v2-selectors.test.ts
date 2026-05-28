/**
 * Failing-first tests for the `refPointsV2` selectors.
 *
 * Plan: [2026-05-27-collapse-refpoint-and-frame-slices-plan.md §B.5 5.1].
 * Selectors under test:
 *   - `selectRefPointEntries` exposes the raw entries array.
 *   - `selectKnownAnchorsByCell` groups entries by H3 cell `id`, picks
 *     the first non-null `name` per cell (matches today's behaviour
 *     pinned by `aachen-recording-audit`), and surfaces `lat`/`lon`
 *     from a representative entry.
 *   - `countEntriesByCellInSession` returns a Map<id, count> filtered
 *     by inclusive [start, end] timestamp range.
 *
 * Memoisation is asserted via reference equality on the selector result.
 */

import { describe, it, expect } from 'vitest';
import type { RawGpsPoint } from './recorder-store';
import {
  countEntriesByCellInSession,
  selectKnownAnchorsByCell,
  selectRefPointEntries,
  type RefPointEntry,
  type RefPointsV2State,
} from './ref-points-v2-slice';

function raw(lat: number, lon: number): RawGpsPoint {
  return {
    id: `gps-${lat}-${lon}`,
    latitude: lat,
    longitude: lon,
    altitude: 100,
    latLongAccuracy: 4,
    altitudeAccuracy: 3,
    compassAbsolute: false,
    timestamp: 1_700_000_000_000,
  };
}

const ID_A = '8a1fb46622dffff';
const ID_B = '8a1fb46622d0fff';

const importedA: RefPointEntry = {
  id: ID_A,
  timestamp: 1,
  name: 'Bench Corner',
  rawGpsPoint: raw(50.1, 6.1),
};
const observationA: RefPointEntry = {
  id: ID_A,
  timestamp: 1000,
  rawGpsPoint: raw(50.1001, 6.1001),
};
const importedB: RefPointEntry = {
  id: ID_B,
  timestamp: 2,
  name: 'Front Door',
  rawGpsPoint: raw(50.2, 6.2),
};

function withEntries(entries: RefPointEntry[]): RefPointsV2State {
  return { entries };
}

describe('selectRefPointEntries', () => {
  it('returns the raw entries array', () => {
    const state = withEntries([importedA, observationA, importedB]);
    expect(selectRefPointEntries(state)).toEqual([
      importedA,
      observationA,
      importedB,
    ]);
  });

  it('returns a stable empty array sentinel when there are no entries', () => {
    const a = selectRefPointEntries(withEntries([]));
    const b = selectRefPointEntries(withEntries([]));
    expect(a).toEqual([]);
    // Empty-state sentinel keeps reselect-based subscribers from
    // re-rendering on unrelated dispatches.
    expect(a).toBe(b);
  });
});

describe('selectKnownAnchorsByCell', () => {
  it('groups entries by H3 cell id (one anchor per cell)', () => {
    const state = withEntries([importedA, observationA, importedB]);
    const anchors = selectKnownAnchorsByCell(state);
    const ids = anchors.map((a) => a.h3Index).sort();
    expect(ids).toEqual([ID_A, ID_B].sort());
  });

  it('picks the first non-null name per cell', () => {
    const state = withEntries([
      // observation arrives first, has no name
      observationA,
      // imported entry arrives later but carries the human-readable name
      importedA,
    ]);
    const anchors = selectKnownAnchorsByCell(state);
    const cellA = anchors.find((a) => a.h3Index === ID_A);
    expect(cellA?.displayName).toBe('Bench Corner');
  });

  it('falls back to the H3 id when no entry has a name', () => {
    const state = withEntries([observationA]);
    const anchors = selectKnownAnchorsByCell(state);
    expect(anchors[0]?.displayName).toBe(ID_A);
  });

  it('memoises on the entries reference', () => {
    const state = withEntries([importedA, observationA]);
    const a = selectKnownAnchorsByCell(state);
    const b = selectKnownAnchorsByCell(state);
    expect(a).toBe(b);
  });

  it('surfaces lat/lon from one of the entries in the cell', () => {
    const state = withEntries([importedA, observationA]);
    const anchor = selectKnownAnchorsByCell(state).find(
      (a) => a.h3Index === ID_A
    );
    expect(anchor?.lat).toBeCloseTo(50.1, 3);
    expect(anchor?.lon).toBeCloseTo(6.1, 3);
  });
});

describe('countEntriesByCellInSession', () => {
  it('counts entries whose timestamp falls in [start, end]', () => {
    const state = withEntries([
      { ...importedA, timestamp: 100 },
      { ...observationA, timestamp: 500 },
      { ...observationA, timestamp: 1500 },
      { ...importedB, timestamp: 600 },
    ]);
    const counts = countEntriesByCellInSession(state, 400, 1000);
    expect(counts.get(ID_A)).toBe(1);
    expect(counts.get(ID_B)).toBe(1);
  });

  it('excludes entries before start and after end', () => {
    const state = withEntries([
      { ...importedA, timestamp: 100 },
      { ...observationA, timestamp: 2000 },
    ]);
    const counts = countEntriesByCellInSession(state, 400, 1000);
    expect(counts.size).toBe(0);
  });

  it('boundaries are inclusive', () => {
    const state = withEntries([
      { ...importedA, timestamp: 400 },
      { ...observationA, timestamp: 1000 },
    ]);
    const counts = countEntriesByCellInSession(state, 400, 1000);
    expect(counts.get(ID_A)).toBe(2);
  });
});
