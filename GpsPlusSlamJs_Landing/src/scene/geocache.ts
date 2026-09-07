import { BoxGeometry, type Group, type Object3D, type Vector3 } from "three";
import { buildPin } from "./markers";
import { clayMesh, namedGroup } from "./palette";

/**
 * The geocache chest (easter-egg catalog №1) — the most on-brand hidden
 * egg: geocaching is the genre's ancestor. A palm-sized low-poly chest
 * tucked on the castle vignette's disc; clicking it (via the §2 egg
 * plumbing) pops the lid and raises a tiny amber "signal" pin.
 *
 * The open/close animation runs on WALL-CLOCK event time driven by the
 * scene controller's tick — never on the scroll timeline, so the
 * story's scrub-path-independence guarantees are untouched (same
 * precedent as the ambient camera drift). Transitions are
 * interrupt-safe: a toggle mid-flight reverses from the CURRENT pose.
 */

export const GEOCACHE_NAME = "geocache-chest";
export const GEOCACHE_LID_NAME = "geocache-lid";
export const GEOCACHE_PIN_NAME = "geocache-signal";

const LID_OPEN_RAD = -1.9;
/** Pin rest position: sunk into the chest/disc, invisible. */
const PIN_HIDDEN_Y = -0.45;
/** Pin raised position: standing out of the open chest. */
const PIN_RAISED_Y = 0.24;
const TRANSITION_MS = 300;

interface GeocacheState {
  open: boolean;
  /** Non-null while a transition is animating. */
  animStartMs: number | null;
  /** Pose captured at the last toggle — transitions ease from here. */
  fromLid: number;
  fromPin: number;
}

function getState(chest: Object3D): GeocacheState {
  return chest.userData.geocache as GeocacheState;
}

/** Build the chest, closed, standing on the ground at `anchor`. */
export function buildGeocache(anchor: Vector3): Group {
  const chest = namedGroup(GEOCACHE_NAME);
  const base = clayMesh(new BoxGeometry(0.55, 0.3, 0.38), "trunk");
  base.position.y = 0.15;
  base.castShadow = false;
  // Lid hinged along the chest's back edge.
  const hinge = namedGroup(GEOCACHE_LID_NAME);
  hinge.position.set(0, 0.3, -0.19);
  const lidMesh = clayMesh(new BoxGeometry(0.55, 0.13, 0.38), "trunk");
  lidMesh.position.set(0, 0.065, 0.19);
  lidMesh.castShadow = false;
  hinge.add(lidMesh);
  // The amber "signal" pin (GPS color family) hides inside until found.
  const pin = buildPin(GEOCACHE_PIN_NAME, "markerRaw");
  pin.scale.setScalar(0.3);
  pin.position.y = PIN_HIDDEN_Y;
  pin.traverse((obj) => {
    obj.castShadow = false;
  });
  chest.add(base, hinge, pin);
  chest.position.copy(anchor);
  // Front toward the world center — where the CTA arrival camera looks
  // from — so the lid opens AWAY from the viewer (same convention as
  // the castle vignette's facing).
  chest.rotation.y = Math.atan2(-anchor.x, -anchor.z);
  const state: GeocacheState = {
    open: false,
    animStartMs: null,
    fromLid: 0,
    fromPin: PIN_HIDDEN_Y,
  };
  chest.userData.geocache = state;
  return chest;
}

/**
 * Flip the chest's target state (found ↔ hidden) at the given clock
 * time. Returns whether the chest is now opening — the caller shows the
 * "cache found" toast only for opens.
 */
export function toggleGeocache(
  chest: Object3D,
  nowMs: number,
): { opened: boolean } {
  const state = getState(chest);
  const lid = chest.getObjectByName(GEOCACHE_LID_NAME);
  const pin = chest.getObjectByName(GEOCACHE_PIN_NAME);
  state.fromLid = lid?.rotation.x ?? 0;
  state.fromPin = pin?.position.y ?? PIN_HIDDEN_Y;
  state.open = !state.open;
  state.animStartMs = nowMs;
  return { opened: state.open };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Advance a running transition toward the target pose. Returns true
 * while animating (the controller marks the frame dirty), false when
 * idle. Safe to call every tick.
 */
export function updateGeocache(chest: Object3D, nowMs: number): boolean {
  const state = getState(chest);
  if (state.animStartMs === null) {
    return false;
  }
  const lid = chest.getObjectByName(GEOCACHE_LID_NAME);
  const pin = chest.getObjectByName(GEOCACHE_PIN_NAME);
  const t = Math.min(
    1,
    Math.max(0, (nowMs - state.animStartMs) / TRANSITION_MS),
  );
  const eased = easeOutCubic(t);
  const targetLid = state.open ? LID_OPEN_RAD : 0;
  const targetPin = state.open ? PIN_RAISED_Y : PIN_HIDDEN_Y;
  if (lid) {
    lid.rotation.x = state.fromLid + (targetLid - state.fromLid) * eased;
  }
  if (pin) {
    pin.position.y = state.fromPin + (targetPin - state.fromPin) * eased;
  }
  if (t >= 1) {
    state.animStartMs = null;
  }
  return true;
}
