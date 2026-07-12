import {
  BoxGeometry,
  ConeGeometry,
  PlaneGeometry,
  type Group,
  type MeshStandardMaterial,
} from "three";
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

  // The body is a FRAME (four edge bars), not a solid slab: the screen
  // area must stay a real window into the world behind it.
  const body = namedGroup("phone-body");
  const bars: Array<[w: number, h: number, x: number, y: number]> = [
    [0.95, 0.1, 0, 0.9],
    [0.95, 0.1, 0, -0.9],
    [0.1, 1.9, -0.425, 0],
    [0.1, 1.9, 0.425, 0],
  ];
  for (const [w, h, x, y] of bars) {
    const bar = clayMesh(new BoxGeometry(w, h, 0.07), "phone");
    bar.position.set(x, y, 0);
    bar.castShadow = false;
    body.add(bar);
  }

  const screen = clayMesh(new PlaneGeometry(0.82, 1.72), "screen");
  screen.name = PHONE_NODE.screen;
  screen.position.z = 0.04;
  screen.castShadow = false;
  // The screen is a WINDOW into the world ("this is what your users see"),
  // not a solid display: keep it glass-translucent so the clay world shows
  // through behind the AR overlays. Palette applies only touch color /
  // emissive, so this stays stable across theme toggles.
  const screenMaterial = screen.material as MeshStandardMaterial;
  screenMaterial.transparent = true;
  screenMaterial.opacity = 0.16;

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
