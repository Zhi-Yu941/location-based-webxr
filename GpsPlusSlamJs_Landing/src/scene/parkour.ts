import type { Object3D } from "three";

/**
 * Dot-person parkour-hop egg (catalog №2): clicking the teal person makes
 * it do a quick two-beat hop (crouch → jump with a flip-suggesting yaw
 * spin → land with a settle bounce), tying to the "jump-and-run parkour"
 * copy line.
 *
 * The hop is a PURELY ADDITIVE offset (position.y + rotation.y) on
 * wall-clock time — it never touches `walk.t` or the story timeline, so
 * scrub-path independence holds. The computation lives here as a PURE
 * offset (`parkourOffset`); `syncStage` adds it on top of the freshly
 * placed walk pose, so it never accumulates whether or not a scrub
 * re-placed the person that frame.
 */

const CROUCH_MS = 90;
const AIR_MS = 420;
const SETTLE_MS = 190;
const TOTAL_MS = CROUCH_MS + AIR_MS + SETTLE_MS;
const CROUCH_DEPTH = 0.09;
const JUMP_HEIGHT = 1.25;
const SETTLE_HEIGHT = 0.14;

interface ParkourState {
  startMs: number | null;
}

export interface ParkourOffset {
  readonly y: number;
  readonly spin: number;
  readonly active: boolean;
}

const IDLE: ParkourOffset = { y: 0, spin: 0, active: false };

function getState(person: Object3D): ParkourState {
  let state = person.userData.parkour as ParkourState | undefined;
  if (!state) {
    state = { startMs: null };
    person.userData.parkour = state;
  }
  return state;
}

/** Fire a hop. Ignored while one is already running (no restart). */
export function triggerParkourHop(person: Object3D, nowMs: number): void {
  const state = getState(person);
  if (state.startMs !== null) {
    return;
  }
  state.startMs = nowMs;
}

/** Vertical offset over the hop: crouch dip → jump arc → settle bounce. */
function hopHeight(elapsed: number): number {
  if (elapsed < CROUCH_MS) {
    return -CROUCH_DEPTH * Math.sin((elapsed / CROUCH_MS) * Math.PI);
  }
  if (elapsed < CROUCH_MS + AIR_MS) {
    const t = (elapsed - CROUCH_MS) / AIR_MS;
    return Math.sin(t * Math.PI) * JUMP_HEIGHT;
  }
  const t = (elapsed - CROUCH_MS - AIR_MS) / SETTLE_MS;
  return Math.sin(t * Math.PI) * SETTLE_HEIGHT;
}

/** Yaw spin: a full 360° turn across the airborne beat (0 before/after). */
function hopSpin(elapsed: number): number {
  if (elapsed < CROUCH_MS || elapsed >= CROUCH_MS + AIR_MS) {
    return 0;
  }
  const t = (elapsed - CROUCH_MS) / AIR_MS;
  return t * Math.PI * 2;
}

/**
 * The current additive hop offset (pure — no mutation). Advances the
 * state machine: when the hop finishes it clears itself and returns the
 * idle zero offset. `syncStage` reads this and adds it to the person's
 * placed pose.
 */
export function parkourOffset(person: Object3D, nowMs: number): ParkourOffset {
  const state = getState(person);
  if (state.startMs === null) {
    return IDLE;
  }
  const elapsed = nowMs - state.startMs;
  if (elapsed < 0 || elapsed >= TOTAL_MS) {
    state.startMs = null;
    return IDLE;
  }
  return { y: hopHeight(elapsed), spin: hopSpin(elapsed), active: true };
}
