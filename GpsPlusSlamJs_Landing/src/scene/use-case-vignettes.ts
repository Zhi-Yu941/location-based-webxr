import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
  type Vector3,
} from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Use-case vignettes (round-11): the destinations of the gallery
 * chapter's camera journey. Two little stages beyond the walkable world:
 *
 * - CAMPUS (trade-fair/venue use case): tents plus the blue AR arrows
 *   placed STATICALLY — they echo the dive's arrow trail without any
 *   extra animation ("nicht zu viel 3D-Heckmeck").
 * - CASTLE (historic-buildings use case): a low-poly ruin overlaid with
 *   a translucent AR-blue GHOST of how it used to look — the broken
 *   tower standing again. Make the invisible visible, in one image.
 *
 * Both stand on their own sunken ground discs (the round-10 R10-3
 * floating lesson). Anchors are PARAMETERS computed by clay-world next
 * to its skyline math (world-detail pattern — no import cycle).
 */

export const VIGNETTES_NAME = "use-case-vignettes";

export const VIGNETTE_NODE = {
  root: VIGNETTES_NAME,
  campus: "vignette-campus",
  castle: "vignette-castle",
  ghost: "castle-ghost",
} as const;

export interface VignetteAnchors {
  readonly campus: Vector3;
  readonly castle: Vector3;
}

/** Sunken ground disc: top at y=0, deep skirt — nothing floats. */
function groundDisc(radius: number): Mesh {
  const disc = clayMesh(
    new CylinderGeometry(radius, radius + 1.5, 10, 16),
    "ground",
  );
  disc.position.y = -5;
  disc.castShadow = false;
  return disc;
}

function tent(radius: number, height: number): Group {
  const group = namedGroup("tent");
  const wall = clayMesh(
    new CylinderGeometry(radius * 0.92, radius, height * 0.45, 8),
    "tent",
  );
  wall.position.y = height * 0.225;
  wall.castShadow = false;
  const roof = clayMesh(
    new ConeGeometry(radius * 1.18, height * 0.75, 8),
    "tent",
  );
  roof.position.y = height * 0.45 + height * 0.375;
  roof.castShadow = false;
  group.add(wall, roof);
  return group;
}

/** A static AR trail arrow — same cone language as the dive's trail. */
function staticArrow(yaw: number): Mesh {
  const arrow = clayMesh(new ConeGeometry(0.3, 0.85, 6), "arrow");
  arrow.rotation.order = "YXZ";
  arrow.rotation.x = Math.PI / 2 + 0.25;
  arrow.rotation.y = yaw;
  arrow.castShadow = false;
  return arrow;
}

function buildCampus(anchor: Vector3): Group {
  const campus = namedGroup(VIGNETTE_NODE.campus);
  campus.add(groundDisc(9));

  const bigTent = tent(2.4, 2.6);
  bigTent.position.set(-1.5, 0, -1);
  const sideTentA = tent(1.3, 1.8);
  sideTentA.position.set(2.6, 0, -2.2);
  const sideTentB = tent(1.1, 1.6);
  sideTentB.position.set(2.2, 0, 1.8);
  campus.add(bigTent, sideTentA, sideTentB);

  // A short static arrow trail curving toward the big tent's entrance.
  const trail: Array<[x: number, z: number, yaw: number]> = [
    [4.8, 3.6, -2.2],
    [3.2, 2.2, -2.5],
    [1.4, 1.2, -2.9],
    [0, 0.4, -3.3],
  ];
  for (const [x, z, yaw] of trail) {
    const arrow = staticArrow(yaw);
    arrow.position.set(x, 1.1, z);
    campus.add(arrow);
  }

  campus.position.copy(anchor);
  return campus;
}

/** Make a clay mesh part of the translucent ghost overlay. */
function ghostify(mesh: Mesh): Mesh {
  const material = mesh.material as MeshStandardMaterial;
  material.transparent = true;
  material.opacity = 0.32;
  // The "how it was" overlay must never occlude the ruin it explains.
  material.depthWrite = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function buildCastle(anchor: Vector3): Group {
  const castle = namedGroup(VIGNETTE_NODE.castle);
  castle.add(groundDisc(9));

  // ── The ruin (what still stands).
  const keep = clayMesh(new BoxGeometry(3.4, 3.2, 2.8), "ruin");
  keep.position.set(-0.6, 1.6, -0.4);
  keep.castShadow = false;
  const standingTower = clayMesh(
    new CylinderGeometry(1.05, 1.2, 5.2, 8),
    "ruin",
  );
  standingTower.position.set(-3.2, 2.6, 1.2);
  standingTower.castShadow = false;
  const towerRoof = clayMesh(new ConeGeometry(1.35, 1.5, 8), "ruin");
  towerRoof.position.set(-3.2, 5.95, 1.2);
  towerRoof.castShadow = false;
  // The broken tower: only a stump remains.
  const stump = clayMesh(new CylinderGeometry(1.0, 1.15, 1.7, 8), "ruin");
  stump.position.set(2.8, 0.85, 1.4);
  stump.castShadow = false;
  // A cracked wall segment with a gap toward the stump.
  const wallA = clayMesh(new BoxGeometry(2.6, 1.6, 0.6), "ruin");
  wallA.position.set(0.9, 0.8, 2.5);
  wallA.rotation.y = 0.18;
  wallA.castShadow = false;
  const wallB = clayMesh(new BoxGeometry(1.7, 1.2, 0.6), "ruin");
  wallB.position.set(-2.3, 0.6, 2.9);
  wallB.rotation.y = -0.12;
  wallB.castShadow = false;
  castle.add(keep, standingTower, towerRoof, stump, wallA, wallB);

  // ── The ghost (what USED to stand): the broken tower at full height
  // plus the missing wall stretch, translucent AR-blue.
  const ghost = namedGroup(VIGNETTE_NODE.ghost);
  const ghostTower = ghostify(
    clayMesh(new CylinderGeometry(1.0, 1.15, 5.6, 8), "ghost"),
  );
  ghostTower.position.set(2.8, 2.8, 1.4);
  const ghostRoof = ghostify(clayMesh(new ConeGeometry(1.3, 1.4, 8), "ghost"));
  ghostRoof.position.set(2.8, 6.3, 1.4);
  const ghostWall = ghostify(
    clayMesh(new BoxGeometry(2.2, 1.6, 0.55), "ghost"),
  );
  ghostWall.position.set(2.2, 0.8, 2.65);
  ghostWall.rotation.y = 0.3;
  ghost.add(ghostTower, ghostRoof, ghostWall);
  castle.add(ghost);

  castle.position.copy(anchor);
  // Face the ruin's interesting side (stump + ghost) toward the world
  // center, where the journey camera approaches from.
  castle.rotation.y = Math.atan2(-anchor.x, -anchor.z) + Math.PI * 0.12;
  return castle;
}

/** Build both vignettes at their clay-world-computed anchors. */
export function buildUseCaseVignettes(anchors: VignetteAnchors): Group {
  const group = namedGroup(VIGNETTE_NODE.root);
  group.add(buildCampus(anchors.campus), buildCastle(anchors.castle));
  return group;
}
