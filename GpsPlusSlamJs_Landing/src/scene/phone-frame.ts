import {
  BoxGeometry,
  PlaneGeometry,
  type Group,
  type MeshStandardMaterial,
} from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * The simulated AR view of the dive chapter: a phone frame whose
 * glass-translucent "screen" is a pure WINDOW into the clay world at eye
 * level. The AR content itself (trail arrows, POI pin, hinted label)
 * lives in the world (`clay-world`'s ar-content group) and is seen
 * through the window — round-1 feedback killed the earlier screen-plane
 * overlays, which pointed nowhere and confused the message.
 *
 * Starts hidden; the story timeline raises and reveals it in front of the
 * camera during the dive and hides it again afterwards.
 */

export const PHONE_NODE = {
  root: "phone-frame",
  screen: "phone-screen",
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
  // through behind the AR overlays. 0.22 is the round-7 "light glass"
  // floor (test-pinned 0.2–0.35); the LOW roughness (round-8 Z2) makes
  // the directional light put a real specular sheen on the pane — glass,
  // not clay. Palette applies only touch color / emissive, so this stays
  // stable across theme toggles.
  const screenMaterial = screen.material as MeshStandardMaterial;
  screenMaterial.transparent = true;
  screenMaterial.opacity = 0.22;
  screenMaterial.roughness = 0.15;

  // Two diagonal glare strips (round-8 Z2): the classic cheap "this is
  // glass" cue — no shaders, no env maps, just two translucent quads
  // floating a hair in front of the pane, sized to stay inside the
  // screen area. `glare` role: near-white in every palette, slightly
  // emissive in the dark ones.
  const glareStripes: Array<[w: number, x: number]> = [
    [0.13, -0.12],
    [0.06, 0.16],
  ];
  for (const [width, x] of glareStripes) {
    const strip = clayMesh(new PlaneGeometry(width, 1.45), "glare");
    strip.position.set(x, 0, 0.05);
    strip.rotation.z = -0.42;
    strip.castShadow = false;
    strip.receiveShadow = false;
    const material = strip.material as MeshStandardMaterial;
    material.transparent = true;
    material.opacity = 0.14;
    // Never occlude the world behind it in the depth buffer — the strip
    // is a highlight, not a surface.
    material.depthWrite = false;
    screen.add(strip);
  }

  phone.add(body, screen);
  phone.visible = false;
  return phone;
}
