import { BoxGeometry, type Group, type Object3D } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Permanent orbiting GPS satellites (easter-egg catalog E2/№0 — a scene
 * feature, not an egg): tiny low-poly satellites on slow, tilted
 * circular orbits far above the little world, echoing the real GNSS
 * constellation the product builds on.
 *
 * Motion is TIME-driven only, like the particles: `updateSatellites`
 * is a pure function of the clock, never of scroll progress — the
 * story's scrub-path-independence guarantees stay untouched. The
 * continuous-render loop in `scene-controller.ts` animates them under
 * the same visibility/tier gate as the particles; reduced-motion and
 * low-tier visitors see them PARKED at the deterministic t=0 pose
 * (built-in — `buildSatellites` parks them there).
 */

export const SATELLITES_NAME = "gps-satellites";

interface OrbitParams {
  /** Orbit radius around the world's vertical axis (world units). */
  readonly radius: number;
  /** Mean orbit height; y oscillates ±tiltAmplitude around it. */
  readonly height: number;
  /** Vertical amplitude of the tilted orbit plane (GNSS-style incline). */
  readonly tiltAmplitude: number;
  /** Angular speed in radians per second (slow — minutes per lap). */
  readonly angularSpeed: number;
  /** Start angle at clock zero. */
  readonly phase: number;
}

/** Two satellites on distinct, non-synchronized inclined orbits.
 *
 * The catalog spec'd ~35–45 up and delegated the final call to the
 * screenshot pass — which showed that band orbits ABOVE every story
 * framing's frustum (all cameras look down at the world), making the
 * satellites invisible in practice. Lowered to ~28–36 over the disc
 * (radius ≤ 20) they cross the visible sky in the pull-back framings
 * (works-anywhere — thematically THE GPS moment — and the journey),
 * still far above all world content (skyline tops out at ~15). */
const ORBITS: readonly OrbitParams[] = [
  {
    radius: 15,
    height: 30.5,
    tiltAmplitude: 2.2,
    angularSpeed: (Math.PI * 2) / 95, // one lap ≈ 95 s
    phase: 0.7,
  },
  {
    radius: 18.5,
    height: 33,
    tiltAmplitude: 2.5,
    angularSpeed: -(Math.PI * 2) / 140, // one lap ≈ 140 s, opposite sense
    phase: 3.6,
  },
];

function buildSatellite(index: number): Group {
  const satellite = namedGroup(`satellite-${index}`);
  // TINY on purpose: the anywhere pull-back camera passes within ~15
  // units of the orbits — at the first attempt's ~4.6-unit wingspan a
  // passing satellite filled a quarter of the frame (screenshot pass).
  const body = clayMesh(new BoxGeometry(0.34, 0.34, 0.5), "satellite");
  body.castShadow = false;
  // Two solar-panel wings — thin quads reaching out sideways.
  for (const side of [-1, 1]) {
    const panel = clayMesh(new BoxGeometry(0.85, 0.03, 0.38), "satellite");
    panel.position.x = side * 0.68;
    panel.castShadow = false;
    satellite.add(panel);
  }
  satellite.add(body);
  return satellite;
}

/** Place one satellite on its orbit for the given clock time. */
function placeSatellite(
  satellite: Object3D,
  orbit: OrbitParams,
  timeMs: number,
): void {
  const direction = orbit.angularSpeed > 0 ? 1 : -1;
  const theta = orbit.phase + orbit.angularSpeed * (timeMs / 1000);
  satellite.position.set(
    Math.cos(theta) * orbit.radius,
    orbit.height + Math.sin(theta) * orbit.tiltAmplitude,
    Math.sin(theta) * orbit.radius,
  );
  // Face along the direction of travel, with a slight fixed bank so the
  // panels catch the light instead of pointing edge-on at the camera.
  satellite.rotation.set(0.18, -theta * direction, 0.12, "YXZ");
}

/**
 * Build the satellite group, parked at the clock-zero orbit pose so
 * tiers that never call `updateSatellites` still show a complete
 * composition.
 */
export function buildSatellites(): Group {
  const group = namedGroup(SATELLITES_NAME);
  ORBITS.forEach((orbit, index) => {
    const satellite = buildSatellite(index);
    placeSatellite(satellite, orbit, 0);
    group.add(satellite);
  });
  return group;
}

/**
 * Advance the orbits to the given clock time. Pure in `timeMs`: the
 * same timestamp always yields the same poses, independent of history.
 */
export function updateSatellites(group: Group, timeMs: number): void {
  group.children.forEach((satellite, index) => {
    const orbit = ORBITS[index];
    if (orbit) {
      placeSatellite(satellite, orbit, timeMs);
    }
  });
}
