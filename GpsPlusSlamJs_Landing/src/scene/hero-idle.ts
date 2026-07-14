import {
  ConeGeometry,
  CapsuleGeometry,
  SphereGeometry,
  Vector3,
  type Group,
  type Object3D,
} from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * Hero idle beat (easter-egg catalog №6): if the visitor rests at the
 * hero for over 60 s (scroll ≈ 0, tab visible, scroll mode, motion
 * allowed), a tiny second dot-person peeks out once from behind a
 * hero-side bush, then ducks back. Once per visit; the dot-person of the
 * story can't star (it waits sky-parked pre-drop), so this is a separate
 * little character.
 *
 * The beat runs on wall-clock time (never the scroll timeline). The
 * idle-timer state machine is pure/testable; the controller feeds it
 * `idleActive` each frame.
 */

const HERO_IDLE_NAME = "hero-idle";
export const HERO_IDLE_MS = 60_000;
const PEEK_MS = 2400;
/** Parked (hidden) and peeked (visible) heights of the peeker. */
const HIDDEN_Y = -1.4;
const PEEK_Y = 0.35;

/** A hero-side spot in the hero framing's view: the open ground on the
 * RIGHT (NDC ≈ 0.76, −0.03 at the settled hero framing), clear of the
 * copy panel (left) and the code snippet (center-bottom). */
const HERO_IDLE_ANCHOR = new Vector3(8, 0, -14);

export interface HeroPeeker {
  readonly group: Group;
  /** The peeker sub-group whose Y the beat animates. */
  readonly peeker: Group;
}

/** Build the bush + the hidden peeker behind it. */
export function buildHeroPeeker(): HeroPeeker {
  const group = namedGroup(HERO_IDLE_NAME);
  group.position.copy(HERO_IDLE_ANCHOR);

  // A little bush to hide behind (foliage cone, no shadow).
  const bush = clayMesh(new ConeGeometry(1.1, 1.8, 7), "foliage");
  bush.position.y = 0.9;
  bush.castShadow = false;

  // The peeker: a mini dot-person (teal `person` role), parked below.
  const peeker = namedGroup("hero-peeker");
  const body = clayMesh(new CapsuleGeometry(0.2, 0.45, 4, 8), "person");
  body.position.y = 0.5;
  body.castShadow = false;
  const head = clayMesh(new SphereGeometry(0.15, 10, 8), "person");
  head.position.y = 1.0;
  head.castShadow = false;
  peeker.add(body, head);
  // Behind the bush from the hero camera (which looks from +x/+z).
  peeker.position.set(-0.7, HIDDEN_Y, -0.4);

  group.add(bush, peeker);
  group.visible = false;
  return { group, peeker };
}

interface BeatState {
  /** When the current continuous idle stretch began (null = not idle). */
  idleSinceMs: number | null;
  /** When the peek animation started (null = not peeking). */
  peekStartMs: number | null;
  /** Once-per-visit latch. */
  fired: boolean;
}

/** Peek envelope: rise → hold → duck, 0 at both ends. */
function peekLift(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / PEEK_MS));
  // Smooth up over the first 25%, hold, ease down over the last 30%.
  if (t < 0.25) {
    return (t / 0.25) * (t / 0.25);
  }
  if (t < 0.7) {
    return 1;
  }
  const d = (t - 0.7) / 0.3;
  return Math.max(0, 1 - d * d);
}

export interface HeroIdleBeat {
  /** Feed one frame: `idleActive` = resting at the hero, tab visible,
   * scroll mode, motion allowed. Returns true while the peek animates. */
  update(nowMs: number, idleActive: boolean): boolean;
}

export function createHeroIdleBeat(
  group: Object3D,
  peeker: Object3D,
): HeroIdleBeat {
  const state: BeatState = {
    idleSinceMs: null,
    peekStartMs: null,
    fired: false,
  };

  const park = (): void => {
    peeker.position.y = HIDDEN_Y;
    group.visible = false;
  };

  return {
    update(nowMs, idleActive) {
      // Drive a running peek to completion regardless of idle changes.
      if (state.peekStartMs !== null) {
        const elapsed = nowMs - state.peekStartMs;
        if (elapsed >= PEEK_MS) {
          state.peekStartMs = null;
          park();
          return false;
        }
        peeker.position.y = HIDDEN_Y + (PEEK_Y - HIDDEN_Y) * peekLift(elapsed);
        return true;
      }
      if (!idleActive) {
        state.idleSinceMs = null;
        return false;
      }
      if (state.idleSinceMs === null) {
        state.idleSinceMs = nowMs;
      }
      if (!state.fired && nowMs - state.idleSinceMs >= HERO_IDLE_MS) {
        state.fired = true;
        state.peekStartMs = nowMs;
        group.visible = true;
        return true;
      }
      return false;
    },
  };
}
