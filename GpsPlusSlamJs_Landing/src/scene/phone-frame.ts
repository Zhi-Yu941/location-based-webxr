import { BoxGeometry, ConeGeometry, PlaneGeometry, type Group } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * The simulated AR view of the dive chapter: a phone silhouette whose
 * "screen" frames the clay world at eye level, with stylized AR overlays
 * (arrows + a label) floating inside the screen area. It communicates
 * "this is what your users see" without pretending to be real footage —
 * the plan's signature-moment decision.
 *
 * Starts hidden; the story timeline raises and reveals it in front of the
 * camera during the dive and hides it again afterwards.
 */

export const PHONE_NODE = {
  root: "phone-frame",
  screen: "phone-screen",
  overlays: "phone-ar-overlays",
} as const;

export function buildPhoneFrame(): Group {
  const phone = namedGroup(PHONE_NODE.root);

  const body = clayMesh(new BoxGeometry(0.95, 1.9, 0.07), "phone");
  body.castShadow = false;

  const screen = clayMesh(new PlaneGeometry(0.82, 1.72), "screen");
  screen.name = PHONE_NODE.screen;
  screen.position.z = 0.04;
  screen.castShadow = false;

  const overlays = namedGroup(PHONE_NODE.overlays);
  overlays.position.z = 0.09;
  for (let i = 0; i < 3; i++) {
    const arrow = clayMesh(new ConeGeometry(0.06, 0.18, 6), "arrow");
    arrow.position.set(-0.15 + i * 0.15, -0.45 + i * 0.12, 0);
    arrow.rotation.z = -Math.PI / 2;
    arrow.castShadow = false;
    overlays.add(arrow);
  }
  const label = clayMesh(new PlaneGeometry(0.5, 0.16), "label");
  label.position.set(0.1, 0.35, 0);
  label.castShadow = false;
  overlays.add(label);

  phone.add(body, screen, overlays);
  phone.visible = false;
  return phone;
}
