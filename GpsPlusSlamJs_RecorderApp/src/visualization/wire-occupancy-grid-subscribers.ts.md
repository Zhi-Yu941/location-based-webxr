# wire-occupancy-grid-subscribers.ts

## Purpose

Wires the AR-space occupancy grid (framework `OccupancyGrid`) to the recorder store: observes `state.recording.latestDepthSample` by reference comparison, folds each new depth sample into the injected grid, and refreshes the injected cube visualizer on a throttle. The throttle delay is supplied by the call sites as `refreshIntervalMs` — sourced from `depth.intervalMs` so the cube view tracks the sample cadence instead of a fixed ~1 Hz (Issue A). Also remembers the **latest sample's head pose** and forwards it to `visualizer.refresh(grid, viewerPose)` so an over-cap refresh can draw the cells nearest the user (Issue B1). Follows `wire-frame-tile-subscribers.ts` (action stream = persisted source of truth, grid = derived state outside Redux) and the F1 `StoreRef` store-swap pattern.

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-depth-occupancy-grid-port-plan.md` §3/Iter 4; refresh cadence + viewer pose pass-through: `GpsPlusSlamJs_Docs/docs/2026-06-22-occupancy-cubes-rendering-cadence-and-locality-plan.md` (Issues A + B1).

## Public API

- **`wireOccupancyGridSubscribers(options): () => void`** — attaches; returns a dispose function (detaches store subscription, swap listener, pending refresh timer).
  - `storeRef: StoreRef<RecorderStore>` — re-attaches on store swap (Start Recording / Replay); on swap both grid and visualizer are cleared and the throttle resets.
  - `grid: TGrid extends OccupancyGridSink` — `{ addSample(sample), clear() }`.
  - `visualizer: { refresh(grid: TGrid, viewerPose?: ViewerPose), clear() }` — injected, typically `OccupancyCubesVisualizer`. The `viewerPose` arg is optional, so a sink that ignores it (the no-op overlay-off sink in `main.ts`) still satisfies the type.
  - `occluder?: { refresh(grid: TGrid), clear() }` — optional persistent depth-only occluder (the `OcclusionMesh` adapter), refreshed on the **same** throttle as the visualizer. Present only when `occupancy.persistentOcclusion` is on (on by default). `refresh` gets the live grid so the adapter snapshots `getOccupiedCells(minConfidence)`; independent best-effort like the visualizer (a throwing occluder still lets the visualizer refresh, and vice versa).
  - `refreshIntervalMs?` — minimum delay between refreshes; default 1000. Live and replay both pass `depth.intervalMs` here (Issue A).
  - `onError?(err)` — receives grid/visualizer failures; the subscription itself never breaks.
- **`OccupancyGridSink`** — the grid surface this wirer needs.

## Invariants & Assumptions

1. **Every sample folds exactly once** — reference comparison on `latestDepthSample`; unrelated dispatches are no-ops. A sample already present at attach time is seeded once.
2. **Samples are never throttled — only refreshes are.** Leading-edge + trailing-edge throttle: first sample after a quiet period refreshes immediately; bursts (replay re-dispatches much faster than 1 Hz) coalesce into one trailing refresh per interval, so the final state always renders.
3. **Best-effort:** `addSample`/`refresh`/`clear` failures go to `onError`; a failed `addSample` skips that refresh (and the pose update) but later samples still flow. On swap, `grid.clear()` and `visualizer.clear()` are **independent** best-effort calls — a throwing `grid.clear()` still runs `visualizer.clear()`, so the cube view never keeps rendering a stale grid.
4. Uses `Date.now()` + `setTimeout` (fake-timer friendly).
5. **Viewer pose (Issue B1):** the remembered pose updates on every successfully-folded sample — even throttled ones — so the single trailing refresh of a burst ranks against the freshest head pose. It is reset to `null` on store swap (defensive: a refresh is always preceded by a sample that overwrites it, so the old recording's pose never reaches the new store's cubes).

## Examples

```ts
const grid = new OccupancyGrid();
// arWorldGroup, NOT the scene root — the cells are raw-WebXR coordinates
// that must ride the alignment matrix (port plan Iter 7).
const visualizer = new OccupancyCubesVisualizer(arWorldGroup);
const dispose = wireOccupancyGridSubscribers({
  storeRef,
  grid,
  visualizer,
  onError: (err) => log.warn('occupancy grid error', err),
});
```

## Tests

- `wire-occupancy-grid-subscribers.test.ts` — exact-once folding, pre-wiring seed, leading+trailing throttle behavior (fake timers), store-swap clearing + re-attach, dispose, both error paths, and **viewer-pose forwarding (Issue B1): the leading-edge refresh carries the sample's pose, the trailing refresh of a burst carries the freshest pose, and a swap does not leak the old store's pose into the new one.**
- Call-site forwarding of `refreshIntervalMs` from `depth.intervalMs` (Issue A) is pinned at both wiring sites: `main.occupancy-cubes-wiring.test.ts` (live) and `replay/replay-mode.test.ts` (replay).
