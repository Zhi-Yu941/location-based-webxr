/**
 * Occupancy-Grid Provider
 *
 * A tiny app-level registry holding a reference to the *single* live
 * {@link OccupancyGrid} instance for the current AR session, so consumers other
 * than the cube visualizer can read it without threading a one-off reference
 * through their wiring (COLMAP/3DGS export plan Iter 2.5,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md Q2).
 *
 * The grid itself stays a plain in-memory class owned by `main.ts` (it is
 * derived state fed from `recordDepthSample`, deliberately NOT Redux — see the
 * occupancy-grid port plan §1). `main.ts` publishes the instance here when it
 * creates it (Enter AR) and clears it on session swap / teardown. This module
 * holds only a reference; it never constructs, mutates, or disposes the grid.
 *
 * First consumer: the COLMAP ZIP contributor (Iter 3). Anticipated future
 * readers of the SAME single instance: floor detection, navigation-mesh and
 * physics/collision-mesh builders — hence a shared accessor rather than a
 * COLMAP-specific hand-off.
 */

import type { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';

let currentGrid: OccupancyGrid | null = null;

/**
 * Publish (or clear, with `null`) the live occupancy grid for the current AR
 * session. Called by `main.ts` when it creates the grid and on every path that
 * tears it down, so `getOccupancyGrid` mirrors the live instance exactly.
 */
export function setOccupancyGrid(grid: OccupancyGrid | null): void {
  currentGrid = grid;
}

/**
 * The live occupancy grid, or `null` when no AR session is currently feeding
 * one (before Enter AR, after teardown, or during replay — replay keeps its own
 * grid and does not publish here).
 */
export function getOccupancyGrid(): OccupancyGrid | null {
  return currentGrid;
}
