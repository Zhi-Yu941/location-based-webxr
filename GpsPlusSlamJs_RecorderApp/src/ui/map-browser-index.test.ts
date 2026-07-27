/**
 * Tests for the map-browser pure logic (tile index, name filter, zoom→res).
 *
 * Why this matters:
 * These pure functions are the heart of the map-centric recording browser:
 * they decide which H3 resolution to cluster at for a given Leaflet zoom, group
 * recordings into the tiles they cross, answer "which tours cross this tile?",
 * and apply the name-search filter. Keeping them pure (no Leaflet, no DOM) makes
 * the load-bearing logic fully unit-testable; the Leaflet wiring on top is thin
 * and covered by Playwright e2e.
 *
 * @see ./map-browser-index.ts
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md (D3/D5)
 */

import { describe, it, expect } from 'vitest';
import { cellToParent, cellToLatLng, isValidCell } from 'h3-js';
import {
  H3_RESOLUTION,
  gpsPathToCoverageCells,
} from 'gps-plus-slam-app-framework/geo';
import {
  leafletZoomToH3Res,
  buildTileIndex,
  toursAtTile,
  matchesNameFilter,
  filterRecordingsByName,
  coverageCellLatLngs,
} from './map-browser-index';
import type { RecordingCoverage } from './recording-index';

/** Build a RecordingCoverage from an explicit (possibly invalid) cell list. */
function recWithCells(filename: string, cells: string[]): RecordingCoverage {
  return {
    entry: {
      filename,
      fileHandle: {} as unknown as FileSystemFileHandle,
      date: null,
      h3Cells: cells,
    },
    scenario: 'S',
    cells,
    backfilled: false,
  };
}

/** Build a minimal RecordingCoverage from a filename and a GPS path. */
function rec(
  filename: string,
  path: { lat: number; lng: number }[]
): RecordingCoverage {
  return {
    entry: {
      filename,
      fileHandle: {} as unknown as FileSystemFileHandle,
      date: null,
      h3Cells: gpsPathToCoverageCells(path),
    },
    scenario: 'S',
    cells: gpsPathToCoverageCells(path),
    backfilled: false,
  };
}

// Three Aachen-area points known (from h3-coverage tests) to be distinct res-11
// cells; far enough apart to stay distinct at moderate clustering.
const A = { lat: 50.7495, lng: 6.4793 };
const B = { lat: 50.7475, lng: 6.4812 };
const C = { lat: 50.7451, lng: 6.4804 };

describe('leafletZoomToH3Res', () => {
  it('clamps to the [0, H3_RESOLUTION] range', () => {
    expect(leafletZoomToH3Res(-100)).toBe(0);
    expect(leafletZoomToH3Res(0)).toBe(0);
    expect(leafletZoomToH3Res(100)).toBe(H3_RESOLUTION);
  });

  it('never asks for a finer resolution than the stored data', () => {
    for (let z = 0; z <= 25; z++) {
      const res = leafletZoomToH3Res(z);
      expect(res).toBeGreaterThanOrEqual(0);
      expect(res).toBeLessThanOrEqual(H3_RESOLUTION);
      expect(Number.isInteger(res)).toBe(true);
    }
  });

  it('is monotonic non-decreasing in zoom (finer tiles as you zoom in)', () => {
    let prev = -1;
    for (let z = 0; z <= 25; z++) {
      const res = leafletZoomToH3Res(z);
      expect(res).toBeGreaterThanOrEqual(prev);
      prev = res;
    }
  });

  it('degrades a non-finite zoom to the coarsest resolution', () => {
    // Why: a bad/missing map zoom must not produce NaN res (which would throw
    // inside cellToParent). Coarsest (0) is the safe default.
    expect(leafletZoomToH3Res(Number.NaN)).toBe(0);
  });
});

