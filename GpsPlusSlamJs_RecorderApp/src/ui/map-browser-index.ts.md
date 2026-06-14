# map-browser-index.ts

## Purpose

Pure logic for the map-centric recording browser, kept free of Leaflet/DOM so it is fully unit-testable. Decides the H3 clustering resolution for a map zoom, groups recordings into the tiles they cross, answers "which tours cross this tile?", and applies the D5 name-search filter. The Leaflet wiring on top (`map-browser.ts`) is thin and covered by Playwright e2e.

See the plan: `GpsPlusSlamJs_Docs/docs/2026-06-14-map-centric-recording-browser-and-h3-index-user-feedback.md` (D3 tile selection, D5 name search).

## Public API

- `leafletZoomToH3Res(zoom): number` — map a Leaflet zoom to an H3 resolution for clustering. Floored, clamped to `[0, H3_RESOLUTION]`; a non-finite zoom degrades to the coarsest resolution (0). Monotonic non-decreasing in zoom (finer tiles as you zoom in).
- `TileIndex` (interface) — `{ res: number; tilesToRecordings: ReadonlyMap<string, RecordingCoverage[]> }`. `res` is the clamped resolution all tile keys are at.
- `buildTileIndex(recordings, targetRes): TileIndex` — cluster each recording's res-11 coverage to `targetRes` (via `clusterCellsByZoom`) and group recordings by tile. A recording appears at most once per tile.
- `toursAtTile(index, tileCell): RecordingCoverage[]` — recordings crossing a tile, or `[]` for an unknown tile.
- `matchesNameFilter(filename, query): boolean` — case-insensitive substring match; empty/whitespace query matches everything.
- `filterRecordingsByName(recordings, query): RecordingCoverage[]` — order-preserving subset of recordings whose filename matches.

## Invariants & assumptions

- **Clustering uses `cellToParent` (via `clusterCellsByZoom`), never hex-string truncation** — see `geo/h3-proximity.ts` (D1). `buildTileIndex` therefore inherits the `[0, 11]` clamp and the `NaN → max res` (unclustered) behaviour; its `res` field reflects the clamped resolution actually used.
- Tile membership is sound: every recording listed under a tile genuinely clusters to that tile, and every covered tile of every recording is indexed (asserted by property tests).
- The name filter is a stable subset operation: empty query is the identity; a non-empty query keeps an order-preserving subsequence.

## Examples

```ts
const res = leafletZoomToH3Res(map.getZoom());
const index = buildTileIndex(recordings, res);
// On tile click:
const tours = toursAtTile(index, clickedTileCell);
// On search input:
const visible = filterRecordingsByName(recordings, searchQuery);
```

## Tests

- `map-browser-index.test.ts` — worked examples for zoom→res clamping/monotonicity, tile grouping + shared-tile membership, resolution clamping, name-filter case-insensitivity and exact-filename narrowing.
- `map-browser-index.property.test.ts` — invariants over generated recordings/zooms: zoom→res integer/clamped/monotonic; tile keys valid + membership sound + no double-count + completeness; name filter is an order-preserving subset with empty-query identity.
