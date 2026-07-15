/**
 * Occupancy view — build the reconstructed-mesh visualizers (cubes + occlusion
 * mesh) over a live store's depth stream, for the AR path.
 *
 * The desktop-replay path gets this for free from the framework's
 * `startReplaySession`. Live AR has no such composer (initAR is scene-only), so
 * the demo wires the same framework primitives here: an `OccupancyGrid` fed by
 * the store's `recordDepthSample` stream (via the framework's
 * `subscribeReplayOccupancy` — the SAME subscriber both paths use), driving the
 * cube visualizer and the occlusion mesh. Everything hangs under `arWorldGroup`
 * in raw-WebXR-under-NUE space, exactly like the replay path.
 */

import type { Object3D } from "three";
import { OccupancyGrid } from "gps-plus-slam-app-framework/ar/occupancy-grid";
import { OccupancyCubesVisualizer } from "gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer";
import { OcclusionMesh } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import {
  subscribeReplayOccupancy,
  type DepthSampleStore,
} from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";

export interface OccupancyViewOptions {
  readonly cellSizeM?: number;
  readonly minObservations?: number;
}

export interface OccupancyView {
  readonly grid: OccupancyGrid;
  readonly cubes: OccupancyCubesVisualizer;
  readonly occlusionMesh: OcclusionMesh;
  dispose(): void;
}

/**
 * Create the occupancy grid + cube visualizer + occlusion mesh under
 * `arWorldGroup`, subscribed to `store`'s depth stream. The visualizers refresh
 * as depth samples arrive (throttled by the subscriber).
 */
export function createOccupancyView(
  arWorldGroup: Object3D,
  store: DepthSampleStore,
  options: OccupancyViewOptions = {},
): OccupancyView {
  const cellSizeM = options.cellSizeM ?? 0.15;
  const minObservations = options.minObservations ?? 1;

  const grid = new OccupancyGrid({ cellSizeM });
  const cubes = new OccupancyCubesVisualizer(arWorldGroup, { minObservations });
  const occlusionMesh = new OcclusionMesh(arWorldGroup);

  const unsubscribe = subscribeReplayOccupancy({
    store,
    grid,
    onRefresh: (viewerPose) => {
      cubes.refresh(grid, viewerPose);
      occlusionMesh.update(
        grid.getOccupiedCells(minObservations),
        cellSizeM,
        (cell) => grid.getCellPoint(cell),
      );
    },
  });

  return {
    grid,
    cubes,
    occlusionMesh,
    dispose(): void {
      unsubscribe();
      cubes.dispose();
      occlusionMesh.dispose();
    },
  };
}
