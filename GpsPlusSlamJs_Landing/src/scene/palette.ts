import { Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { Theme } from "../theme";

/**
 * Dual scene palettes for the light/dark theme toggle.
 *
 * Every mesh in the scene carries a `userData.paletteRole`; applying a
 * palette re-colors the whole scene graph in one traversal, which is what
 * makes the theme toggle (and its animated cross-fade) cheap. The plan's
 * visual decision is encoded here: light = white/matte clay world, dark =
 * night world with glowing anchors (emissive accents). The fused-anchor
 * accent stays the brand red #ef4444 in both themes, matching the page
 * chrome's `--accent`.
 */

export const PALETTE_ROLES = [
  "ground",
  "path",
  "hill",
  "foliage",
  "trunk",
  "rock",
  "sign",
  "signPanel",
  "statue",
  "person",
  "markerRaw",
  "markerFused",
  "snapRing",
  "qrModule",
  "poi",
  "phone",
  "screen",
  "arrow",
  "label",
  "treasure",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

interface RoleStyle {
  readonly color: number;
  /** Emissive color; defaults to `color` when only intensity is set. */
  readonly emissive?: number;
  /** 0 (matte) unless the theme wants the part to glow. */
  readonly emissiveIntensity?: number;
}

export interface ScenePalette {
  readonly background: number;
  readonly fog: {
    readonly color: number;
    readonly near: number;
    readonly far: number;
  };
  readonly hemisphere: {
    readonly sky: number;
    readonly ground: number;
    readonly intensity: number;
  };
  readonly directional: { readonly color: number; readonly intensity: number };
  readonly roles: Readonly<Record<PaletteRole, RoleStyle>>;
}

const ACCENT = 0xef4444;

const LIGHT: ScenePalette = {
  background: 0xf2f1ed,
  fog: { color: 0xf2f1ed, near: 40, far: 90 },
  hemisphere: { sky: 0xffffff, ground: 0xd8d4cc, intensity: 1.15 },
  directional: { color: 0xffffff, intensity: 1.6 },
  roles: {
    ground: { color: 0xe9e6df },
    path: { color: 0xd8d2c6 },
    hill: { color: 0xe2ded4 },
    foliage: { color: 0xa7c49a },
    trunk: { color: 0xb59a7a },
    rock: { color: 0xcfccc5 },
    sign: { color: 0xb59a7a },
    signPanel: { color: 0xffffff },
    statue: { color: 0xd8d5cf },
    person: { color: 0x35353d },
    markerRaw: { color: 0xeab308 },
    markerFused: { color: ACCENT, emissiveIntensity: 0 },
    snapRing: { color: ACCENT },
    qrModule: { color: 0xb45309 },
    poi: { color: ACCENT },
    phone: { color: 0x2a2a30 },
    screen: { color: 0xffffff },
    arrow: { color: 0x3b82f6 },
    label: { color: 0x2563eb },
    treasure: { color: 0xf59e0b },
  },
};

// Brightened after round-1 feedback ("dark theme too dark, needs a tick
// more contrast"): lifted surface tones + stronger lights against the
// near-black background, glow accents unchanged.
const DARK: ScenePalette = {
  background: 0x0b0b0d,
  fog: { color: 0x0b0b0d, near: 40, far: 90 },
  hemisphere: { sky: 0x565f80, ground: 0x23232c, intensity: 1.15 },
  directional: { color: 0xbfd0ff, intensity: 1.1 },
  roles: {
    ground: { color: 0x23232b },
    path: { color: 0x3a3a46 },
    hill: { color: 0x2a2a33 },
    foliage: { color: 0x2e5240 },
    trunk: { color: 0x4d4136 },
    rock: { color: 0x3c3c45 },
    sign: { color: 0x4d4136 },
    signPanel: { color: 0xd9d9e0, emissiveIntensity: 0.25 },
    statue: { color: 0x50505c },
    person: { color: 0xe7e7ea, emissiveIntensity: 0.35 },
    markerRaw: { color: 0xfacc15, emissiveIntensity: 0.6 },
    markerFused: { color: ACCENT, emissiveIntensity: 0.9 },
    snapRing: { color: ACCENT, emissiveIntensity: 0.9 },
    qrModule: { color: 0xfbbf24, emissiveIntensity: 0.5 },
    poi: { color: ACCENT, emissiveIntensity: 0.8 },
    phone: { color: 0x101014 },
    screen: { color: 0x2c3550, emissiveIntensity: 0.5 },
    arrow: { color: 0x60a5fa, emissiveIntensity: 0.7 },
    label: { color: 0x93b4ff, emissiveIntensity: 0.7 },
    treasure: { color: 0xfbbf24, emissiveIntensity: 0.7 },
  },
};

export function getPalette(theme: Theme): ScenePalette {
  return theme === "light" ? LIGHT : DARK;
}

function isPaletteRole(value: unknown): value is PaletteRole {
  return (
    typeof value === "string" &&
    (PALETTE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Recolor every role-tagged mesh under `root` with the given palette.
 * Meshes without a (known) role and non-standard materials are left
 * untouched — bad tags degrade to "keeps previous color", never a crash.
 */
export function applyPaletteToScene(
  root: Object3D,
  palette: ScenePalette,
): void {
  root.traverse((obj) => {
    const role: unknown = obj.userData.paletteRole;
    if (!isPaletteRole(role) || !(obj as Mesh).isMesh) {
      return;
    }
    const material = (obj as Mesh).material;
    if (!(material instanceof MeshStandardMaterial)) {
      return;
    }
    const style = palette.roles[role];
    material.color.setHex(style.color);
    material.emissive.setHex(style.emissive ?? style.color);
    material.emissiveIntensity = style.emissiveIntensity ?? 0;
  });
}

/**
 * Standard factory for a role-tagged clay mesh: flat-shaded standard
 * material (own instance per mesh so palette applies stay independent),
 * shadows on by default.
 */
export function clayMesh(
  geometry: Mesh["geometry"],
  role: PaletteRole,
  name = "",
): Mesh {
  const material = new MeshStandardMaterial({
    roughness: 0.9,
    flatShading: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.userData.paletteRole = role;
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Convenience for a named group (keeps scene-building code terse). */
export function namedGroup(name: string): Group {
  const group = new Group();
  group.name = name;
  return group;
}
