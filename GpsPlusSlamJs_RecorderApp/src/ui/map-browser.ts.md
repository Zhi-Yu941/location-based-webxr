# map-browser.ts

## Purpose

The map-centric recording browser: a **full-bleed Leaflet map with floating overlay panels** (D3a) that lets the user find recordings spatially and replay one. H3 coverage tiles are drawn from each recording's coverage cells (clustered to the current zoom); clicking a tile lists the tours crossing it, and clicking a tour starts single-tour playback (D3).

This is the thin Leaflet/DOM layer over the pure, unit-tested `map-browser-index.ts`. It is covered by Playwright e2e (`playwright-tests/map-browser.spec.js`), per the repo convention that Leaflet views are e2e- not unit-tested.

See the plan: `GpsPlusSlamJs_Docs/docs/2026-06-14-map-centric-recording-browser-and-h3-index-user-feedback.md` (D3 selection, D3a layout, D5 name search).

## Public API

- `MapBrowserOptions` — `{ recordings?: readonly RecordingCoverage[]; onPlayTour: (r) => void; onClose?: () => void; onBackfill?: () => Promise<BackfillResult> }`. `recordings` is **optional** (defaults to empty) so the progressive flow can mount the browser before any coverage exists and stream it in. `onBackfill` opts the browser into the one-time in-zip coverage backfill (Slice B / B1).
- `createMapBrowser(container, options): MapBrowserInstance | null` — mounts the browser inside `container` (which the app gives `fixed inset-0`). Returns `null` if Leaflet init fails.
- `MapBrowserInstance` — `{ destroy(); getRes(); getRenderedTiles(); selectTile(cell | null); setNameQuery(query); addRecording(rec); setIndexingProgress(done, total) }`. The getters/`selectTile` exist primarily so e2e can drive tile selection without brittle SVG hit-testing.
  - `addRecording(rec)` — append a recording and re-render. Re-renders are **coalesced to one per animation frame** (`requestAnimationFrame`) so streaming a folder does not rebuild every Leaflet polygon per add.
  - `setIndexingProgress(done, total)` — drive the progress pill (`data-testid=map-browser-progress`): a spinner + "Indexing done / total…" while `done < total`, then a brief "N recordings" confirmation that auto-hides after `PROGRESS_DONE_LINGER_MS` (the durable-end-state rule). `total <= 0` hides it immediately. Reaching `done >= total` also marks indexing complete, which reveals the backfill CTA when applicable.

## Backfill CTA (B1 — Slice B opt-in)

When `onBackfill` is provided AND legacy recordings carrying coverage have streamed in (`backfilled && cells.length > 0`), a bottom-center **"Speed up future loads — embed coverage in N recordings"** button (`data-testid=map-browser-backfill`) appears **once indexing completes** (never before — the full set must be known). It is never automatic; the click is the user gesture the `readwrite` permission upgrade needs. Click flow (async-UX rule — transitional + durable final state):

- disables + shows "Embedding…" while `onBackfill()` is in flight;
- on `permissionDenied` → re-enables with "Write access denied — tap to retry" (degrade, allow retry);
- on success → "Embedded N ✓" (or "Embedded N, M failed") then auto-hides after `PROGRESS_DONE_LINGER_MS`;
- on throw → re-enables with "Upgrade failed — tap to retry".

The actual rewrite + permission + per-file safety live in `storage/coverage-backfill.ts`; this component only renders the CTA and its states. The caller (`launchMapBrowser` in [map-browser-launcher.ts](map-browser-launcher.ts.md), extracted from `main.ts` 2026-07-11) supplies `onBackfill`, accumulating candidates from the stream and surfacing a toast/error on completion.

## Layout (D3a — Google-Maps idiom, not a split/modal)

- The container is the positioning context — the app gives it `fixed inset-0`; the component only adds `overflow-hidden` and **must not** add `relative` (Tailwind's `.relative` overrides `.fixed` and collapses the full-bleed container to zero height). The **map element is `absolute inset-0`** so it fills the viewport.
- Overlays float on top (`absolute z-[1000] bg-black/70 … rounded-lg shadow-lg`), reusing the app's HUD/controls idiom:
  - search field — top-center (D5 name search);
  - tour-list panel — left card; shows the selected tile's tours, or all name-filtered tours when no tile is selected; a "Show all" affordance clears the tile selection;
  - close button — top-right.

## Invariants & assumptions

- **Tiles are clustered with `cellToParent` (via `buildTileIndex` → `clusterCellsByZoom`), never hex-string truncation** (D1). The clustering resolution comes from `leafletZoomToH3Res(map.getZoom())` and is recomputed on `zoomend`.
- A tile that disappears at a new zoom resolution clears the selection rather than dangling.
- The name search clears any tile selection (a stale tile's tours would otherwise show under a new filter).
- v1 plays exactly one tour (`onPlayTour`); simultaneous multi-tour replay is deferred (D4). Tile-click still _lists_ all tours at the tile.
- Coverage with no cells frames the whole world (`WORLD_ZOOM`) instead of throwing on an invalid bounds.
- **Frame to coverage exactly once (O1).** The map fits to coverage on the first recording that carries cells (whether supplied at construction or streamed in via `addRecording`) and is **not** moved as more recordings stream in — re-fitting on every add would yank the view around. A "fit to all" affordance can re-fit on demand (future).
- Pending re-render (rAF) and the progress auto-hide timer are cancelled in `destroy()`, so an aborted/closed stream never paints into a torn-down map.
- **Late async callbacks are guarded against `destroyed`.** Teardown runs `abort()` then `destroy()` synchronously, but the indexing stream lets in-flight workers finish, so `setIndexingProgress` (via `onProgress`) and the `onBackfill` continuation can both resolve **after** `destroy()`. Both early-return when `destroyed` (mirroring `addRecording`/`scheduleRender`), so a late callback neither mutates detached DOM nor arms a `setTimeout` that `destroy()` has already finished clearing (which would leak a timer pinning the detached nodes).

## Tests

- `playwright-tests/map-browser.spec.js`:
  - **Static mount** (`mountMapBrowser` hook): full-bleed layout (map fills the viewport; Leaflet container nested inside it), overlays float on top, name search filters the list (case-insensitive substring), tile selection narrows the list and toggles "Show all", picking a tour records single-tour playback, and close tears the browser down.
  - **Progressive streaming** (`mountMapBrowserEmpty` + `streamMapBrowserRecording` hooks): the map is interactive with a "0 / total" progress pill before any recording resolves; tiles and tour items grow as recordings stream in and progress counts up; the pill shows a brief confirmation and then hides once `done === total`.
  - **Backfill CTA** (`mountMapBrowserBackfill` hook with a deferred `onBackfill`): the CTA appears after indexing with the candidate count; clicking shows the transitional "Embedding…" then, on release, the final "Embedded N" confirmation before auto-hiding (success) or a "Write access denied" retry label that stays visible (permission denied).
- Pure tile/filter/zoom logic: `src/ui/map-browser-index.test.ts` + `.property.test.ts`.
- Destroy safety (unit, mocked Leaflet): `src/ui/map-browser.test.ts` — `setIndexingProgress` and the `onBackfill` continuation are both no-ops after `destroy()` (no leaked progress/backfill timer), pinning the late-callback guards above.
