import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";
import {
  applyPaletteToScene,
  getPalette,
  PALETTE_ROLES,
  type PaletteRole,
} from "./palette";

// Why this test matters: the dual palette is the "both themes with a toggle"
// product decision. A role missing from one theme would silently leave
// meshes in the other theme's colors after a toggle; a drifted accent would
// break the brand continuity with the page chrome (--accent: #ef4444).

describe("getPalette", () => {
  it("defines every role in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const palette = getPalette(theme);
      for (const role of PALETTE_ROLES) {
        expect(palette.roles[role], `${theme}/${role}`).toBeDefined();
      }
    }
  });

  it("keeps the fused-anchor accent at the brand red #ef4444 in both themes", () => {
    expect(getPalette("light").roles.markerFused.color).toBe(0xef4444);
    expect(getPalette("dark").roles.markerFused.color).toBe(0xef4444);
  });

  it("gives the dark theme glowing accents (emissive) and the light theme matte clay", () => {
    // The plan's visual decision: dark = glowing anchors/traces, light =
    // matte clay. Emissive intensity is the mechanism.
    const dark = getPalette("dark").roles.markerFused;
    const light = getPalette("light").roles.markerFused;
    expect(dark.emissiveIntensity ?? 0).toBeGreaterThan(0);
    expect(light.emissiveIntensity ?? 0).toBe(0);
  });
});

describe("applyPaletteToScene", () => {
  function roleMesh(role: PaletteRole): Mesh {
    const mesh = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
    mesh.userData.paletteRole = role;
    return mesh;
  }

  it("recolors every role-tagged mesh in the subtree", () => {
    const root = new Group();
    const ground = roleMesh("ground");
    const nested = new Group();
    const marker = roleMesh("markerFused");
    nested.add(marker);
    root.add(ground, nested);

    applyPaletteToScene(root, getPalette("dark"));
    const darkGround = getPalette("dark").roles.ground.color;
    expect((ground.material as MeshStandardMaterial).color.getHex()).toBe(
      darkGround,
    );
    expect((marker.material as MeshStandardMaterial).color.getHex()).toBe(
      0xef4444,
    );

    // Toggling back fully restores the other palette (no sticky state).
    applyPaletteToScene(root, getPalette("light"));
    expect((ground.material as MeshStandardMaterial).color.getHex()).toBe(
      getPalette("light").roles.ground.color,
    );
  });

  it("ignores meshes without a role tag and unknown role strings", () => {
    const root = new Group();
    const plain = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
    plain.material.color.setHex(0x123456);
    const bogus = new Mesh(new SphereGeometry(1), new MeshStandardMaterial());
    bogus.userData.paletteRole = "not-a-real-role";
    bogus.material.color.setHex(0x654321);
    root.add(plain, bogus);

    applyPaletteToScene(root, getPalette("dark"));
    expect(plain.material.color.getHex()).toBe(0x123456);
    expect(bogus.material.color.getHex()).toBe(0x654321);
  });
});
