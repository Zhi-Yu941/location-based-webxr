import {
  BoxGeometry,
  ConeGeometry,
  RingGeometry,
  SphereGeometry,
  type Group,
} from "three";
import { clayMesh, namedGroup, type PaletteRole } from "./palette";

/**
 * The proof visuals of the fusion chapter (round-2 R5/R8): raw GPS as
 * static, scattered amber SAMPLE RINGS — larger, overlapping, offset
 * around the group origin so that the AVERAGE of the ring centers is
 * exactly the origin, where the rock-solid red pin stands — plus
 * connector lines from each ring center to that average point. The
 * spatial relationship IS the product message ("average the scatter"),
 * and the copy in index.html echoes the colors (`.hl-raw`/`.hl-fused`).
 */

export const MARKER_NODE = {
  raw: "marker-raw",
  fused: "marker-fused",
  connectors: "marker-connectors",
} as const;

/**
 * Ring-center offsets (x, z) in world units. Deliberately scattered like
 * GPS readings AND summing to exactly zero, so the mean of the centers is
 * the group origin (test-pinned).
 */
export const RING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1.1, 0.4],
  [-0.9, 0.7],
  [0.3, -1.0],
  [-0.5, -0.1],
];

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

/** Raw GPS: scattered flat sample rings + a center dot each, `markerRaw`. */
function buildUncertaintyRings(): Group {
  const group = namedGroup(MARKER_NODE.raw);
  const radii = [1.15, 1.3, 1.05, 1.25];
  RING_OFFSETS.forEach(([dx, dz], index) => {
    // A flat annulus, NOT a torus (round-4 V1): the flat-shaded torus tube
    // split into a bright thin band plus darker wide bands ("doubled/thick
    // rings"), and its underside dipped into the path slabs so arcs
    // vanished. One planar band with a single normal reads as one uniform
    // thin ring from every camera angle.
    const radius = radii[index] ?? 1.2;
    const ring = clayMesh(
      new RingGeometry(radius - 0.035, radius + 0.035, 48),
      "markerRaw",
      `uncertainty-ring-${index}`,
    );
    ring.rotation.x = -Math.PI / 2;
    // Above the path slab top (y = 0.12) so no arc is ever swallowed by
    // the path; staggered heights avoid z-fighting where rings overlap.
    ring.position.set(dx, 0.14 + index * 0.02, dz);
    ring.castShadow = false;
    ring.receiveShadow = false;
    group.add(ring);
    const dot = clayMesh(new SphereGeometry(0.1, 10, 8), "markerRaw");
    dot.position.set(dx, 0.14, dz);
    group.add(dot);
  });
  return group;
}

/**
 * Connector lines from each ring center to the group origin (the average
 * point / red pin). Long axis = local +X, yawed toward the origin
 * (test-pinned). Revealed by the fusion chapter, hidden until then.
 */
function buildConnectors(): Group {
  const group = namedGroup(MARKER_NODE.connectors);
  for (const [dx, dz] of RING_OFFSETS) {
    const length = Math.hypot(dx, dz);
    const bar = clayMesh(new BoxGeometry(length, 0.045, 0.05), "markerRaw");
    bar.position.set(dx / 2, 0.16, dz / 2);
    bar.rotation.y = Math.atan2(-dz, dx);
    bar.castShadow = false;
    group.add(bar);
  }
  return group;
}

export interface MarkerPair {
  readonly raw: Group;
  readonly fused: Group;
  readonly connectors: Group;
}

export function buildMarkerPair(): MarkerPair {
  return {
    raw: buildUncertaintyRings(),
    fused: buildPin(MARKER_NODE.fused, "markerFused"),
    connectors: buildConnectors(),
  };
}
