import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Procedural low-poly "clay world": the miniature landscape every chapter
 * plays in. All content is generated (no GLTF downloads — the plan's asset
 * budget) and DETERMINISTIC via a seeded LCG, so tests can pin structure
 * and two page loads look identical.
 *
 * The story timeline addresses parts of the world by the names in
 * `WORLD_NODE` and stages the dot-person along `createPathCurve()`;
 * `WORLD_ANCHORS` are the story hot-spots (QR sign, marker pair, statue).
 */

export const WORLD_NODE = {
  root: "clay-world",
  ground: "world-ground",
  path: "world-path",
  hills: "world-hills",
  trees: "world-trees",
  rocks: "world-rocks",
  sign: "world-sign",
  statue: "world-statue",
  snapRing: "world-snap-ring",
  outer: "world-outer",
  gallery: "world-gallery",
} as const;

const WORLD_RADIUS = 30;
const PATH_WIDTH = 1.6;

/** The S-curve the dot-person walks; ground level (y = 0). */
export function createPathCurve(): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    [
      new Vector3(-16, 0, 12),
      new Vector3(-8, 0, 6),
      new Vector3(-2, 0, 8),
      new Vector3(4, 0, 2),
      new Vector3(2, 0, -6),
      new Vector3(10, 0, -12),
    ],
    false,
    "catmullrom",
    0.5,
  );
}

/** Story hot-spots, derived from the path so they stay beside it. */
export const WORLD_ANCHORS = {
  /** QR sign near the path start (chapter: qr). */
  sign: new Vector3(-9.5, 0, 8.2),
  /** Raw-vs-fused marker pair at mid-path (chapter: fusion). */
  markerPair: new Vector3(1.5, 0, 6.5),
  /** Statue a short detour off the path (chapter: gallery labels). */
  statue: new Vector3(8, 0, -4),
} as const;

/** Deterministic LCG (numerical recipes constants) — NOT crypto, just art. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface DetailCounts {
  trees: number;
  rocks: number;
  hills: number;
  outerTrees: number;
  pathSegments: number;
}

const DETAIL: Record<"high" | "low", DetailCounts> = {
  high: { trees: 22, rocks: 12, hills: 7, outerTrees: 10, pathSegments: 60 },
  low: { trees: 9, rocks: 5, hills: 4, outerTrees: 4, pathSegments: 30 },
};

function buildGround(): Group {
  const group = namedGroup(WORLD_NODE.ground);
  const disc = clayMesh(
    new CylinderGeometry(WORLD_RADIUS, WORLD_RADIUS + 2, 1.6, 28),
    "ground",
  );
  disc.position.y = -0.8;
  disc.castShadow = false;
  group.add(disc);
  return group;
}

function buildPath(segments: number): Group {
  const group = namedGroup(WORLD_NODE.path);
  const curve = createPathCurve();
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const slab = clayMesh(new BoxGeometry(PATH_WIDTH, 0.12, 1.1), "path");
    slab.position.set(point.x, 0.06, point.z);
    slab.rotation.y = Math.atan2(tangent.x, tangent.z);
    slab.castShadow = false;
    group.add(slab);
  }
  return group;
}

function buildTree(rng: () => number): Group {
  const tree = new Group();
  const height = 1.6 + rng() * 1.6;
  const trunk = clayMesh(
    new CylinderGeometry(0.14, 0.2, height * 0.45, 6),
    "trunk",
  );
  trunk.position.y = height * 0.225;
  const crown = clayMesh(
    new ConeGeometry(0.7 + rng() * 0.5, height, 7),
    "foliage",
  );
  crown.position.y = height * 0.45 + height / 2;
  tree.add(trunk, crown);
  return tree;
}

function buildRock(rng: () => number): Group {
  const rock = new Group();
  const mesh = clayMesh(new IcosahedronGeometry(0.3 + rng() * 0.5, 0), "rock");
  mesh.position.y = 0.25;
  mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  rock.add(mesh);
  return rock;
}

function buildHill(rng: () => number): Group {
  const hill = new Group();
  const radius = 2.5 + rng() * 3.5;
  const mesh = clayMesh(new SphereGeometry(radius, 10, 7), "hill");
  mesh.position.y = -radius * 0.55;
  mesh.castShadow = false;
  hill.add(mesh);
  return hill;
}

/**
 * Scatter `count` pieces inside the world disc while keeping a margin from
 * the path (sampled at 100 points) and from the story anchors.
 */
function scatter(
  name: string,
  count: number,
  rng: () => number,
  build: (rng: () => number) => Group,
  minPathDistance: number,
): Group {
  const group = namedGroup(name);
  const curve = createPathCurve();
  const pathPoints: Vector3[] = [];
  for (let i = 0; i <= 100; i++) {
    pathPoints.push(curve.getPointAt(i / 100));
  }
  const anchors = Object.values(WORLD_ANCHORS);
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 30) {
    attempts++;
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * (WORLD_RADIUS - 5);
    const candidate = new Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    );
    const nearPath = pathPoints.some(
      (p) => p.distanceTo(candidate) < minPathDistance,
    );
    const nearAnchor = anchors.some((a) => a.distanceTo(candidate) < 3);
    if (nearPath || nearAnchor) {
      continue;
    }
    const piece = build(rng);
    piece.position.copy(candidate);
    piece.rotation.y = rng() * Math.PI * 2;
    group.add(piece);
    placed++;
  }
  return group;
}

