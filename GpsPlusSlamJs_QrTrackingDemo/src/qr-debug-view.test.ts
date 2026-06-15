/**
 * QR debug view — unit tests.
 *
 * Why this matters: the axis + cube are the §5 verification objects. They must
 * start hidden, appear glued to the pose at the measured size on update, persist
 * (not auto-clear) so they don't flicker between detections, and tear down
 * cleanly. Runs against a real THREE.Group (no WebGL needed for transforms).
 */

import { describe, it, expect } from "vitest";
import { Group } from "three";
import type { Pose } from "gps-plus-slam-app-framework/ar";
import { createQrDebugView } from "./qr-debug-view";

const pose: Pose = { position: [1, 2, -3], rotation: [0, 0, 0, 1] };

describe("createQrDebugView", () => {
  it("adds two hidden objects (axis + cube) to the parent", () => {
    const parent = new Group();
    createQrDebugView(parent);
    expect(parent.children).toHaveLength(2);
    expect(parent.children.every((c) => c.visible === false)).toBe(true);
  });

  it("reveals + glues the objects to the pose at the measured size on update", () => {
    const parent = new Group();
    const view = createQrDebugView(parent);
    view.update(pose, 0.2);
    expect(parent.children.every((c) => c.visible)).toBe(true);
    const cube = parent.children[1]!;
    expect(cube.position.x).toBeCloseTo(1, 6);
    expect(cube.position.y).toBeCloseTo(2, 6);
    // In-plane span equals the measured size (depth is the thin slab dimension).
    expect(cube.scale.x).toBeCloseTo(0.2, 6);
    expect(cube.scale.y).toBeCloseTo(0.2, 6);
    expect(cube.scale.z).toBeLessThan(0.2);
  });

  it("clear() hides without detaching; dispose() detaches", () => {
    const parent = new Group();
    const view = createQrDebugView(parent);
    view.update(pose, 0.2);
    view.clear();
    expect(parent.children.every((c) => c.visible === false)).toBe(true);
    expect(parent.children).toHaveLength(2); // still attached (no flicker)
    view.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
