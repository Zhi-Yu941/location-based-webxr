/**
 * Why these tests matter: the world-detail layer (v3 F7) adds hundreds
 * of grass instances and curb stones — cheap ONLY as single-draw-call
 * InstancedMeshes with tier-scaled counts. These tests pin the counts
 * (low tier keeps its cost profile), the placement contracts (curb hugs
 * the path edge; grass never blocks the walk or the story anchors), the
 * contact shadows under the anchored props (flat on the ground, not
 * billboards), and determinism (two loads look identical).
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Vector3, type InstancedMesh, type Mesh } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import { createPathCurve, WORLD_ANCHORS } from "./clay-world";
import {
  CONTACT_SHADOW_PREFIX,
  GRASS_COUNTS,
  buildContactShadow,
  buildContactShadows,
  buildCurb,
  buildGrass,
} from "./world-detail";
import { buildDotPerson } from "./dot-person";

function instancePositions(mesh: InstancedMesh): Vector3[] {
  const positions: Vector3[] = [];
  const matrix = new Matrix4();
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    positions.push(new Vector3().setFromMatrixPosition(matrix));
  }
  return positions;
}

function pathSamples(): Vector3[] {
  const curve = createPathCurve();
  const samples: Vector3[] = [];
  for (let i = 0; i <= 200; i += 1) {
    samples.push(curve.getPointAt(i / 200));
  }
  return samples;
}

describe("palette roles for the detail layer", () => {
  it("every palette styles grass and curb", () => {
    for (const theme of THEME_IDS) {
      const roles = getPalette(theme).roles;
      expect(roles.grass, theme).toBeDefined();
      expect(roles.curb, theme).toBeDefined();
    }
  });
});

describe("buildGrass", () => {
  const grassOf = (detail: "high" | "low") =>
    buildGrass(detail, createPathCurve(), Object.values(WORLD_ANCHORS));

  it("is one InstancedMesh with tier-scaled counts (low keeps its cost profile)", () => {
    const high = grassOf("high");
    const low = grassOf("low");
    expect(high.count).toBe(GRASS_COUNTS.high);
    expect(low.count).toBe(GRASS_COUNTS.low);
    expect(GRASS_COUNTS.low).toBeLessThan(GRASS_COUNTS.high / 2);
  });

  it("keeps every tuft clear of the path and the story anchors", () => {
    const grass = grassOf("high");
    const path = pathSamples();
    const anchors = Object.values(WORLD_ANCHORS);
    for (const position of instancePositions(grass)) {
      const pathDistance = Math.min(...path.map((p) => p.distanceTo(position)));
      const anchorDistance = Math.min(
        ...anchors.map((a) => a.distanceTo(position)),
      );
      expect(pathDistance).toBeGreaterThan(1.0);
      expect(anchorDistance).toBeGreaterThan(2.0);
    }
  });

  it("is deterministic: two builds place identical instances", () => {
    const a = grassOf("high").instanceMatrix.array;
    const b = grassOf("high").instanceMatrix.array;
    expect(a).toEqual(b);
  });
});

describe("buildCurb", () => {
  it("hugs the path: every curb stone sits just off the slab edge", () => {
    const curb = buildCurb("high", createPathCurve());
    const path = pathSamples();
    for (const position of instancePositions(curb)) {
      const distance = Math.min(...path.map((p) => p.distanceTo(position)));
      // Slab half-width is 0.8; the curb line sits at ~0.95.
      expect(distance).toBeGreaterThan(0.7);
      expect(distance).toBeLessThan(1.3);
    }
  });

  it("scales with the tier's path segment count", () => {
    expect(buildCurb("high", createPathCurve()).count).toBeGreaterThan(
      buildCurb("low", createPathCurve()).count,
    );
  });
});

describe("contact shadows", () => {
  it("lie flat on the ground under the anchored props, without depth writes", () => {
    const shadows = buildContactShadows(WORLD_ANCHORS);
    expect(shadows.children.length).toBeGreaterThanOrEqual(2);
    for (const child of shadows.children) {
      expect(child.name.startsWith(CONTACT_SHADOW_PREFIX), child.name).toBe(
        true,
      );
      expect(child.position.y).toBeLessThan(0.1);
      expect(child.rotation.x).toBeCloseTo(-Math.PI / 2, 3);
      const material = (child as Mesh).material as {
        depthWrite?: boolean;
        transparent?: boolean;
      };
      expect(material.depthWrite).toBe(false);
      expect(material.transparent).toBe(true);
    }
  });

  it("covers the statue and the fused-marker anchor", () => {
    const shadows = buildContactShadows(WORLD_ANCHORS);
    const positions = shadows.children.map(
      (c) => new Vector3(c.position.x, 0, c.position.z),
    );
    const statue = new Vector3(
      WORLD_ANCHORS.statue.x,
      0,
      WORLD_ANCHORS.statue.z,
    );
    const marker = new Vector3(
      WORLD_ANCHORS.markerPair.x,
      0,
      WORLD_ANCHORS.markerPair.z,
    );
    expect(positions.some((p) => p.distanceTo(statue) < 0.5)).toBe(true);
    expect(positions.some((p) => p.distanceTo(marker) < 0.5)).toBe(true);
  });

  it("gives the walking dot-person its own attached shadow", () => {
    const person = buildDotPerson();
    const shadow = person.children.find((c) =>
      c.name.startsWith(CONTACT_SHADOW_PREFIX),
    );
    expect(shadow).toBeDefined();
    expect(shadow?.position.y).toBeLessThan(0.1);
  });

  it("buildContactShadow produces a reusable flat gradient disc", () => {
    const shadow = buildContactShadow("test", 1.2);
    expect(shadow.name).toBe(`${CONTACT_SHADOW_PREFIX}test`);
    expect(shadow.rotation.x).toBeCloseTo(-Math.PI / 2, 3);
  });
});