describe('buildTileIndex', () => {
  it('groups recordings into the tiles their coverage clusters to', () => {
    // At res 11 (no clustering) each recording occupies exactly its own cells.
    const rA = rec('tour-a.zip', [A, B]);
    const rB = rec('tour-b.zip', [B, C]);
    const index = buildTileIndex([rA, rB], H3_RESOLUTION);

    expect(index.res).toBe(H3_RESOLUTION);
    // B is shared by both recordings.
    const bCell = rA.cells[1]!; // gpsToH3(B)
    expect(toursAtTile(index, bCell)).toEqual([rA, rB]);
    // A is unique to rA.
    const aCell = rA.cells[0]!;
    expect(toursAtTile(index, aCell)).toEqual([rA]);
  });

  it('clusters cells to the target resolution and dedups per recording', () => {
    const rA = rec('tour-a.zip', [A, B, C]);
    const index = buildTileIndex([rA], 5);
    expect(index.res).toBe(5);
    // Every tile key is a valid res-5 cell that is the parent of one of rA's
    // res-11 cells, and rA appears at most once per tile.
    for (const [tile, recs] of index.tilesToRecordings) {
      expect(isValidCell(tile)).toBe(true);
      expect(recs.filter((r) => r === rA)).toHaveLength(1);
      const parents = new Set(rA.cells.map((c) => cellToParent(c, 5)));
      expect(parents.has(tile)).toBe(true);
    }
  });

  it('clamps the target resolution like the clustering helper', () => {
    const rA = rec('tour-a.zip', [A]);
    const index = buildTileIndex([rA], H3_RESOLUTION + 9);
    expect(index.res).toBe(H3_RESOLUTION);
  });

  it('returns an empty index for no recordings', () => {
    const index = buildTileIndex([], 7);
    expect(index.tilesToRecordings.size).toBe(0);
  });

  it('treats a non-finite target resolution as unclustered (res 11)', () => {
    // Why: a bad zoom→res mapping must mirror clusterCellsByZoom (NaN → max res),
    // drawing the stored res-11 cells rather than throwing.
    const rA = rec('a.zip', [A, B]);
    const index = buildTileIndex([rA], Number.NaN);
    expect(index.res).toBe(H3_RESOLUTION);
    expect([...index.tilesToRecordings.keys()].sort()).toEqual(
      [...rA.cells].sort()
    );
  });

  it('toursAtTile returns an empty array for an unknown tile', () => {
    const index = buildTileIndex([rec('a.zip', [A])], H3_RESOLUTION);
    expect(toursAtTile(index, 'nope')).toEqual([]);
  });
});

describe('coverageCellLatLngs', () => {
  // A 16-hex-digit string that parses as an H3 index but is NOT a valid cell.
  // h3-js's cellToLatLng THROWS on this (code 5), unlike non-hex garbage which
  // it silently maps to bogus coordinates — both have isValidCell === false.
  const THROWING_INVALID_CELL = 'ffffffffffffffff';

  /**
   * Why this matters: `RecordingCoverage.cells` are read VERBATIM from a
   * recording's `session.json` `h3Cells` field (`loadCoverageCellsForEntry`)
   * and are never validated as real H3 indices. A corrupt/tampered file can
   * therefore put an arbitrary string into `cells`, and `cellToLatLng` THROWS
   * on such an index — this asserts that underlying hazard so the guard below
   * has a documented reason to exist.
   */
  it('cellToLatLng throws on an invalid cell (the hazard being guarded)', () => {
    expect(isValidCell(THROWING_INVALID_CELL)).toBe(false);
    expect(() => cellToLatLng(THROWING_INVALID_CELL)).toThrow();
  });

  it('skips invalid cells instead of throwing, mirroring clusterCellsByZoom', () => {
    const validCell = gpsPathToCoverageCells([A])[0]!;
    const recording = recWithCells('corrupt.zip', [
      THROWING_INVALID_CELL,
      validCell,
    ]);

    // Without the isValidCell skip this would throw (proven above) and crash
    // the whole map browser's fit-to-coverage. It must instead drop the bad
    // cell and still frame to the valid one.
    const coords = coverageCellLatLngs([recording]);

    const [lat, lng] = cellToLatLng(validCell);
    expect(coords).toEqual([[lat, lng]]);
  });

  it('collects the coordinates of every valid cell across all recordings', () => {
    const recs = [rec('a.zip', [A, B]), rec('b.zip', [C])];
    const coords = coverageCellLatLngs(recs);
    const expected = [...recs[0]!.cells, ...recs[1]!.cells].map((c) =>
      cellToLatLng(c)
    );
    expect(coords).toEqual(expected);
  });

  it('returns an empty array when no recording carries cells', () => {
    expect(coverageCellLatLngs([recWithCells('empty.zip', [])])).toEqual([]);
  });
});

describe('matchesNameFilter', () => {
  it('matches everything for an empty / whitespace query', () => {
    expect(matchesNameFilter('anything.zip', '')).toBe(true);
    expect(matchesNameFilter('anything.zip', '   ')).toBe(true);
  });

  it('is a case-insensitive substring match', () => {
    expect(matchesNameFilter('Paris-session-2026.zip', 'paris')).toBe(true);
    expect(matchesNameFilter('Paris-session-2026.zip', 'SESSION')).toBe(true);
    expect(matchesNameFilter('Paris-session-2026.zip', 'tokyo')).toBe(false);
  });

  it('narrows to a single recording for an exact filename', () => {
    const name = '2026-03-01_09-08-48utc.zip';
    expect(matchesNameFilter(name, name)).toBe(true);
    expect(matchesNameFilter('other.zip', name)).toBe(false);
  });
});

describe('filterRecordingsByName', () => {
  const recs = [
    rec('Paris-session-2026.zip', [A]),
    rec('Tokyo-session-2026.zip', [B]),
    rec('paris-extra.zip', [C]),
  ];

  it('returns all recordings for an empty query', () => {
    expect(filterRecordingsByName(recs, '')).toEqual(recs);
  });

  it('keeps only recordings whose filename matches (case-insensitive)', () => {
    const filtered = filterRecordingsByName(recs, 'paris');
    expect(filtered.map((r) => r.entry.filename)).toEqual([
      'Paris-session-2026.zip',
      'paris-extra.zip',
    ]);
  });
});
