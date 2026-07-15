import {
  CircleGeometry,
  Mesh,
  TorusGeometry,
  type Group,
  type MeshStandardMaterial,
  type Object3D,
  type Vector3,
} from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Forest magic portal (round-14 R14-10): a glowing cyan gateway that
 * opens between two trees near the tents while "Works anywhere. Fully
 * offline." is on screen (the copy names "a forest with a magic portal
 * that only opens at dawn"), then closes as the camera turns to the
 * city. A vertical disc with two slowly counter-rotating rings gives a
 * gentle swirl — no shader (the clay world is flat-shaded; keep simple).
 *
 * The OPEN/CLOSE is a scale pop driven by the story timeline (like the
 * tent arrows). The ring swirl is TIME-driven only (`updatePortalSpin`),
 * a pure function of the clock — scrub-path independence untouched — run
 * by the continuous-render loop alongside the particles/satellites.
 */

export const PORTAL_NAME = "forest-portal";
const RING_NAME = "portal-ring";
const PORTAL_RADIUS = 2.4;

/** Build the portal at `anchor`, facing `faceToward` (the disc's normal
 * points that way), primed hidden (scale ~0) for the timeline to open. */
export function buildForestPortal(anchor: Vector3, faceToward: Vector3): Group {
  const portal = namedGroup(PORTAL_NAME);

  // The glowing membrane: a translucent cyan disc that never occludes.
  const disc = clayMesh(new CircleGeometry(PORTAL_RADIUS, 28), "portal");
  const discMat = disc.material as MeshStandardMaterial;
  discMat.transparent = true;
  discMat.opacity = 0.4;
  discMat.depthWrite = false;
  disc.castShadow = false;
  disc.receiveShadow = false;

  // Two rims (torus) that counter-rotate for a subtle swirl.
  for (let i = 0; i < 2; i += 1) {
    const ringMat = discMat.clone();
    ringMat.transparent = true;
    ringMat.opacity = 0.85;
    ringMat.depthWrite = false;
    const ring = new Mesh(
      new TorusGeometry(PORTAL_RADIUS - 0.15 - i * 0.35, 0.1, 8, 28),
      ringMat,
    );
    ring.name = `${RING_NAME}-${i}`;
    ring.userData.paletteRole = "portal";
    ring.userData.spin = i === 0 ? 1 : -1.6; // counter-rotating speeds
    // The INNER ring pulses permanently (round-14 follow-up) — a
    // clock-driven breathing scale, independent of scroll.
    ring.userData.pulse = i === 1;
    ring.castShadow = false;
    portal.add(ring);
  }
  portal.add(disc);

  portal.position.copy(anchor);
  // Face the disc's +Z normal toward `faceToward` (the camera approach).
  const dir = faceToward.clone().sub(anchor).setY(0);
  portal.rotation.y = Math.atan2(dir.x, dir.z);
  portal.scale.setScalar(0.001); // primed closed; the timeline opens it
  return portal;
}

/**
 * Advance the ring swirl + inner-ring pulse to the given clock time.
 * Pure in `timeMs` (a permanent animation, independent of scroll). Safe
 * to call every frame (a closed/scale-0 portal just animates invisibly).
 */
export function updatePortalSpin(portal: Object3D, timeMs: number): void {
  const t = timeMs / 1000;
  for (const child of portal.children) {
    const spin = child.userData.spin as number | undefined;
    if (spin !== undefined) {
      child.rotation.z = t * spin * 0.6;
    }
    if (child.userData.pulse === true) {
      // Breathing scale on the inner ring — always playing.
      child.scale.setScalar(1 + Math.sin(t * 2.6) * 0.14);
    }
  }
}
