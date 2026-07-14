/**
 * Why these tests matter: the GPS satellites are a PERMANENT ambient
 * feature (easter-egg catalog E2/№0) animated by the same continuous
 * clock loop as the particles. If their motion stopped being a pure
 * function of the clock it would break the story's scrub-path-
 * independence; if an orbit left the 35–45 band it would collide with
 * the intro camera path or sink into the world; and reduced-motion /
 * low-tier visitors must still see them PARKED (static compositions
 * stay complete — they are never hidden, only frozen).
 */
import { describe, expect, it } from "vitest";
import { Vector3, type Mesh } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import {
  buildSatellites,
  SATELLITES_NAME,
  updateSatellites,
} from "./satellites";

function positionsOf(group: ReturnType<typeof buildSatellites>): string[] {
  const out: string[] = [];
  group.traverse((obj) => {
    out.push(`${obj.name}:${obj.position.toArray().join(",")}`);
  });
  return out;
}

describe("buildSatellites", () => {
  it("builds a named group of at least one satellite with satellite-role meshes", () => {
    const group = buildSatellites();
    expect(group.name).toBe(SATELLITES_NAME);
    expect(group.children.length).toBeGreaterThanOrEqual(1);
    let roleMeshes = 0;
    group.traverse((obj) => {
      if ((obj as Mesh).userData?.paletteRole === "satellite") {
        roleMeshes += 1;
      }
    });
    // Each satellite is a body + two solar panels.
    expect(roleMeshes).toBeGreaterThanOrEqual(3);
  });

  it("every palette styles the satellite role", () => {
    for (const theme of THEME_IDS) {
      expect(getPalette(theme).roles.satellite, theme).toBeDefined();
    }
  });

  it("is deterministic and builds PARKED at the t=0 orbit pose (reduced motion / low tier)", () => {
    const a = buildSatellites();
    const b = buildSatellites();
    expect(positionsOf(a)).toEqual(positionsOf(b));
    // The build pose IS the clock-zero pose: tiers that never animate
    // still show a complete composition.
    updateSatellites(b, 0);
    expect(positionsOf(a)).toEqual(positionsOf(b));
  });

  it("orbits are a pure function of the clock", () => {
    const a = buildSatellites();
    const b = buildSatellites();
    updateSatellites(a, 123456);
    updateSatellites(a, 777777);
    updateSatellites(a, 123456);
    updateSatellites(b, 123456);
    // Same timestamp → same pose, regardless of the update history.
    expect(positionsOf(a)).toEqual(positionsOf(b));
    // And time actually moves them.
    updateSatellites(b, 999999);
    expect(positionsOf(a)).not.toEqual(positionsOf(b));
  });

  it("keeps every satellite in the visible 28–36 band over the world disc", () => {
    // The catalog's 35–45 band orbited ABOVE every story framing's
    // frustum (screenshot-verified invisible) — the envelope was
    // consciously lowered at implementation, per the catalog's
    // decide-by-screenshot note: high above all world content (skyline
    // tops out ~15) yet crossing the pull-back framings' sky.
    const group = buildSatellites();
    for (let t = 0; t <= 240_000; t += 1000) {
      updateSatellites(group, t);
      for (const satellite of group.children) {
        const p = satellite.position;
        expect(p.y, `y at t=${t}`).toBeGreaterThanOrEqual(28);
        expect(p.y, `y at t=${t}`).toBeLessThanOrEqual(36);
        const horizontal = new Vector3(p.x, 0, p.z).length();
        // Over the little world, never off at the fog horizon.
        expect(horizontal, `radius at t=${t}`).toBeLessThanOrEqual(20);
      }
    }
  });
});
