/**
 * Why these tests matter: the egg picker is the shared foundation for
 * every click egg (catalog §2). It must hit-test ONLY registered targets
 * (never the whole scene), map a hit child mesh back to the registered
 * root's name, and reject drags — a false positive here would fire eggs
 * while the visitor merely scrolls.
 */
import { describe, expect, it } from "vitest";
import { BoxGeometry, PerspectiveCamera, Vector3 } from "three";
import { clayMesh, namedGroup } from "./palette";
import { isGenuineClick, pickEggTarget } from "./egg-picker";

function makeTarget(name: string, position: Vector3) {
  const group = namedGroup(name);
  const mesh = clayMesh(new BoxGeometry(1, 1, 1), "rock");
  group.add(mesh);
  group.position.copy(position);
  group.updateWorldMatrix(true, true);
  return group;
}

function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(55, 16 / 9);
  camera.position.set(0, 0, 10);
  camera.lookAt(new Vector3(0, 0, 0));
  camera.updateMatrixWorld(true);
  return camera;
}

describe("pickEggTarget", () => {
  it("returns the registered root's name when a CHILD mesh is hit", () => {
    const target = makeTarget("egg-a", new Vector3(0, 0, 0));
    const name = pickEggTarget({ x: 0, y: 0 }, makeCamera(), [target]);
    expect(name).toBe("egg-a");
  });

  it("returns null on a miss and for an empty target list", () => {
    const target = makeTarget("egg-a", new Vector3(0, 0, 0));
    expect(pickEggTarget({ x: 0.9, y: 0.9 }, makeCamera(), [target])).toBe(
      null,
    );
    expect(pickEggTarget({ x: 0, y: 0 }, makeCamera(), [])).toBe(null);
  });

  it("picks the target the ray actually points at, not just the first registered", () => {
    const left = makeTarget("egg-left", new Vector3(-3, 0, 0));
    const center = makeTarget("egg-center", new Vector3(0, 0, 0));
    expect(pickEggTarget({ x: 0, y: 0 }, makeCamera(), [left, center])).toBe(
      "egg-center",
    );
  });

  it("treats non-finite pointer coordinates as a miss (defensive boundary)", () => {
    const target = makeTarget("egg-a", new Vector3(0, 0, 0));
    expect(pickEggTarget({ x: Number.NaN, y: 0 }, makeCamera(), [target])).toBe(
      null,
    );
  });
});

describe("isGenuineClick", () => {
  it("accepts a stationary press-release and rejects a drag", () => {
    expect(isGenuineClick({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(true);
    expect(isGenuineClick({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(false);
  });
});
