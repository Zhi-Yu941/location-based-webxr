import {
  BoxGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { clayMesh, namedGroup } from "./palette";
import { buildPin } from "./markers";

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
  arContent: "world-ar-content",
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

// The marker anchor sits ON the path edge (round-2 R5: the red pin stands
// exactly where the user walks; the sample rings scatter around it).
const anchorCurve = createPathCurve();
const anchorPoint = anchorCurve.getPointAt(0.42);
const anchorTangent = anchorCurve.getTangentAt(0.42);

/** Story hot-spots, derived from the path so they stay beside it. */
export const WORLD_ANCHORS = {
  /** QR sign near the path start (chapter: qr). */
  sign: new Vector3(-9.5, 0, 8.2),
  /** GPS rings + fused pin anchor, on the path edge (chapter: fusion). */
  markerPair: anchorPoint
    .clone()
    .add(new Vector3(anchorTangent.z, 0, -anchorTangent.x).multiplyScalar(0.5)),
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

/**
 * A QR-like module grid (round-1 feedback: the old 5x5 blob did not read
 * as a QR code): 9x9 cells with the three corner finder squares real QR
 * codes have, plus a ~50% random module fill. Modules use the `qrModule`
 * role so the copy highlight (`.hl-code`) can echo their color.
 */
function buildQrGrid(panelY: number): Group {
  const qr = namedGroup("world-sign-qr");
  const grid = 9;
  const cell = 0.1;
  const half = (grid - 1) / 2;
  const rng = createRng(7);

  const moduleAt = (col: number, row: number, parent: Group): void => {
    const dot = clayMesh(
      new BoxGeometry(cell * 0.85, cell * 0.85, 0.04),
      "qrModule",
    );
    dot.position.set((col - half) * cell, panelY + (row - half) * cell, 0.06);
    dot.castShadow = false;
    parent.add(dot);
  };

  // Finder patterns: 3x3 corner squares (outer ring + center like a real
  // QR finder, simplified to filled 3x3 blocks with a gap row around).
  const finderOrigins: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [grid - 3, 0],
    [0, grid - 3],
  ];
  const inFinderZone = (col: number, row: number): boolean =>
    finderOrigins.some(
      ([c0, r0]) =>
        col >= c0 - 1 && col <= c0 + 3 && row >= r0 - 1 && row <= r0 + 3,
    );
  finderOrigins.forEach(([c0, r0], index) => {
    const finder = namedGroup(`qr-finder-${index}`);
    for (let row = r0; row < r0 + 3; row++) {
      for (let col = c0; col < c0 + 3; col++) {
        if (row === r0 + 1 && col === c0 + 1) {
          continue; // hollow center ring look
        }
        moduleAt(col, row, finder);
      }
    }
    qr.add(finder);
  });

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      if (inFinderZone(col, row) || rng() >= 0.5) {
        continue;
      }
      moduleAt(col, row, qr);
    }
  }
  return qr;
}

function buildSign(): Group {
  const sign = namedGroup(WORLD_NODE.sign);
  const post = clayMesh(new CylinderGeometry(0.08, 0.1, 1.6, 6), "sign");
  post.position.y = 0.8;
  const panel = clayMesh(new BoxGeometry(1.1, 1.1, 0.08), "signPanel");
  panel.position.y = 2.0;
  sign.add(post, panel, buildQrGrid(2.0));
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

/**
 * The AR content seen "through the phone" from the dive on (round-1
 * feedback shaped this): trail arrows hovering over the path pointing
 * FORWARD along the walk direction, a red POI pin over the statue, and a
 * hinted text label (board with bars suggesting text) beside it.
 */
function buildArContent(): Group {
  const arContent = namedGroup(WORLD_NODE.arContent);
  const curve = createPathCurve();
  for (let i = 0; i < 4; i++) {
    const t = 0.6 + i * 0.08; // ahead of the dive position (walk t = 0.5)
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const arrow = clayMesh(new ConeGeometry(0.26, 0.75, 6), "arrow");
    arrow.position.set(point.x, 0.45, point.z);
    // Cone +Y axis onto the tangent: pitch flat first (X), then yaw (Y);
    // Euler order YXZ applies X before Y. The extra ~14° of pitch tips
    // the nose slightly down so the cone reads as an arrow (not a flat
    // hexagon) when seen from behind at eye level. Pinned by the
    // alignment test (cos 0.25 ≈ 0.97 keeps the tangent dot above 0.95).
    arrow.rotation.order = "YXZ";
    arrow.rotation.x = Math.PI / 2 + 0.25;
    arrow.rotation.y = Math.atan2(tangent.x, tangent.z);
    arrow.userData.pathT = t;
    arrow.castShadow = false;
    arContent.add(arrow);
  }

  const poi = buildPin("ar-poi-pin", "poi");
  poi.position.set(WORLD_ANCHORS.statue.x, 3.0, WORLD_ANCHORS.statue.z);
  arContent.add(poi);

  const label = namedGroup("ar-poi-label");
  const board = clayMesh(new BoxGeometry(1.7, 0.62, 0.04), "signPanel");
  board.castShadow = false;
  label.add(board);
  const barWidths = [1.3, 1.0, 1.2];
  barWidths.forEach((width, index) => {
    const bar = clayMesh(new BoxGeometry(width, 0.09, 0.05), "label");
    bar.position.set((width - 1.4) / 2, 0.17 - index * 0.17, 0.02);
    bar.castShadow = false;
    label.add(bar);
  });
  // LEFT of the pin from the dive camera's view (round-2 feedback R12:
  // on the right it was off-screen on phones until it faded out).
  label.position.set(
    WORLD_ANCHORS.statue.x - 1.9,
    2.4,
    WORLD_ANCHORS.statue.z + 0.4,
  );
  // Face the dive/gallery viewing directions (path side of the statue).
  label.lookAt(new Vector3(2, 2.2, 8));
  arContent.add(label);

  arContent.visible = false;
  return arContent;
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
    buildArContent(),
  );
  return world;
}
