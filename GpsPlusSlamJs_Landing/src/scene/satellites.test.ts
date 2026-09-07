/**
 * Why these tests matter: the GPS satellites (catalog №0, reworked in
 * round-14 R14-9) now ROAM across the high sky on autonomous passes —
 * they cross, leave, and return later on a hashed track, so you only
 * catch one "wenn man Glück hat". The schedule MUST be a pure function of
 * the clock (no runtime Math.random — that would break scrub-path
 * independence), a crossing must actually move the satellite high across
 * the sky, and between passes the satellite must be hidden. Reduced
 * motion / low tier never animate them, so the BUILT pose must be a
 * complete visible composition.
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

function poseKey(group: ReturnType<typeof buildSatellites>): string {
  return group.children
    .map((s) => `${s.visible}:${s.position.toArray().join(",")}`)
    .join("|");
}

describe("buildSatellites", () => {
  it("builds a named group of satellites with satellite-role meshes", () => {
    const group = buildSatellites();
    expect(group.name).toBe(SATELLITES_NAME);
    expect(group.children.length).toBeGreaterThanOrEqual(2);
    let roleMeshes = 0;
    group.traverse((obj) => {
      if ((obj as Mesh).userData?.paletteRole === "satellite") {
        roleMeshes += 1;
      }
    });
    expect(roleMeshes).toBeGreaterThanOrEqual(6); // body + 2 panels each
  });

  it("every palette styles the satellite role", () => {
    for (const theme of THEME_IDS) {
      expect(getPalette(theme).roles.satellite, theme).toBeDefined();
    }
  });

  it("parks visibly and high for reduced motion / low tier (no update called)", () => {
    const group = buildSatellites();
    for (const s of group.children) {
      expect(s.visible).toBe(true);
      expect(s.position.y).toBeGreaterThan(20); // up in the sky
    }
  });

  it("is deterministic: two builds are identical", () => {
    expect(poseKey(buildSatellites())).toBe(poseKey(buildSatellites()));
  });
});

describe("updateSatellites (roaming passes)", () => {
  it("is a pure function of the clock (history-independent)", () => {
    const a = buildSatellites();
    const b = buildSatellites();
    updateSatellites(a, 5_000);
    updateSatellites(a, 123_456);
    updateSatellites(a, 5_000);
    updateSatellites(b, 5_000);
    expect(poseKey(a)).toBe(poseKey(b));
  });

  it("crosses the high sky during a pass, then goes away between passes", () => {
    const group = buildSatellites();
    const sat = group.children[0]!;

    // Find a time where satellite 0 is visible (early in its first pass).
    updateSatellites(group, 1_000);
    expect(sat.visible).toBe(true);
    const a = sat.position.clone();
    updateSatellites(group, 12_000); // later in the same pass
    const b = sat.position.clone();
    expect(sat.visible).toBe(true);
    // It travelled a long way across the sky…
    expect(a.distanceTo(b)).toBeGreaterThan(10);
    // …staying high (above the ~15-unit skyline).
    expect(a.y).toBeGreaterThan(20);
    expect(b.y).toBeGreaterThan(20);

    // Between passes (just after its visible window ends): gone.
    updateSatellites(group, 44_000); // period 46s, visible 30s → hidden
    expect(sat.visible).toBe(false);
  });

  it("brings a satellite back on a LATER, different pass", () => {
    const group = buildSatellites();
    const sat = group.children[0]!;
    // Pass 0 early vs pass 1 early (one period later): different tracks.
    updateSatellites(group, 1_000);
    const pass0 = sat.position.clone();
    updateSatellites(group, 47_000); // 46s period → next pass, ~same phase
    expect(sat.visible).toBe(true);
    const pass1 = sat.position.clone();
    expect(pass0.distanceTo(pass1)).toBeGreaterThan(1); // hashed to differ
  });

  it("keeps every visible satellite within the world's horizontal reach", () => {
    const group = buildSatellites();
    for (let t = 0; t <= 240_000; t += 1500) {
      updateSatellites(group, t);
      for (const s of group.children) {
        if (!s.visible) {
          continue;
        }
        expect(s.position.y, `y at ${t}`).toBeGreaterThan(20);
        const horizontal = new Vector3(s.position.x, 0, s.position.z).length();
        expect(horizontal, `radius at ${t}`).toBeLessThan(80);
      }
    }
  });
});
