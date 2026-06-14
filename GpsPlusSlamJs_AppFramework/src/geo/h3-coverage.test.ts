/**
 * H3 Coverage-Index Tests
 *
 * Why these tests matter:
 * The map-centric recording browser stores, per tour, the deduplicated set of
 * res-11 H3 cells its GPS path crossed (the "coverage index"), and the map view
 * coarsens those cells per zoom level to draw clustered tiles. Two invariants
 * are load-bearing and easy to get wrong:
 *   1. Zoom-clustering MUST use h3-js `cellToParent`, NEVER hex-string
 *      truncation (resolution lives in the high bits; slicing yields INVALID
 *      cells, not parents). This is the D1 gotcha from
 *      docs/2026-06-14-map-centric-recording-browser-and-h3-index-user-feedback.md.
 *   2. `cellToParent` only coarsens — asking for a finer res than the stored
 *      cell throws — so the clustering helper must clamp `targetRes` to
 *      [0, H3_RESOLUTION].
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-map-centric-recording-browser-and-h3-index-user-feedback.md (D1)
 */

import { describe, it, expect } from 'vitest';
import { cellToParent, gridDisk, isValidCell } from 'h3-js';
import {
  gpsPathToCoverageCells,
  clusterCellsByZoom,
  gpsToH3,
  H3_RESOLUTION,
} from './h3-proximity';

// ============================================================================
// gpsPathToCoverageCells — path → deduped res-11 cell set
// ============================================================================

describe('gpsPathToCoverageCells', () => {
  // Why: An empty path has no coverage. Must not throw.
  it('returns an empty array for an empty path', () => {
    expect(gpsPathToCoverageCells([])).toEqual([]);
  });

  // Why: A single fix maps to exactly its res-11 cell.
  it('maps a single point to its res-11 cell', () => {
    const cells = gpsPathToCoverageCells([{ lat: 50.7475, lng: 6.4812 }]);
    expect(cells).toEqual([gpsToH3(50.7475, 6.4812)]);
  });

  // Why: A tour that dwells in one spot (many fixes in the same ~25m cell)
  // must contribute exactly one cell — dedup keeps session.json small (D1 risk).
  it('deduplicates many fixes that fall in the same cell', () => {
    const path = Array.from({ length: 50 }, (_, i) => ({
      lat: 50.7475 + i * 1e-7, // sub-metre jitter, same res-11 cell
      lng: 6.4812,
    }));
    const cells = gpsPathToCoverageCells(path);
    expect(cells).toHaveLength(1);
    expect(isValidCell(cells[0])).toBe(true);
  });

  // Why: Distinct, far-apart fixes produce distinct valid cells, returned in
  // first-seen (chronological) order so the index mirrors the walked path.
  it('returns distinct cells in first-seen order for a moving path', () => {
    const path = [
      { lat: 50.7495, lng: 6.4793 },
      { lat: 50.7475, lng: 6.4812 },
      { lat: 50.7451, lng: 6.4804 },
    ];
    const cells = gpsPathToCoverageCells(path);
    expect(cells).toEqual(path.map((p) => gpsToH3(p.lat, p.lng)));
    expect(cells.every((c) => isValidCell(c))).toBe(true);
    expect(new Set(cells).size).toBe(3);
  });

  // Why: A revisited cell must not be re-appended — first-seen order is kept.
  it('keeps first-seen order when a cell is revisited', () => {
    const a = { lat: 50.7495, lng: 6.4793 };
    const b = { lat: 50.7451, lng: 6.4804 };
    const cells = gpsPathToCoverageCells([a, b, a]);
    expect(cells).toEqual([gpsToH3(a.lat, a.lng), gpsToH3(b.lat, b.lng)]);
  });

  // Why: Sensor data is not trusted — non-finite coords must be skipped, not
  // crash latLngToCell (defensive boundary per CLAUDE.md).
  it('skips non-finite coordinates defensively', () => {
    const path = [
      { lat: Number.NaN, lng: 6.4812 },
      { lat: 50.7475, lng: Number.POSITIVE_INFINITY },
      { lat: 50.7475, lng: 6.4812 },
    ];
    expect(gpsPathToCoverageCells(path)).toEqual([gpsToH3(50.7475, 6.4812)]);
  });
});

// ============================================================================
// clusterCellsByZoom — coarsen res-11 cells for map zoom
// ============================================================================

