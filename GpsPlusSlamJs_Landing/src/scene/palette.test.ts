import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";
import { THEME_IDS } from "../theme";
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
  it("defines every role in every palette", () => {
    for (const theme of THEME_IDS) {
      const palette = getPalette(theme);
      for (const role of PALETTE_ROLES) {
        expect(palette.roles[role], `${theme}/${role}`).toBeDefined();
      }
    }
  });

  it("keeps the color CODING invariant across ALL palettes (round-2 D3)", () => {
    // GPS/QR = amber family, anchors = brand red, so the copy highlights
    // and the story stay readable no matter which palette is cycled to.
    for (const theme of THEME_IDS) {
      const roles = getPalette(theme).roles;
      expect(roles.markerFused.color, `${theme}/fused`).toBe(0xef4444);
      expect(roles.poi.color, `${theme}/poi`).toBe(0xef4444);
      // Amber family: red and green channels high, blue low.
      const amber = roles.markerRaw.color;
      expect((amber >> 16) & 0xff, `${theme}/raw R`).toBeGreaterThan(150);
      expect(amber & 0xff, `${theme}/raw B`).toBeLessThan(100);
    }
  });

  it("keeps the dark theme's world objects readable against the background (round-4 V3)", () => {
    // Round-4 feedback: skyline city, statue and path were "dark gray on
    // near-black" — barely recognizable. Pin a WCAG-contrast floor per
    // flagged role over the dark background so a future palette tweak can
    // never silently sink the world into the night again. Floors sit one
    // visible step above the flagged (too dark) values.
    const wcagChannel = (byte: number): number => {
      const c = byte / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (hex: number): number =>
      0.2126 * wcagChannel((hex >> 16) & 0xff) +
      0.7152 * wcagChannel((hex >> 8) & 0xff) +
      0.0722 * wcagChannel(hex & 0xff);
    const dark = getPalette("dark");
    const background = luminance(dark.background);
    const contrast = (role: PaletteRole): number =>
      (luminance(dark.roles[role].color) + 0.05) / (background + 0.05);
    expect(contrast("skyline"), "skyline").toBeGreaterThanOrEqual(2.0);
    expect(contrast("path"), "path").toBeGreaterThanOrEqual(2.2);
    expect(contrast("statue"), "statue").toBeGreaterThanOrEqual(3.0);
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
