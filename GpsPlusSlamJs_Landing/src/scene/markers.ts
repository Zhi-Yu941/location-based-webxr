import { ConeGeometry, SphereGeometry, TorusGeometry, type Group } from "three";
import { clayMesh, namedGroup, type PaletteRole } from "./palette";

/**
 * The twin proof visuals of the fusion chapter: raw GPS as jittering
 * amber UNCERTAINTY RINGS (round-1 feedback: a gray pin was unreadable)
 * versus the fused anchor as a rock-solid red pin. The visual contrast —
 * wandering fuzz vs. still pin — IS the product message, and the copy in
 * index.html echoes the two colors (`.hl-raw` / `.hl-fused`).
 */

export const MARKER_NODE = {
  raw: "marker-raw",
  fused: "marker-fused",
} as const;

/** Classic map pin, tip on the ground — also used for the AR POI marker. */
export function buildPin(name: string, role: PaletteRole): Group {
  const marker = namedGroup(name);
  // Classic map pin: inverted cone with a sphere head, tip on the ground.
  const tip = clayMesh(new ConeGeometry(0.32, 1.1, 10), role);
  tip.rotation.x = Math.PI;
  tip.position.y = 0.55;
  const head = clayMesh(new SphereGeometry(0.4, 12, 10), role);
  head.position.y = 1.35;
  marker.add(tip, head);
  return marker;
}

/** Raw GPS: concentric flat rings + a center dot, all `markerRaw` role. */
function buildUncertaintyRings(): Group {
  const group = namedGroup(MARKER_NODE.raw);
  const radii = [0.55, 0.95, 1.35];
  radii.forEach((radius, index) => {
    const ring = clayMesh(
      new TorusGeometry(radius, 0.05, 8, 36),
      "markerRaw",
      `uncertainty-ring-${index}`,
    );
    ring.rotation.x = -Math.PI / 2;
    // Slightly staggered heights avoid z-fighting with the ground.
    ring.position.y = 0.06 + index * 0.02;
    ring.castShadow = false;
    group.add(ring);
  });
  const dot = clayMesh(new SphereGeometry(0.16, 10, 8), "markerRaw");
  dot.position.y = 0.16;
  group.add(dot);
  return group;
}

export interface MarkerPair {
  readonly raw: Group;
  readonly fused: Group;
}

export function buildMarkerPair(): MarkerPair {
  return {
    raw: buildUncertaintyRings(),
    fused: buildPin(MARKER_NODE.fused, "markerFused"),
  };
}
