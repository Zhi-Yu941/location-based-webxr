/**
 * Failing-first tests for the `refPoints` selectors.
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
  addRefPointEntry,
  countEntriesByCellInSession,
  refPointsReducer,
  selectImportedKnownAnchors,
  selectKnownAnchorsByCell,
  selectRefPointEntries,
  setImportedRefPointEntries,
  type RefPointEntry,
  type RefPointsState,
} from './ref-points-slice';

function raw(lat: number, lon: number): RawGpsPoint {
  return {
    id: `gps-${lat}-${lon}`,
    latitude: lat,
    longitude: lon,
    altitude: 100,
    latLongAccuracy: 4,
    altitudeAccuracy: 3,
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

function withEntries(entries: RefPointEntry[]): RefPointsState {
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

describe('selectImportedKnownAnchors', () => {
  // Why this test matters: §A.6 Option C of the 2026-05-27 slice-collapse
  // plan requires a memoised selector that mirrors the legacy
  // `selectCachedKnownRefPoints` output by filtering V2 entries to the
  // sidecar imports (the `timestamp === 0` marker that
  // `loadAndDisplayRefPoints` writes via `setImportedRefPointEntries`).
  it('returns one KnownGeoAnchor per imported (timestamp===0) entry', () => {
    const state = withEntries([
      { ...importedA, timestamp: 0 },
      observationA, // timestamp > 0 — live observation, must be excluded
      { ...importedB, timestamp: 0 },
    ]);
    const anchors = selectImportedKnownAnchors(state);
    expect(anchors.map((a) => a.h3Index).sort()).toEqual([ID_A, ID_B].sort());
  });

  it('excludes entries with timestamp > 0 (live observations)', () => {
    const state = withEntries([observationA]);
    expect(selectImportedKnownAnchors(state)).toEqual([]);
  });

  it('uses the entry name (falling back to the H3 id) for displayName', () => {
    const state = withEntries([
      { ...importedA, timestamp: 0 },
      // imported entry without a name — surface the H3 id instead
      { ...importedB, timestamp: 0, name: undefined },
    ]);
    const anchors = selectImportedKnownAnchors(state);
    const a = anchors.find((x) => x.h3Index === ID_A);
    const b = anchors.find((x) => x.h3Index === ID_B);
    expect(a?.displayName).toBe('Bench Corner');
    expect(b?.displayName).toBe(ID_B);
  });

  it('surfaces lat/lon straight from the entry rawGpsPoint', () => {
    const state = withEntries([{ ...importedA, timestamp: 0 }]);
    const anchor = selectImportedKnownAnchors(state)[0];
    expect(anchor?.lat).toBeCloseTo(50.1, 3);
    expect(anchor?.lon).toBeCloseTo(6.1, 3);
  });

  it('memoises on the entries reference', () => {
    const state = withEntries([{ ...importedA, timestamp: 0 }]);
    expect(selectImportedKnownAnchors(state)).toBe(
      selectImportedKnownAnchors(state)
    );
  });

  it('returns a stable empty sentinel when no imports exist', () => {
    const a = selectImportedKnownAnchors(withEntries([]));
    const b = selectImportedKnownAnchors(withEntries([]));
    expect(a).toEqual([]);
    expect(a).toBe(b);
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

/**
 * Conflict rule (plan §A.2 / §B.5 5.5): the action log is canonical and
 * the OPFS sidecar is only a cache. At startup the sidecar is hydrated
 * first via `setImportedRefPointEntries` (which *replaces* the array),
 * then the current session's action log is replayed on top via
 * `addRefPointEntry`. When the two disagree for a given H3 cell, the
 * live observation from the action log must survive into the
 * post-startup state — it is the value the sidecar is later rewritten
 * from on the next mark.
 */
describe('conflict rule: sidecar vs action log', () => {
  const GPS_A = raw(50.1, 6.1); // sidecar cache value
  const GPS_B = raw(50.5, 6.5); // action-log (canonical) value

  function hydrateInStartupOrder(): RefPointsState {
    // 1. Sidecar fast-path: imported entry carries the `timestamp: 0`
    //    marker that folder-manager forces for cache entries.
    let state = refPointsReducer(
      undefined,
      setImportedRefPointEntries([
        { id: ID_A, timestamp: 0, name: 'Bench Corner', rawGpsPoint: GPS_A },
      ])
    );
    // 2. Action-log replay appends the live observation for the same cell.
    state = refPointsReducer(
      state,
      addRefPointEntry({ id: ID_A, timestamp: 1000, rawGpsPoint: GPS_B })
    );
    return state;
  }

  it('post-startup state contains the action-log GPS (gps: B)', () => {
    const entries = selectRefPointEntries(hydrateInStartupOrder());
    const observation = entries.find((e) => e.timestamp === 1000);
    expect(observation?.rawGpsPoint.latitude).toBe(GPS_B.latitude);
    expect(observation?.rawGpsPoint.longitude).toBe(GPS_B.longitude);
  });

  it('keeps the sidecar imported anchor distinguishable by its timestamp:0 marker', () => {
    const state = hydrateInStartupOrder();
    const imported = selectImportedKnownAnchors(state);
    // Only the sidecar entry (timestamp 0) is projected as an import;
    // the live observation is excluded.
    expect(imported).toHaveLength(1);
    expect(imported[0]?.lat).toBe(GPS_A.latitude);
  });

  it('replacing the array (sidecar after action log) would clobber the live observation — proving the documented order matters', () => {
    // Reverse order: action log first, then sidecar hydrate.
    let state = refPointsReducer(
      undefined,
      addRefPointEntry({ id: ID_A, timestamp: 1000, rawGpsPoint: GPS_B })
    );
    state = refPointsReducer(
      state,
      setImportedRefPointEntries([
        { id: ID_A, timestamp: 0, name: 'Bench Corner', rawGpsPoint: GPS_A },
      ])
    );
    const entries = selectRefPointEntries(state);
    // The live observation is gone — setImportedRefPointEntries replaced
    // the whole array. This is why the sidecar must hydrate FIRST.
    expect(entries.some((e) => e.timestamp === 1000)).toBe(false);
  });
});
