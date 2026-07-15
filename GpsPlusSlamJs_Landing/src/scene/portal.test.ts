/**
 * Why these tests matter: the forest portal (round-14 R14-10) opens
 * while the works-anywhere copy is on screen and must (a) face the
 * approaching camera, (b) never occlude the world (translucent,
 * depthWrite off — it is a glowing gateway), (c) start CLOSED so the
 * story timeline controls the open, and (d) swirl as a pure function of
 * the clock so scrub-path independence holds.
 */
import { describe, expect, it } from "vitest";
import { Vector3, type Mesh, type MeshStandardMaterial } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import { buildForestPortal, PORTAL_NAME, updatePortalSpin } from "./portal";

const ANCHOR = new Vector3(10, 2.5, -6);
const FACE = new Vector3(0, 0, 0);

describe("buildForestPortal", () => {
  it("builds a named, initially CLOSED portal with portal-role meshes", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    expect(portal.name).toBe(PORTAL_NAME);
    expect(portal.scale.x).toBeLessThan(0.01); // primed closed
    let roleMeshes = 0;
    portal.traverse((o) => {
      if ((o as Mesh).userData?.paletteRole === "portal") {
        roleMeshes += 1;
      }
    });
    expect(roleMeshes).toBeGreaterThanOrEqual(3); // disc + 2 rings
  });

  it("every palette styles the portal role", () => {
    for (const theme of THEME_IDS) {
      expect(getPalette(theme).roles.portal, theme).toBeDefined();
    }
  });

  it("is translucent and never writes depth (a gateway, not a wall)", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    const mats: MeshStandardMaterial[] = [];
    portal.traverse((o) => {
      const mesh = o as Mesh;
      const mat = mesh.material as MeshStandardMaterial | undefined;
      if (mat && mesh.isMesh) {
        mats.push(mat);
      }
    });
    expect(mats.length).toBeGreaterThanOrEqual(3);
    for (const mat of mats) {
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
  });

  it("faces the disc toward the approaching camera", () => {
    // Anchor to the +x side, facing the origin → the disc normal (+Z
    // rotated by rotation.y) should point roughly toward -x.
    const portal = buildForestPortal(
      new Vector3(10, 2, 0),
      new Vector3(0, 2, 0),
    );
    const normal = new Vector3(0, 0, 1).applyEuler(portal.rotation);
    expect(normal.x).toBeLessThan(-0.5); // points back toward the world
  });
});

describe("updatePortalSpin", () => {
  it("counter-rotates the rings as a pure function of the clock", () => {
    const a = buildForestPortal(ANCHOR, FACE);
    const b = buildForestPortal(ANCHOR, FACE);
    updatePortalSpin(a, 999);
    updatePortalSpin(a, 4000);
    updatePortalSpin(a, 4000);
    updatePortalSpin(b, 4000);
    const rots = (p: typeof a) => p.children.map((c) => c.rotation.z).join(",");
    expect(rots(a)).toBe(rots(b)); // history-independent
    // The two rings turn opposite ways.
    const rings = a.children.filter((c) => c.userData.spin !== undefined);
    expect(rings.length).toBe(2);
    expect(Math.sign(rings[0]!.rotation.z)).not.toBe(
      Math.sign(rings[1]!.rotation.z),
    );
  });
});
