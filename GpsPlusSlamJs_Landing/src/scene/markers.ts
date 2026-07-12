import { ConeGeometry, SphereGeometry, type Group } from "three";
import { clayMesh, namedGroup, type PaletteRole } from "./palette";

/**
 * The twin proof markers of the fusion chapter: a raw-GPS pin that jitters
 * meters around its spot and a fused anchor that sits rock-solid. The
 * visual contrast between the two IS the product message, so they share
 * geometry but never a palette role.
 */

export const MARKER_NODE = {
  raw: "marker-raw",
  fused: "marker-fused",
} as const;

function buildMarker(name: string, role: PaletteRole): Group {
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

export interface MarkerPair {
  readonly raw: Group;
  readonly fused: Group;
}

export function buildMarkerPair(): MarkerPair {
  return {
    raw: buildMarker(MARKER_NODE.raw, "markerRaw"),
    fused: buildMarker(MARKER_NODE.fused, "markerFused"),
  };
}
