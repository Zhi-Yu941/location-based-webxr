/**
 * Tests for the occupancy view — the demo's single reconstructed mesh.
 *
 * Why this test matters:
 * This is the one building block used for BOTH occlusion and physics. It must fold
 * each depth sample into the grid and re-mesh the occluder (else neither the
 * collider nor the occlusion would grow); switch the visible shader live; and
 * switch the mesher MODE by recreating the occluder while re-meshing from the
 * persisted grid — with `getMesh()` a stable handle across that recreation (the
 * physics runtime reads it every frame). Real framework objects + a fake store.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { OccupancyGrid } from "gps-plus-slam-app-framework/ar/occupancy-grid";
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
  it("folds each depth sample into the grid and re-meshes the occluder", () => {
    const addSample = vi.spyOn(OccupancyGrid.prototype, "addSample");
    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");

    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    store.push(sample);

    expect(addSample).toHaveBeenCalledTimes(1);
    // The occluder re-meshes — it feeds BOTH occlusion and the physics collider.
    expect(meshUpdate).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it("defaults to Surface nets + the combined shader", () => {
    const setDebugStyle = vi.spyOn(OcclusionMesh.prototype, "setDebugStyle");
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    // Default debug style is applied at construction.
    expect(setDebugStyle).toHaveBeenLastCalledWith("depth-shaded-wireframe");
    view.dispose();
  });

  it("changes the visible shader live via setDebugStyle", () => {
    const store = makeFakeStore();
    const view = createOccupancyView(new THREE.Group(), store);
    const setDebugStyle = vi.spyOn(OcclusionMesh.prototype, "setDebugStyle");
    view.setDebugStyle("wireframe");
    expect(setDebugStyle).toHaveBeenLastCalledWith("wireframe");
    view.dispose();
  });

  it("setMeshMode recreates the occluder (new mesh handle) and re-meshes", () => {
    const store = makeFakeStore();
    const parent = new THREE.Group();
    const view = createOccupancyView(parent, store, { meshMode: "smooth" });
    const before = view.getMesh();

    const meshUpdate = vi.spyOn(OcclusionMesh.prototype, "update");
    view.setMeshMode("greedy");

    // A brand-new occluder mesh (the collider source getMesh() must follow it).
    expect(view.getMesh()).not.toBe(before);
    // Re-meshed from the persisted grid immediately.
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
