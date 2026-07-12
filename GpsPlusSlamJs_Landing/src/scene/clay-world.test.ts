import { describe, expect, it } from "vitest";
import { Vector3, type Mesh } from "three";
import { PALETTE_ROLES } from "./palette";
import {
  buildClayWorld,
  createPathCurve,
  WORLD_ANCHORS,
  WORLD_NODE,
} from "./clay-world";

// Why this test matters: the story timeline addresses world objects BY NAME
// (WORLD_NODE constants) and stages the dot-person along the path curve. A
// renamed or missing node doesn't throw at build time — it just makes a
// chapter animate nothing. These tests pin the contract between the world
// builder and the timeline, plus determinism (procedural ≠ random per load).

describe("buildClayWorld", () => {
  it("contains every named node the story timeline addresses", () => {
    const world = buildClayWorld("high");
    for (const name of Object.values(WORLD_NODE)) {
      expect(
        world.getObjectByName(name),
        `missing world node ${name}`,
      ).toBeDefined();
    }
  });

  it("only uses palette roles that exist in the palette definition", () => {
    const world = buildClayWorld("high");
    const knownRoles = new Set<string>(PALETTE_ROLES);
    const usedRoles = new Set<string>();
    world.traverse((obj) => {
      const role = (obj as Mesh).userData?.paletteRole as string | undefined;
      if (role !== undefined) {
        usedRoles.add(role);
      }
    });
    const unknown = [...usedRoles].filter((role) => !knownRoles.has(role));
    expect(unknown).toEqual([]);
  });

  it("builds fewer decoration meshes in the low geometry tier", () => {
    const countMeshes = (detail: "high" | "low") => {
      let count = 0;
      buildClayWorld(detail).traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          count++;
        }
      });
      return count;
    };
    expect(countMeshes("low")).toBeLessThan(countMeshes("high"));
  });

  it("is deterministic: two builds place objects identically", () => {
    const positionsOf = (detail: "high" | "low") => {
      const positions: number[] = [];
      buildClayWorld(detail).traverse((obj) => {
        positions.push(obj.position.x, obj.position.y, obj.position.z);
      });
      return positions;
    };
    expect(positionsOf("high")).toEqual(positionsOf("high"));
  });

  it("renders the sign's code as a dense QR-like grid with three finder patterns", () => {
    // Round-1 feedback: the 5x5 blob was not recognizable as a QR code.
    // A real-looking code needs the three corner finder squares plus a
    // dense module field, all in the color the copy highlight echoes.
    const world = buildClayWorld("high");
    const qr = world.getObjectByName("world-sign-qr");
    expect(qr).toBeDefined();
    let modules = 0;
    qr?.traverse((obj) => {
      if ((obj as Mesh).isMesh && obj.userData.paletteRole === "qrModule") {
        modules++;
      }
    });
    expect(modules).toBeGreaterThanOrEqual(35);
    for (const i of [0, 1, 2]) {
      expect(qr?.getObjectByName(`qr-finder-${i}`)).toBeDefined();
    }
  });

  it("hides the reveal groups (outer terrain, gallery, AR content) until their chapters", () => {
    const world = buildClayWorld("high");
    expect(world.getObjectByName(WORLD_NODE.outer)?.visible).toBe(false);
    expect(world.getObjectByName(WORLD_NODE.gallery)?.visible).toBe(false);
    expect(world.getObjectByName(WORLD_NODE.arContent)?.visible).toBe(false);
  });

  it("points every AR trail arrow forward along the path tangent", () => {
    // Round-1 feedback: the dive's arrows pointed in a wrong direction.
    // The cone's +Y axis must map onto the walk direction at the arrow's
    // own path position — this pins the Euler-order composition.
    const world = buildClayWorld("high");
    const arContent = world.getObjectByName(WORLD_NODE.arContent);
    const curve = createPathCurve();
    let checked = 0;
    arContent?.traverse((obj) => {
      const t = obj.userData.pathT as number | undefined;
      if (t === undefined) {
        return;
      }
      const direction = new Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
      const tangent = curve.getTangentAt(t);
      expect(
        direction.dot(tangent),
        `arrow at t=${t} misaligned`,
      ).toBeGreaterThan(0.95);
      checked++;
    });
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("marks the statue with a red POI pin and a hinted text label (dive AR content)", () => {
    const world = buildClayWorld("high");
    const arContent = world.getObjectByName(WORLD_NODE.arContent);
    expect(arContent?.getObjectByName("ar-poi-pin")).toBeDefined();
    expect(arContent?.getObjectByName("ar-poi-label")).toBeDefined();
  });
});

describe("createPathCurve / WORLD_ANCHORS", () => {
  it("provides a walkable ground-level path for the dot-person", () => {
    const curve = createPathCurve();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const point = curve.getPointAt(t);
      expect(point.y).toBeCloseTo(0, 5);
      expect(point.length()).toBeLessThan(40); // stays inside the world disc
    }
  });

  it("places the story anchors on or near the path", () => {
    const curve = createPathCurve();
    const nearestDistance = (target: Vector3) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= 100; i++) {
        best = Math.min(best, curve.getPointAt(i / 100).distanceTo(target));
      }
      return best;
    };
    // Sign and marker pair sit beside the path (< 4m); the statue is a bit
    // further off but still a short detour.
    expect(nearestDistance(WORLD_ANCHORS.sign)).toBeLessThan(4);
    expect(nearestDistance(WORLD_ANCHORS.markerPair)).toBeLessThan(4);
    expect(nearestDistance(WORLD_ANCHORS.statue)).toBeLessThan(8);
  });
});
