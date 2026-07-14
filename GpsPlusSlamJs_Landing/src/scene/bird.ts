import { ConeGeometry, SphereGeometry, type Group, type Vector3 } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Hidden bird egg (catalog №10): a small low-poly songbird perched
 * somewhere in the world; clicking it (via the §2 plumbing) opens the
 * cs-util X profile in a new tab.
 *
 * NON-blue on purpose — blue stays reserved for AR/tech content per the
 * color-coding invariant (no blue-bird pun). The bird reuses the neutral
 * `trunk` (brown) scenery role in EVERY part, never an AR-coded role, so
 * it needs no new palette role and reads as part of the little world.
 */

export const BIRD_NAME = "hidden-bird";
export const BIRD_LINK = "https://x.com/csutil_com";

/** Build the perched bird at `anchor` (its feet). */
export function buildBird(anchor: Vector3): Group {
  const bird = namedGroup(BIRD_NAME);

  // Plump body (brown), small round head, a little tail and a beak.
  const body = clayMesh(new SphereGeometry(0.16, 8, 6), "trunk");
  body.scale.set(1, 0.9, 1.3);
  body.position.y = 0.16;
  body.castShadow = false;

  const head = clayMesh(new SphereGeometry(0.1, 8, 6), "trunk");
  head.position.set(0, 0.32, 0.12);
  head.castShadow = false;

  const beak = clayMesh(new ConeGeometry(0.04, 0.12, 5), "trunk");
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.32, 0.26);
  beak.castShadow = false;

  const tail = clayMesh(new ConeGeometry(0.07, 0.24, 4), "trunk");
  tail.rotation.x = -Math.PI / 2.3;
  tail.position.set(0, 0.18, -0.22);
  tail.castShadow = false;

  bird.add(body, head, beak, tail);
  bird.position.copy(anchor);
  return bird;
}
