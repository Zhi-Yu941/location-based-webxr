import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  type Group,
  type Object3D,
} from "three";
import { namedGroup, type ScenePalette } from "./palette";

/**
 * Per-palette sky (v3 F3): one vertex-colored gradient dome plus
 * palette-specific celestial accents — dark = moon + star points,
 * dusk = low sun + warm horizon band, neon = synthwave star grid,
 * light/mono = the soft zenith gradient alone.
 *
 * The dome is UNLIT and OUTSIDE the scene fog (`fog: false` on every
 * material): it sits at radius 150 while the fog ends at ~90, so with
 * fog enabled it would render as a flat fog-colored shell and hide all
 * accents. It writes no depth and renders first (negative renderOrder),
 * so the world always draws on top. The amber/red/blue color-coding
 * invariant is untouched — sky colors live in `palette.sky` only.
 */

export const SKY_NODE = {
  root: "sky-dome",
  shell: "sky-dome-shell",
  moon: "sky-moon",
  stars: "sky-stars",
  sun: "sky-sun",
  horizonBand: "sky-horizon-band",
  starGrid: "sky-star-grid",
} as const;

/** Dome radius: outside the world (30) + skyline (~48), inside camera far (220). */
const SKY_RADIUS = 150;

/** Deterministic LCG (same recipe as clay-world) — art, not crypto. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * The analytic dome gradient: elevation 0 (horizon) → `sky.horizon`,
 * elevation 1 (zenith) → `sky.zenith`, smoothstep in between. Exported
 * so tests can pin the gradient without sampling vertex buffers.
 */
export function domeGradientColorAt(
  elevation01: number,
  palette: ScenePalette,
): Color {
  const t = Math.min(1, Math.max(0, elevation01));
  const smooth = t * t * (3 - 2 * t);
  return new Color(palette.sky.horizon).lerp(
    new Color(palette.sky.zenith),
    smooth,
  );
}

function unlit(color = 0xffffff): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, fog: false });
}

function buildShell(): Mesh {
  // Slightly more than a hemisphere so the gradient dips below y=0 and
  // no seam shows at the horizon.
  const geometry = new SphereGeometry(
    SKY_RADIUS,
    32,
    16,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.62,
  );
  const material = new MeshBasicMaterial({
    side: BackSide,
    vertexColors: true,
    fog: false,
    depthWrite: false,
  });
  const shell = new Mesh(geometry, material);
  shell.name = SKY_NODE.shell;
  shell.renderOrder = -10;
  shell.frustumCulled = false;
  return shell;
}

function buildMoon(): Mesh {
  const moon = new Mesh(new SphereGeometry(5, 16, 12), unlit());
  moon.name = SKY_NODE.moon;
  // Rising moon just above the skyline in the dive camera's sky sector
  // (same azimuth family as the dusk sun) so it is actually IN frame.
  moon.position.set(10, 24, -124);
  moon.renderOrder = -9;
  return moon;
}

function starPoints(
  name: string,
  positions: Float32Array,
  size: number,
): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    size,
    sizeAttenuation: false,
    fog: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.name = name;
  points.renderOrder = -9;
  points.frustumCulled = false;
  return points;
}

/** Random star sprinkle on the upper dome (dark palette). */
function buildStars(): Points {
  const rng = createRng(20260713);
  const count = 140;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const azimuth = rng() * Math.PI * 2;
    // Bias toward higher elevations; keep stars off the horizon haze.
    const elevation = Math.asin(0.15 + rng() * 0.83);
    const r = SKY_RADIUS * 0.96;
    positions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * r;
    positions[i * 3 + 1] = Math.sin(elevation) * r;
    positions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * r;
  }
  return starPoints(SKY_NODE.stars, positions, 2.5);
}

