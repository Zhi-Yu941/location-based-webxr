/**
 * Tests for the AR occupancy view.
 *
 * Why this test matters:
 * The live-AR path has no framework composer, so this is where the reconstructed
 * mesh is wired to the live depth stream. It must fold each arriving
 * `recordDepthSample` into the grid AND refresh BOTH visualizers (the cubes and
 * the occlusion mesh that feeds the physics collider) — if the occlusion mesh
 * were not refreshed, the AR collider would never grow. Pinned here with real
 * framework objects and a fake store.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { OccupancyGrid } from "gps-plus-slam-app-framework/ar/occupancy-grid";
import { OccupancyCubesVisualizer } from "gps-plus-slam-app-framework/visualization/occupancy-cubes-visualizer";
import { OcclusionMesh } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import { createOccupancyView } from "./occupancy-view";
import type { DepthSampleStore } from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";
import type { DepthSample } from "gps-plus-slam-app-framework/types/ar-types";
import * as THREE from "three";

function makeFakeStore(): DepthSampleStore & {
  push(sample: DepthSample): void;
} {
  let latest: DepthSample | null = null;
  const listeners = new Set<() => void>();
  return {
    getState: () => ({ recording: { latestDepthSample: latest } }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(sample) {
      latest = sample;
      for (const l of [...listeners]) l();
    },
  };
}

const sample: DepthSample = {
  timestamp: 1,
  cameraPos: [0, 1.5, 0],
  cameraRot: [0, 0, 0, 1],
  points: [],
};

afterEach(() => vi.restoreAllMocks());

describe("createOccupancyView", () => {
  it("folds each depth sample into the grid and refreshes BOTH visualizers", () => {
    const addSample = vi.spyOn(OccupancyGrid.prototype, "addSample");
    const cubesRefresh = vi.spyOn(
      OccupancyCubesVisualizer.prototype,
      "refresh",
    );
    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");

    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);

    store.push(sample);

    expect(addSample).toHaveBeenCalledTimes(1);
    expect(cubesRefresh).toHaveBeenCalledTimes(1);
    // The occlusion mesh MUST refresh too — it feeds the physics collider.
    expect(meshUpdate).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("detaches the subscription on dispose", () => {
    const addSample = vi.spyOn(OccupancyGrid.prototype, "addSample");
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);

    view.dispose();
    store.push(sample);

    expect(addSample).not.toHaveBeenCalled();
  });
});
