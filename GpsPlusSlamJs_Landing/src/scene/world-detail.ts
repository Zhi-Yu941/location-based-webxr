import {
  CircleGeometry,
  ConeGeometry,
  DataTexture,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBAFormat,
  Vector3,
} from "three";
import { namedGroup } from "./palette";
import type { CatmullRomCurve3, Group } from "three";

/**
 * World-detail layer (v3 F7): instanced grass tufts and soft fake
 * contact shadows under the anchored props. Everything is deterministic
 * (seeded LCG) and cheap — the grass is ONE InstancedMesh (single draw
 * call), shadows are flat alpha-gradient discs (no extra lights, no
 * shadow-map cost). The F7 curb stones were REMOVED in round-9: they
 * read as distracting spikes beside the path (test-pinned).
 */

export const GRASS_NAME = "world-grass";
export const CONTACT_SHADOWS_NAME = "world-contact-shadows";
export const CONTACT_SHADOW_PREFIX = "contact-shadow-";

/** Tier-scaled tuft counts — the low tier keeps its cost profile. */
export const GRASS_COUNTS = { high: 300, low: 100 } as const;

const PATH_CLEARANCE = 1.2;
const ANCHOR_CLEARANCE = 2.5;
const WORLD_RADIUS = 30;

/** Deterministic LCG (same recipe as clay-world) — art, not crypto. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Flat-shaded clay material; the palette traversal recolors it via the
 * `paletteRole` tag on the mesh. */
function detailMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ roughness: 0.9, flatShading: true });
}

/**
 * Instanced grass tufts scattered over the meadow, clear of the path
 * and the story anchors so they never block the walk or a composition.
 * The curve/anchors are parameters (clay-world passes its own) so this
 * module stays free of a clay-world import cycle.
 */
export function buildGrass(
  detail: "high" | "low",
  curve: CatmullRomCurve3,
  anchors: readonly Vector3[],
): InstancedMesh {
  const count = GRASS_COUNTS[detail];
  const rng = createRng(20260715);
  const pathPoints: Vector3[] = [];
  for (let i = 0; i <= 100; i += 1) {
    pathPoints.push(curve.getPointAt(i / 100));
  }
  const geometry = new ConeGeometry(0.06, 0.4, 4);
  geometry.translate(0, 0.2, 0);
  const grass = new InstancedMesh(geometry, detailMaterial(), count);
  grass.name = GRASS_NAME;
  grass.userData.paletteRole = "grass";
  grass.castShadow = false;
  grass.receiveShadow = false;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 40) {
    attempts += 1;
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * (WORLD_RADIUS - 6);
    const candidate = new Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    );
    const nearPath = pathPoints.some(
      (p) => p.distanceTo(candidate) < PATH_CLEARANCE + 0.2,
    );
    const nearAnchor = anchors.some(
      (a) => a.distanceTo(candidate) < ANCHOR_CLEARANCE + 0.2,
    );
    if (nearPath || nearAnchor) {
      continue;
    }
    quaternion.setFromAxisAngle(up, rng() * Math.PI * 2);
    const scale = 0.7 + rng() * 0.8;
    matrix.compose(
      candidate,
      quaternion,
      new Vector3(scale, scale * (0.8 + rng() * 0.6), scale),
    );
    grass.setMatrixAt(placed, matrix);
    placed += 1;
  }
  // Fill any unplaced instances far below ground (invisible) so count
  // stays exact without a resize.
  for (let i = placed; i < count; i += 1) {
    matrix.makeTranslation(0, -50, 0);
    grass.setMatrixAt(i, matrix);
  }
  grass.instanceMatrix.needsUpdate = true;
  return grass;
}

/** Radial alpha falloff texture (procedural — works headless in tests). */
function radialShadowTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x / (size - 1)) * 2 - 1;
      const dy = (y / (size - 1)) * 2 - 1;
      const d = Math.min(1, Math.hypot(dx, dy));
      const alpha = Math.round((1 - d) * (1 - d) * 255);
      const i = (y * size + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = alpha;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * One soft fake contact shadow: a flat gradient disc on the ground —
 * deliberately NOT a billboard sprite (it must lie on the floor).
 */
export function buildContactShadow(name: string, radius: number): Mesh {
  const material = new MeshBasicMaterial({
    map: radialShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.32,
  });
  const disc = new Mesh(new CircleGeometry(radius, 24), material);
  disc.name = `${CONTACT_SHADOW_PREFIX}${name}`;
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  disc.renderOrder = 1;
  return disc;
}

/** The anchor spots the static contact shadows sit under. */
export interface ContactShadowAnchors {
  readonly statue: Vector3;
  readonly markerPair: Vector3;
  readonly sign: Vector3;
}

/** Contact shadows under the statically anchored props. */
export function buildContactShadows(anchors: ContactShadowAnchors): Group {
  const group = namedGroup(CONTACT_SHADOWS_NAME);
  const statue = buildContactShadow("statue", 1.5);
  statue.position.set(anchors.statue.x, 0.02, anchors.statue.z);
  const marker = buildContactShadow("marker-pair", 1.0);
  marker.position.set(anchors.markerPair.x, 0.02, anchors.markerPair.z);
  const sign = buildContactShadow("sign", 0.9);
  sign.position.set(anchors.sign.x, 0.02, anchors.sign.z);
  group.add(statue, marker, sign);
  return group;
}
