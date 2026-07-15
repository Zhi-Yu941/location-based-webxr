/**
 * Tests for the demo-local mesh-view controller.
 *
 * Why this test matters:
 * The controller is the live Cubes/Detailed + visibility toggle, and the whole
 * "the developer sees the surface the balls hit" story rests on exactly one
 * representation being visible at a time and the other being fully off. These
 * pins encode that: cubes and the detailed occluder skin never double up, and
 * hiding turns BOTH off. Pure logic against fake targets — no WebGL.
 */

import { describe, it, expect, vi } from "vitest";
import { createMeshViewController } from "./mesh-view-controller";

function targets() {
  return {
    cubes: { setVisible: vi.fn() },
    occlusionMesh: { setDebugStyle: vi.fn(), setVisible: vi.fn() },
  };
}

describe("createMeshViewController", () => {
  it("defaults to the detailed combined shader with the occluder visible", () => {
    // Default look matches the RecorderApp: Detailed + depth-shaded-wireframe.
    const t = targets();
    const c = createMeshViewController(t);
    expect(c.getVisible()).toBe(true);
    expect(c.getStyle()).toBe("detailed");
    expect(t.cubes.setVisible).toHaveBeenLastCalledWith(false);
    expect(t.occlusionMesh.setDebugStyle).toHaveBeenLastCalledWith(
      "depth-shaded-wireframe",
    );
    expect(t.occlusionMesh.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("shows cubes with the occluder hidden when switched to cubes", () => {
    const t = targets();
    const c = createMeshViewController(t);
    c.setStyle("cubes");
    expect(t.cubes.setVisible).toHaveBeenLastCalledWith(true);
    expect(t.occlusionMesh.setDebugStyle).toHaveBeenLastCalledWith("off");
    // The occluder is HIDDEN in cubes view so it does not occlude the cubes.
    expect(t.occlusionMesh.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("switching to detailed hides the cubes and shows the occluder skin", () => {
    const t = targets();
    const c = createMeshViewController(t, { detailedStyle: "wireframe" });
    c.setStyle("detailed");
    expect(c.getStyle()).toBe("detailed");
    // Exactly one representation is visible.
    expect(t.cubes.setVisible).toHaveBeenLastCalledWith(false);
    expect(t.occlusionMesh.setDebugStyle).toHaveBeenLastCalledWith("wireframe");
    // The occluder is VISIBLE only for the detailed view.
    expect(t.occlusionMesh.setVisible).toHaveBeenLastCalledWith(true);
  });

  it("hiding turns BOTH representations off regardless of style", () => {
    const t = targets();
    const c = createMeshViewController(t, { style: "detailed" });
    c.setVisible(false);
    expect(c.getVisible()).toBe(false);
    expect(t.cubes.setVisible).toHaveBeenLastCalledWith(false);
    expect(t.occlusionMesh.setDebugStyle).toHaveBeenLastCalledWith("off");
  });

  it("re-showing restores the selected style (detailed after a hide)", () => {
    const t = targets();
    const c = createMeshViewController(t, {
      style: "detailed",
      detailedStyle: "matcap",
    });
    c.setVisible(false);
    c.setVisible(true);
    expect(t.cubes.setVisible).toHaveBeenLastCalledWith(false);
    expect(t.occlusionMesh.setDebugStyle).toHaveBeenLastCalledWith("matcap");
  });

  it("tolerates null targets (occupancy disabled) without throwing", () => {
    const c = createMeshViewController({ cubes: null, occlusionMesh: null });
    expect(() => {
      c.setStyle("detailed");
      c.setVisible(false);
      c.setVisible(true);
    }).not.toThrow();
  });

  it("honours an initial visible:false", () => {
    const t = targets();
    createMeshViewController(t, { visible: false });
    expect(t.cubes.setVisible).toHaveBeenLastCalledWith(false);
    expect(t.occlusionMesh.setDebugStyle).toHaveBeenLastCalledWith("off");
  });
});