describe('clusterCellsByZoom', () => {
  const base = gpsToH3(50.7475, 6.4812); // res-11 cell

  // Why (D1 regression guard): clustering MUST be cellToParent, NOT string
  // truncation. Truncating the 15-char id to 9 chars yields an INVALID cell;
  // cellToParent yields a real, valid res-9 parent. This test fails loudly if
  // anyone "optimizes" clustering into a slice().
  it('coarsens via cellToParent, never hex-string truncation', () => {
    const clustered = clusterCellsByZoom([base], 9);
    expect(clustered).toEqual([cellToParent(base, 9)]);
    expect(isValidCell(clustered[0])).toBe(true);

    const truncated = base.slice(0, 9);
    expect(clustered[0]).not.toBe(truncated);
    expect(isValidCell(truncated)).toBe(false); // truncation is invalid
  });

  // Why: cellToParent throws when asked for a FINER res than the cell. The
  // helper must clamp targetRes to H3_RESOLUTION so the highest map zooms
  // render the stored cells unclustered (cellToParent(cell, 11) === cell).
  it('clamps targetRes > H3_RESOLUTION to the stored cells (no throw)', () => {
    expect(() => clusterCellsByZoom([base], H3_RESOLUTION + 5)).not.toThrow();
    expect(clusterCellsByZoom([base], H3_RESOLUTION + 5)).toEqual([base]);
    expect(clusterCellsByZoom([base], H3_RESOLUTION)).toEqual([base]);
  });

  // Why: Two distinct res-11 cells sharing a res-9 parent must collapse to a
  // single tile when clustered — that is the whole point of zoom-clustering.
  it('merges sibling cells that share a parent', () => {
    const parent9 = cellToParent(base, 9);
    const sibling = gridDisk(base, 2).find(
      (c) => c !== base && cellToParent(c, 9) === parent9
    );
    expect(
      sibling,
      'expected a res-11 sibling under the same res-9 parent'
    ).toBeDefined();
    const clustered = clusterCellsByZoom([base, sibling!], 9);
    expect(clustered).toEqual([parent9]);
  });

  // Why: Coarser (lower res) clustering can only merge, never split — fewer or
  // equal tiles than a finer res over the same cells.
  it('produces fewer-or-equal tiles at coarser resolutions', () => {
    const cells = gpsPathToCoverageCells([
      { lat: 50.7495, lng: 6.4793 },
      { lat: 50.7475, lng: 6.4812 },
      { lat: 50.7462, lng: 6.4811 },
      { lat: 50.7451, lng: 6.4804 },
    ]);
    const fine = clusterCellsByZoom(cells, 10);
    const coarse = clusterCellsByZoom(cells, 6);
    expect(coarse.length).toBeLessThanOrEqual(fine.length);
  });

  // Why: Empty input is a no-op.
  it('returns an empty array for empty input', () => {
    expect(clusterCellsByZoom([], 7)).toEqual([]);
  });

  // Why: A non-finite targetRes (e.g. a bad zoom→res mapping) must degrade to
  // unclustered output rather than throwing inside cellToParent.
  it('treats a non-finite targetRes as unclustered', () => {
    expect(clusterCellsByZoom([base], Number.NaN)).toEqual([base]);
  });

  // Why: Invalid stored cells (corrupt/legacy metadata) must be skipped, not
  // crash the whole view render (defensive boundary).
  it('skips invalid cells defensively', () => {
    expect(clusterCellsByZoom(['not-a-cell', base], 9)).toEqual([
      cellToParent(base, 9),
    ]);
  });

  // Why: A *valid* cell coarser than targetRes (e.g. a res-8 cell from legacy or
  // future metadata) cannot have a parent at the finer targetRes — cellToParent
  // throws ("incompatible resolutions"). isValidCell does NOT catch this, and the
  // targetRes clamp only bounds the requested res, not the cell's own res. Such
  // cells must be skipped, not crash the whole view render (defensive boundary).
  it('skips valid cells coarser than targetRes (no throw)', () => {
    const coarse = cellToParent(base, 8); // valid res-8 cell
    expect(() =>
      clusterCellsByZoom([coarse, base], H3_RESOLUTION)
    ).not.toThrow();
    // base is already res-11 so it survives at targetRes 11; coarse is dropped.
    expect(clusterCellsByZoom([coarse, base], H3_RESOLUTION)).toEqual([base]);
  });
});
