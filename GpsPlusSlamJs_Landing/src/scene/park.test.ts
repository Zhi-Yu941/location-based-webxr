/**
 * Why these tests matter: the parkour park (round-14 R14-12) sits in
 * front of the city highrises with a course of green blocks that pop in
 * while the works-anywhere copy is on screen. The lawn is permanent
 * scenery (must not float over the void — the R10-3 lesson), the blocks
 * are the animated part (green `parkour` role, primed by the timeline),
 * and the whole thing is deterministic.
 */
import { describe, expect, it } from "vitest";
import { Box3, Vector3, type Mesh } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import { buildParcoursPark, PARK_BLOCKS_NAME, PARK_NAME } from "./park";

const ANCHOR = new Vector3(0, 0, -40);

describe("buildParcoursPark", () => {
  it("builds a named park with a lawn and a group of parkour blocks", () => {
    const park = buildParcoursPark(ANCHOR);
    expect(park.name).toBe(PARK_NAME);
    const blocks = park.getObjectByName(PARK_BLOCKS_NAME);
    expect(blocks).toBeDefined();
    expect(blocks!.children.length).toBeGreaterThanOrEqual(3);
    let parkourMeshes = 0;
    blocks!.traverse((o) => {
      if ((o as Mesh).userData?.paletteRole === "parkour") {
        parkourMeshes += 1;
      }
    });
    expect(parkourMeshes).toBeGreaterThanOrEqual(3);
  });

  it("every palette styles the parkour role", () => {
    for (const theme of THEME_IDS) {
      expect(getPalette(theme).roles.parkour, theme).toBeDefined();
    }
  });

  it("stands on a sunken lawn — nothing floats (the R10-3 lesson)", () => {
    const park = buildParcoursPark(ANCHOR);
    park.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(park);
    expect(box.min.y).toBeLessThan(-2); // the lawn skirt dips below ground
  });

  it("is deterministic and sits at its anchor", () => {
    const a = buildParcoursPark(ANCHOR);
    const b = buildParcoursPark(ANCHOR);
    expect(a.position.distanceTo(ANCHOR)).toBeLessThan(0.01);
    const dump = (g: typeof a) => {
      const out: string[] = [];
      g.traverse((o) =>
        out.push(`${o.name}:${o.position.toArray().join(",")}`),
      );
      return out;
    };
    expect(dump(a)).toEqual(dump(b));
  });
});
