import { BoxGeometry, CylinderGeometry, type Group, type Vector3 } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Mini parkour park (round-14 R14-12): a small rounded lawn patch in
 * front of the city highrises with a little course of green blocks that
 * pop in while the works-anywhere copy ("a park with your jump-and-run
 * parkour") is on screen. The lawn is permanent scenery; the BLOCKS are
 * primed hidden so the story timeline pops them in one by one (like the
 * tent arrows), and the copy word "jump-and-run parkour" reveals in the
 * matching green.
 */

export const PARK_NAME = "parcours-park";
export const PARK_BLOCKS_NAME = "parkour-blocks";

/** Build the park at `anchor` (lawn centre, on the ground). */
export function buildParcoursPark(anchor: Vector3): Group {
  const park = namedGroup(PARK_NAME);

  // Rounded lawn patch — a sunken disc (skirt below y=0) so nothing reads
  // as floating over the void beyond the world (the R10-3 lesson).
  const lawn = clayMesh(new CylinderGeometry(6, 7, 6, 22), "grass");
  lawn.position.y = -2.9; // top ~0.1
  lawn.castShadow = false;
  lawn.receiveShadow = false;
  park.add(lawn);

  // A little parkour course: green blocks of varying heights.
  const blocks = namedGroup(PARK_BLOCKS_NAME);
  const layout: Array<[x: number, z: number, h: number]> = [
    [-3.2, 1.2, 0.6],
    [-1.4, -1.1, 1.0],
    [0.6, 0.6, 0.75],
    [2.6, -0.9, 1.35],
    [1.2, 2.4, 0.5],
  ];
  for (const [x, z, h] of layout) {
    const block = clayMesh(new BoxGeometry(0.85, h, 0.85), "parkour");
    block.position.set(x, h / 2, z);
    block.castShadow = false;
    blocks.add(block);
  }
  park.add(blocks);

  park.position.copy(anchor);
  return park;
}
