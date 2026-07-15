import type { Mesh, MeshStandardMaterial, Object3D } from "three";
import { VIGNETTE_NODE } from "./use-case-vignettes";

/**
 * Castle ghost-restore egg (catalog №3): the core "make the invisible
 * visible" message as a toy. Clicking the castle vignette briefly
 * SOLIDIFIES the translucent AR-blue ghost (the broken tower standing
 * again) while dimming the ruin, holds, then melts back.
 *
 * This is a RUNTIME-only material ramp on wall-clock event time (never
 * the scroll timeline). It captures each affected material's built state
 * on init and restores it EXACTLY when the effect ends, so the built
 * ghost opacity (pinned 0.1–0.6) and the `depthWrite: false` contract —
 * which keeps the ghost from occluding the ruin it explains — survive
 * untouched.
 */

const RAMP_UP_MS = 320;
const HOLD_MS = 1500;
const RAMP_DOWN_MS = 460;
const TOTAL_MS = RAMP_UP_MS + HOLD_MS + RAMP_DOWN_MS;
/** Peak opacity the ghost solidifies to. */
const GHOST_PEAK = 0.9;
/** Opacity the ruin dims to while the ghost is solid. */
const RUIN_DIM = 0.5;

interface TrackedMaterial {
  readonly material: MeshStandardMaterial;
  readonly baseOpacity: number;
  readonly baseTransparent: boolean;
}

interface RestoreState {
  /** Non-null while animating; the clock time the trigger fired. */
  startMs: number | null;
  readonly ghosts: TrackedMaterial[];
  readonly ruins: TrackedMaterial[];
}

function isStandardMesh(obj: Object3D): obj is Mesh {
  const mesh = obj as Mesh;
  return (
    mesh.isMesh === true &&
    (mesh.material as MeshStandardMaterial | undefined)?.isMaterial === true
  );
}

function track(obj: Object3D): TrackedMaterial {
  const material = (obj as Mesh).material as MeshStandardMaterial;
  return {
    material,
    baseOpacity: material.opacity,
    baseTransparent: material.transparent,
  };
}

/**
 * Capture the castle's ghost + ruin material baselines and stash the
 * effect state on the group. Call once after building the world.
 */
export function initGhostRestore(castle: Object3D): void {
  const ghosts: TrackedMaterial[] = [];
  const ruins: TrackedMaterial[] = [];
  const ghostGroup = castle.getObjectByName(VIGNETTE_NODE.ghost);
  ghostGroup?.traverse((obj) => {
    if (isStandardMesh(obj)) {
      ghosts.push(track(obj));
    }
  });
  for (const child of castle.children) {
    if (isStandardMesh(child) && child.userData.paletteRole === "ruin") {
      ruins.push(track(child));
    }
  }
  const state: RestoreState = { startMs: null, ghosts, ruins };
  castle.userData.ghostRestore = state;
}

function getState(castle: Object3D): RestoreState | null {
  return (castle.userData.ghostRestore as RestoreState | undefined) ?? null;
}

/**
 * Fire the restore effect. Ignored if one is already running (a
 * re-trigger must not restart/jump the ramp).
 */
export function triggerGhostRestore(castle: Object3D, nowMs: number): void {
  const state = getState(castle);
  if (!state || state.startMs !== null) {
    return;
  }
  state.startMs = nowMs;
}

/** 0→1→0 envelope: ramp up, hold at 1, ramp down. */
function envelope(elapsed: number): number {
  if (elapsed < RAMP_UP_MS) {
    return elapsed / RAMP_UP_MS;
  }
  if (elapsed < RAMP_UP_MS + HOLD_MS) {
    return 1;
  }
  return Math.max(0, 1 - (elapsed - RAMP_UP_MS - HOLD_MS) / RAMP_DOWN_MS);
}

/**
 * Advance the effect to the given clock time. Returns true while
 * animating (controller marks the frame dirty), false when idle. On
 * completion every material is restored to its captured built state.
 */
export function updateGhostRestore(castle: Object3D, nowMs: number): boolean {
  const state = getState(castle);
  if (!state || state.startMs === null) {
    return false;
  }
  const elapsed = nowMs - state.startMs;
  if (elapsed >= TOTAL_MS || elapsed < 0) {
    for (const g of state.ghosts) {
      g.material.opacity = g.baseOpacity;
      g.material.transparent = g.baseTransparent;
    }
    for (const r of state.ruins) {
      r.material.opacity = r.baseOpacity;
      r.material.transparent = r.baseTransparent;
    }
    state.startMs = null;
    return false;
  }
  const k = envelope(elapsed);
  for (const g of state.ghosts) {
    g.material.opacity = g.baseOpacity + (GHOST_PEAK - g.baseOpacity) * k;
  }
  for (const r of state.ruins) {
    // Dimming needs transparency; restored on completion above.
    r.material.transparent = true;
    r.material.opacity = r.baseOpacity + (RUIN_DIM - r.baseOpacity) * k;
  }
  return true;
}