function buildSign(): Group {
  const sign = namedGroup(WORLD_NODE.sign);
  const post = clayMesh(new CylinderGeometry(0.08, 0.1, 1.6, 6), "sign");
  post.position.y = 0.8;
  const panel = clayMesh(new BoxGeometry(1.1, 1.1, 0.08), "signPanel");
  panel.position.y = 2.0;
  // Stylized QR: a grid of small dark cubes on the panel front.
  const qr = new Group();
  qr.name = "world-sign-qr";
  const cell = 0.16;
  const rng = createRng(7);
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const corner =
        (row < 2 && col < 2) || (row < 2 && col > 2) || (row > 2 && col < 2);
      if (!corner && rng() < 0.45) {
        continue;
      }
      const dot = clayMesh(
        new BoxGeometry(cell * 0.8, cell * 0.8, 0.04),
        "phone",
      );
      dot.position.set((col - 2) * cell, 2.0 + (row - 2) * cell, 0.06);
      dot.castShadow = false;
      qr.add(dot);
    }
  }
  sign.add(post, panel, qr);
  sign.position.copy(WORLD_ANCHORS.sign);
  sign.rotation.y = Math.PI / 5;
  return sign;
}

function buildStatue(): Group {
  const statue = namedGroup(WORLD_NODE.statue);
  const pedestal = clayMesh(new BoxGeometry(1.2, 0.8, 1.2), "statue");
  pedestal.position.y = 0.4;
  const figure = clayMesh(new ConeGeometry(0.4, 1.4, 8), "statue");
  figure.position.y = 1.5;
  const head = clayMesh(new SphereGeometry(0.28, 10, 8), "statue");
  head.position.y = 2.4;
  statue.add(pedestal, figure, head);
  statue.position.copy(WORLD_ANCHORS.statue);
  return statue;
}

/** Pulsing ring used for the QR "snap" moment; hidden until then. */
function buildSnapRing(): Group {
  const group = namedGroup(WORLD_NODE.snapRing);
  const ring = clayMesh(new TorusGeometry(1.2, 0.06, 8, 32), "snapRing");
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  ring.castShadow = false;
  group.add(ring);
  group.position.copy(WORLD_ANCHORS.sign);
  group.visible = false;
  return group;
}

/**
 * The "works anywhere" reveal: a wider unmapped-park ring around the world
 * disc with sparse trees. Hidden until the anywhere chapter pulls back.
 */
function buildOuter(counts: DetailCounts, rng: () => number): Group {
  const outer = namedGroup(WORLD_NODE.outer);
  const ring = clayMesh(
    new CylinderGeometry(WORLD_RADIUS + 18, WORLD_RADIUS + 20, 1.2, 28),
    "ground",
  );
  ring.position.y = -1.0;
  ring.castShadow = false;
  outer.add(ring);
  for (let i = 0; i < counts.outerTrees; i++) {
    const tree = buildTree(rng);
    const angle = rng() * Math.PI * 2;
    const radius = WORLD_RADIUS + 4 + rng() * 12;
    tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    outer.add(tree);
  }
  outer.visible = false;
  return outer;
}

/** Use-case gallery props: trail arrows, statue labels, treasures. */
function buildGallery(rng: () => number): Group {
  const gallery = namedGroup(WORLD_NODE.gallery);
  const curve = createPathCurve();
  for (let i = 0; i < 5; i++) {
    const t = 0.15 + i * 0.15;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const arrow = clayMesh(new ConeGeometry(0.28, 0.8, 6), "arrow");
    arrow.position.set(point.x, 1.4, point.z);
    arrow.rotation.set(
      Math.PI / 2,
      0,
      -Math.atan2(tangent.x, tangent.z),
      "YXZ",
    );
    gallery.add(arrow);
  }
  const label = clayMesh(new PlaneGeometry(1.8, 0.6), "label");
  label.position.set(WORLD_ANCHORS.statue.x, 3.2, WORLD_ANCHORS.statue.z);
  label.castShadow = false;
  gallery.add(label);
  for (let i = 0; i < 4; i++) {
    const treasure = clayMesh(new IcosahedronGeometry(0.3, 0), "treasure");
    const angle = rng() * Math.PI * 2;
    const radius = 6 + rng() * 14;
    treasure.position.set(
      Math.cos(angle) * radius,
      0.35,
      Math.sin(angle) * radius,
    );
    gallery.add(treasure);
  }
  gallery.visible = false;
  return gallery;
}

export function buildClayWorld(detail: "high" | "low"): Group {
  const counts = DETAIL[detail];
  const rng = createRng(20260712);
  const world = namedGroup(WORLD_NODE.root);
  world.add(
    buildGround(),
    buildPath(counts.pathSegments),
    scatter(WORLD_NODE.hills, counts.hills, rng, buildHill, 4),
    scatter(WORLD_NODE.trees, counts.trees, rng, buildTree, 2.2),
    scatter(WORLD_NODE.rocks, counts.rocks, rng, buildRock, 1.8),
    buildSign(),
    buildStatue(),
    buildSnapRing(),
    buildOuter(counts, rng),
    buildGallery(rng),
  );
  return world;
}
