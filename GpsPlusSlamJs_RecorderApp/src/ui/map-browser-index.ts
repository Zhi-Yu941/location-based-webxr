/**
 * Map-Browser Pure Logic — tile index, name filter, zoom→resolution.
 *
 * The heart of the map-centric recording browser, kept free of Leaflet/DOM so
 * it is fully unit-testable:
 *   - `leafletZoomToH3Res` picks the H3 clustering resolution for a map zoom.
 *   - `buildTileIndex` groups recordings into the H3 tiles their coverage
 *     clusters to at that resolution, so a tile click can list "which tours
 *     cross this tile?".
 *   - `matchesNameFilter` / `filterRecordingsByName` implement the D5 name
 *     search (case-insensitive substring over the zip filename).
 *
 * @see ./recording-index.ts for the per-recording coverage this consumes
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md (D3/D5)
 */

import { cellToLatLng, isValidCell } from 'h3-js';
import {
  H3_RESOLUTION,
  clusterCellsByZoom,
} from 'gps-plus-slam-app-framework/geo';
import type { RecordingCoverage } from './recording-index';

/**
 * Leaflet zoom at which the stored res-11 cells are drawn unclustered. Below
 * this, each step down in zoom coarsens the H3 resolution by one. Picked so the
 * finest tiles (~25 m) appear at the building-level zoom where they read well on
 * an OSM basemap; the exact alignment is approximate and intentionally simple.
 */
const FINEST_TILE_ZOOM = 16;

/**
 * Map a Leaflet zoom level to an H3 resolution for tile clustering.
 *
 * Higher zoom → finer resolution. The result is floored to an integer and
 * clamped to `[0, H3_RESOLUTION]`: `clusterCellsByZoom` throws for a finer
 * resolution than the stored data, and a non-finite zoom would otherwise
 * produce `NaN`, so a bad/missing zoom degrades to the coarsest resolution (0).
 */
export function leafletZoomToH3Res(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 0;
  }
  const res = Math.floor(zoom) - (FINEST_TILE_ZOOM - H3_RESOLUTION);
  return Math.max(0, Math.min(H3_RESOLUTION, res));
}

/** The H3 tiles at one resolution, mapped to the recordings that cross them. */
export interface TileIndex {
  /** The (clamped) H3 resolution all tile keys are at. */
  readonly res: number;
  /** Tile cell → recordings whose coverage includes that tile, in input order. */
  readonly tilesToRecordings: ReadonlyMap<string, RecordingCoverage[]>;
}

/**
 * Build the tile→recordings index for a set of recordings at a target H3
 * resolution (typically derived from the current Leaflet zoom via
 * `leafletZoomToH3Res`).
 *
 * Each recording's res-11 coverage cells are clustered to `targetRes` via
 * `clusterCellsByZoom` (which clamps and dedups), then the recording is added to
 * each resulting tile's list. A recording appears at most once per tile, and the
 * index's `res` is the clamped resolution actually used.
 */
export function buildTileIndex(
  recordings: readonly RecordingCoverage[],
  targetRes: number
): TileIndex {
  const tilesToRecordings = new Map<string, RecordingCoverage[]>();
  let res = Math.max(0, Math.min(H3_RESOLUTION, Math.floor(targetRes)));
  for (const recording of recordings) {
    const tiles = clusterCellsByZoom(recording.cells, targetRes);
    for (const tile of tiles) {
      const existing = tilesToRecordings.get(tile);
      if (existing) {
        existing.push(recording); // clusterCellsByZoom dedups, so no dup per rec
      } else {
        tilesToRecordings.set(tile, [recording]);
      }
    }
  }
  // Keep `res` consistent with clusterCellsByZoom's own clamping of NaN→max.
  if (!Number.isFinite(targetRes)) {
    res = H3_RESOLUTION;
  }
  return { res, tilesToRecordings };
}

/**
 * Collect the `[lat, lng]` coordinates of every coverage cell across the given
 * recordings, for framing the map to coverage (`fitToCoverage`).
 *
 * `RecordingCoverage.cells` are read verbatim from each recording's
 * `session.json` `h3Cells` field and are never validated upstream, so a
 * corrupt/tampered file can carry an invalid H3 index. `cellToLatLng` throws on
 * some such indices (e.g. an all-`f` hex string) and silently maps others to
 * bogus coordinates — both fail `isValidCell`. We therefore skip invalid cells,
 * mirroring `clusterCellsByZoom`'s own `isValidCell` guard, so one bad cell
 * neither crashes the fit nor drags the bounds to a bogus location.
 */
export function coverageCellLatLngs(
  recordings: readonly RecordingCoverage[]
): [number, number][] {
  const coords: [number, number][] = [];
  for (const recording of recordings) {
    for (const cell of recording.cells) {
      if (!isValidCell(cell)) {
        continue;
      }
      const [lat, lng] = cellToLatLng(cell);
      coords.push([lat, lng]);
    }
  }
  return coords;
}

/**
 * List the recordings that cross a given tile cell, or an empty array when the
 * tile is not in the index.
 */
export function toursAtTile(
  index: TileIndex,
  tileCell: string
): RecordingCoverage[] {
  return index.tilesToRecordings.get(tileCell) ?? [];
}

/**
 * Whether a recording filename matches a name-search query (D5): a
 * case-insensitive substring match. An empty / whitespace-only query matches
 * everything (no filtering).
 */
export function matchesNameFilter(filename: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return true;
  }
  return filename.toLowerCase().includes(q);
}

/**
 * Filter recordings to those whose filename matches the name-search query,
 * preserving input order. An empty query returns the input unchanged.
 */
export function filterRecordingsByName(
  recordings: readonly RecordingCoverage[],
  query: string
): RecordingCoverage[] {
  return recordings.filter((r) => matchesNameFilter(r.entry.filename, query));
}
