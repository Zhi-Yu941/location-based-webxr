import { BoxGeometry, Vector3, type Group, type Object3D } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * GPS satellites (catalog E2/№0 — a permanent scene feature): tiny
 * low-poly satellites that drift slowly and AUTONOMOUSLY across the high
 * sky, echoing the real GNSS constellation.
 *
 * Round-14 R14-9 turned the fixed circular orbits into roaming PASSES:
 * each satellite crosses the sky on a long straight track, then goes
 * away and returns later on a different, hashed track — "wenn man Glück
 * hat" it happens to be crossing while the camera is far out (the
 * works-anywhere / journey pull-backs). Motion is a pure function of the
 * clock (never scroll), so scrub-path independence is untouched; the
 * continuous-render loop drives it under the same visibility/tier gate as
 * the particles. Reduced-motion / low-tier visitors never call
 * `updateSatellites` and see the satellites PARKED at their built pose.
 */

export const SATELLITES_NAME = "gps-satellites";

interface PassParams {
  /** Schedule offset (ms) so the two satellites never sync up. */
  readonly offsetMs: number;
  /** One full spawn→cross→gone→respawn cycle (ms). */
  readonly periodMs: number;
  /** Of each period, how long the satellite is actually crossing (ms). */
  readonly visibleMs: number;
}

/** Two satellites, phase-offset so their passes rarely overlap. */
const PASSES: readonly PassParams[] = [
  { offsetMs: 0, periodMs: 46_000, visibleMs: 30_000 },
  { offsetMs: 27_000, periodMs: 58_000, visibleMs: 34_000 },
];

/** High band the passes travel through (well above the ~15-unit skyline,
 * far enough out to read only in the pull-back framings). */
const PASS_HEIGHT = 34;
const PASS_HEIGHT_VARY = 6;
/** Half-length of a crossing track (world units, x/z span 2×). */
const PASS_HALF_SPAN = 46;

/** Cheap deterministic hash of an integer → [0, 1). */
function hash01(n: number): number {
  const x = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildSatellite(index: number): Group {
  const satellite = namedGroup(`satellite-${index}`);
  // TINY on purpose: a pull-back camera can pass within ~15 units, and a
  // big satellite would fill the frame (screenshot pass).
  const body = clayMesh(new BoxGeometry(0.34, 0.34, 0.5), "satellite");
  body.castShadow = false;
  for (const side of [-1, 1]) {
    const panel = clayMesh(new BoxGeometry(0.85, 0.03, 0.38), "satellite");
    panel.position.x = side * 0.68;
    panel.castShadow = false;
    satellite.add(panel);
  }
  satellite.add(body);
  return satellite;
}

/** The start point + travel direction of pass `k` for satellite `index`. */
function passTrack(
  index: number,
  k: number,
): {
  start: Vector3;
  dir: Vector3;
  height: number;
} {
  const seed = index * 131 + k * 17;
  const angle = hash01(seed) * Math.PI * 2; // crossing heading
  const lateral = (hash01(seed + 1) - 0.5) * 2 * PASS_HALF_SPAN * 0.6;
  const height = PASS_HEIGHT + (hash01(seed + 2) - 0.5) * 2 * PASS_HEIGHT_VARY;
  const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
  const perp = new Vector3(-dir.z, 0, dir.x);
  // Enter from one side, offset laterally by the hashed amount.
  const start = dir
    .clone()
    .multiplyScalar(-PASS_HALF_SPAN)
    .add(perp.multiplyScalar(lateral))
    .setY(height);
  return { start, dir, height };
}

/** Place one satellite for the given clock time (roaming pass schedule). */
function placeSatellite(
  satellite: Object3D,
  pass: PassParams,
  index: number,
  timeMs: number,
): void {
  const localT = timeMs + pass.offsetMs;
  const k = Math.floor(localT / pass.periodMs);
  const phase = localT - k * pass.periodMs;
  if (phase < 0 || phase >= pass.visibleMs) {
    // Between passes: gone (out of sight, not just hidden — the render
    // loop still draws it, so park it far below the world instead).
    satellite.visible = false;
    return;
  }
  satellite.visible = true;
  const u = phase / pass.visibleMs; // 0..1 across the crossing
  const { start, dir } = passTrack(index, k);
  satellite.position
    .copy(start)
    .add(dir.clone().multiplyScalar(u * 2 * PASS_HALF_SPAN));
  // Face along travel with a slight bank so the panels catch the light.
  satellite.rotation.set(0.18, Math.atan2(dir.x, dir.z), 0.12, "YXZ");
}

/**
 * Build the satellite group, parked at a fixed pleasant static pose
 * (visible, high) so tiers that never call `updateSatellites` still show
 * a complete composition. The roaming schedule takes over on the first
 * `updateSatellites` (scroll mode) with no visible jump.
 */
export function buildSatellites(): Group {
  const group = namedGroup(SATELLITES_NAME);
  PASSES.forEach((_, index) => {
    const satellite = buildSatellite(index);
    // Static park pose: spread the two across the high sky.
    satellite.position.set(
      (index === 0 ? -1 : 1) * 12,
      PASS_HEIGHT + index * 3,
      -8 - index * 6,
    );
    satellite.rotation.set(0.18, index * 1.3, 0.12, "YXZ");
    group.add(satellite);
  });
  return group;
}

/**
 * Advance the roaming passes to the given clock time. Pure in `timeMs`:
 * the same timestamp always yields the same poses + visibility,
 * independent of call history.
 */
export function updateSatellites(group: Group, timeMs: number): void {
  group.children.forEach((satellite, index) => {
    const pass = PASSES[index];
    if (pass) {
      placeSatellite(satellite, pass, index, timeMs);
    }
  });
}
