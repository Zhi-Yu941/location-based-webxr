# `occupancy-grid-provider.ts`

## Purpose

A tiny app-level registry holding a reference to the single live
`OccupancyGrid` for the current AR session, so consumers other than the cube
visualizer can read it without threading a one-off reference. First consumer:
the COLMAP ZIP contributor (Iter 3). See
[2026-06-13-1205-colmap-export-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md)
Q2 / Iter 2.5.

## Public API

- `setOccupancyGrid(grid: OccupancyGrid | null): void` — publish (or clear) the
  live grid. Called only by `main.ts`.
- `getOccupancyGrid(): OccupancyGrid | null` — the live grid, or `null` when no
  AR session is feeding one.

## Invariants & assumptions

- **Single instance.** `main.ts` owns the one grid (created on Enter AR, fed by
  `wireOccupancyGridSubscribers`); this module only mirrors that reference. It
  never constructs, mutates, or disposes the grid.
- **Mirrors `main.ts` exactly.** Published right after `new OccupancyGrid()` and
  cleared to `null` on every teardown path (`resetMainState`, the Enter-AR
  re-entry pre-cleanup), so a stale grid is never read.
- **Recording only.** Replay keeps its own block-scoped grid and does NOT
  publish here, so `getOccupancyGrid()` is `null` during replay (the COLMAP
  export does not run in replay anyway).
- Module-level state: tests must reset it (`setOccupancyGrid(null)`) between
  cases.

## Examples

```ts
// main.ts (Enter AR)
occupancyGrid = new OccupancyGrid();
setOccupancyGrid(occupancyGrid);
// …teardown
setOccupancyGrid(null);

// consumer (COLMAP contributor)
const grid = getOccupancyGrid();
if (grid)
  for (const cell of grid.getOccupiedCells()) {
    /* … */
  }
```

## Tests

- `occupancy-grid-provider.test.ts` — get/set/clear/replace contract (same
  reference, single instance, null clearing).
- `main.occupancy-cubes-wiring.test.ts` — main.ts publishes the live grid on
  Enter AR and clears it on `resetMainState`.