/** Regular azimuth/elevation grid of points (neon palette). */
function buildStarGrid(): Points {
  const azimuthSteps = 36;
  // Start low: the dive camera only sees the first ~25° above the horizon.
  const elevations = [0.08, 0.18, 0.3, 0.44, 0.6, 0.78];
  const positions = new Float32Array(azimuthSteps * elevations.length * 3);
  let i = 0;
  for (const elevation01 of elevations) {
    const elevation = elevation01 * (Math.PI / 2);
    for (let a = 0; a < azimuthSteps; a += 1) {
      const azimuth = (a / azimuthSteps) * Math.PI * 2;
      const r = SKY_RADIUS * 0.96;
      positions[i] = Math.cos(azimuth) * Math.cos(elevation) * r;
      positions[i + 1] = Math.sin(elevation) * r;
      positions[i + 2] = Math.sin(azimuth) * Math.cos(elevation) * r;
      i += 3;
    }
  }
  return starPoints(SKY_NODE.starGrid, positions, 2);
}

function buildSun(): Mesh {
  const sun = new Mesh(new SphereGeometry(9, 20, 14), unlit());
  sun.name = SKY_NODE.sun;
  // Low over the horizon, roughly where the dive camera faces.
  sun.position.set(30, 14, -128);
  sun.renderOrder = -9;
  return sun;
}

function buildHorizonBand(): Mesh {
  const geometry = new CylinderGeometry(
    SKY_RADIUS * 0.97,
    SKY_RADIUS * 0.97,
    9,
    48,
    1,
    true,
  );
  const material = new MeshBasicMaterial({
    side: BackSide,
    fog: false,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const band = new Mesh(geometry, material);
  band.name = SKY_NODE.horizonBand;
  band.position.y = 4;
  band.renderOrder = -9;
  band.frustumCulled = false;
  return band;
}

/** Build the whole sky group; all accents start hidden until a palette applies. */
export function buildSkyDome(): Group {
  const sky = namedGroup(SKY_NODE.root);
  const accents: Object3D[] = [
    buildMoon(),
    buildStars(),
    buildSun(),
    buildHorizonBand(),
    buildStarGrid(),
  ];
  for (const accent of accents) {
    accent.visible = false;
  }
  sky.add(buildShell(), ...accents);
  return sky;
}

function setAccentVisibility(sky: Group, palette: ScenePalette): void {
  const visibleByKind: Record<string, readonly string[]> = {
    "moon-stars": [SKY_NODE.moon, SKY_NODE.stars],
    sun: [SKY_NODE.sun, SKY_NODE.horizonBand],
    "star-grid": [SKY_NODE.starGrid],
    none: [],
  };
  const visible = visibleByKind[palette.sky.accents] ?? [];
  for (const name of [
    SKY_NODE.moon,
    SKY_NODE.stars,
    SKY_NODE.sun,
    SKY_NODE.horizonBand,
    SKY_NODE.starGrid,
  ]) {
    const node = sky.getObjectByName(name);
    if (node) {
      node.visible = visible.includes(name);
    }
  }
}

function paintShellGradient(sky: Group, palette: ScenePalette): void {
  const shell = sky.getObjectByName(SKY_NODE.shell) as Mesh | undefined;
  if (!shell) {
    return;
  }
  const geometry = shell.geometry;
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i += 1) {
    const elevation01 = Math.max(0, positions.getY(i) / SKY_RADIUS);
    const color = domeGradientColorAt(elevation01, palette);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

function recolorAccents(sky: Group, palette: ScenePalette): void {
  for (const name of [
    SKY_NODE.moon,
    SKY_NODE.stars,
    SKY_NODE.sun,
    SKY_NODE.horizonBand,
    SKY_NODE.starGrid,
  ]) {
    const node = sky.getObjectByName(name);
    const material = (node as Mesh | Points | undefined)?.material;
    if (material instanceof MeshBasicMaterial) {
      material.color.setHex(palette.sky.accentColor);
    } else if (material instanceof PointsMaterial) {
      material.color.setHex(palette.sky.accentColor);
    }
  }
}

/**
 * Apply a palette to the sky: repaint the dome gradient, toggle the
 * palette's accent set, recolor accents. Missing nodes degrade to
 * no-ops — a malformed sky never breaks the theme toggle.
 */
export function applySkyPalette(sky: Group, palette: ScenePalette): void {
  paintShellGradient(sky, palette);
  setAccentVisibility(sky, palette);
  recolorAccents(sky, palette);
}
