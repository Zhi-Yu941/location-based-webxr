/**
 * Setup state machine — the pedagogical core of the persistent-anchor
 * starter example.
 *
 * It encodes the sequential first-user-experience as an explicit, named,
 * pure finite state machine instead of inline `if`/flag glue.
 *
 * Two branches, chosen at boot by "is there a cached anchor?":
 *
 *   cache-miss:  booting → awaiting-tracking ⇄ ready-to-place
 *                          → (PLACE_REQUESTED) saving
 *                          → (PLACE_SUCCEEDED) saved        [prompt reload]
 *                          → (PLACE_FAILED)    back to placeable + error
 *                          → (PLACE_BLOCKED)   stays placeable + hint (no save)
 *
 *   cache-hit:   booting → relocalising → (tracking ready) anchor-shown
 *
 * Placement is **soft-gated** (decision D2): the user may place the anchor
 * at any point in the placement branch; tracking-readiness only drives a
 * *recommendation* (surfaced by the onboarding guidance meter), never a
 * hard block. The async place/save follows the repo async-UX rule: the
 * `saving` phase is the in-progress state and resolves to either `saved`
 * (final) or back to a placeable phase carrying `errorMessage` (revert).
 */

// Internal union (not re-exported): the public surface is `SetupState`, which
// carries this as its `phase` field. Consumers reach it via `SetupState["phase"]`.
type SetupPhase =
  | "booting"
  | "awaiting-tracking"
  | "ready-to-place"
  | "saving"
  | "saved"
  | "relocalising"
  | "anchor-shown";

export interface SetupState {
  readonly phase: SetupPhase;
  /**
   * Whether tracking is currently good enough to *recommend* placing (or, in
   * the cache-hit branch, to reveal the saved anchor). Soft-gate: placement
   * is allowed regardless of this flag.
   */
  readonly trackingReady: boolean;
  /** Last placement error, surfaced to the user; cleared on the next attempt. */
  readonly errorMessage: string | null;
}

export type SetupEvent =
  | { type: "BOOTED"; hasCachedAnchor: boolean }
  | { type: "TRACKING_READY_CHANGED"; ready: boolean }
  | { type: "PLACE_REQUESTED" }
  | { type: "PLACE_SUCCEEDED" }
  | { type: "PLACE_FAILED"; message: string }
  | { type: "PLACE_BLOCKED"; message: string };

export const initialSetupState: SetupState = {
  phase: "booting",
  trackingReady: false,
  errorMessage: null,
};

/**
 * Pure reducer. Unknown / out-of-branch events return the *same* state
 * reference (no-op), so callers can dispatch freely without guarding every
 * transition.
 */
export function setupReducer(state: SetupState, event: SetupEvent): SetupState {
  switch (event.type) {
    case "BOOTED": {
      // Idempotent guard: only the initial booting phase reacts to BOOTED.
      if (state.phase !== "booting") return state;
      // Respect a `trackingReady` that arrived *before* BOOTED. The store
      // subscription (and thus TRACKING_READY_CHANGED) is live before the
      // branch is chosen, so tracking can already be good at boot. Pick the
      // phase the machine would have reached had readiness been applied after
      // the split — otherwise we linger in a stale waiting phase (relocalising
      // / awaiting-tracking) that no further (unchanged) readiness event would
      // ever advance.
      const phase: SetupPhase = event.hasCachedAnchor
        ? state.trackingReady
          ? "anchor-shown"
          : "relocalising"
        : state.trackingReady
          ? "ready-to-place"
          : "awaiting-tracking";
      return { ...state, phase };
    }

    case "TRACKING_READY_CHANGED": {
      const trackingReady = event.ready;
      let phase = state.phase;
      if (event.ready) {
        if (state.phase === "awaiting-tracking") phase = "ready-to-place";
        else if (state.phase === "relocalising") phase = "anchor-shown";
      } else if (state.phase === "ready-to-place") {
        phase = "awaiting-tracking";
      } else if (state.phase === "anchor-shown") {
        // Symmetric revert (mirrors ready-to-place → awaiting-tracking): when
        // tracking is lost the shown anchor's pose is no longer trustworthy, so
        // drop back to relocalising. Otherwise the placement banner would keep
        // claiming the anchor "is shown at its real-world spot" while the
        // guidance meter reports the loss — a contradictory UI and an
        // inconsistent {anchor-shown, trackingReady:false} state. Regaining
        // tracking re-advances relocalising → anchor-shown above.
        phase = "relocalising";
      }
      if (phase === state.phase && trackingReady === state.trackingReady) {
        return state;
      }
      return { ...state, phase, trackingReady };
    }

    case "PLACE_REQUESTED": {
      if (
        state.phase !== "awaiting-tracking" &&
        state.phase !== "ready-to-place"
      ) {
        return state;
      }
      return { ...state, phase: "saving", errorMessage: null };
    }

    case "PLACE_SUCCEEDED": {
      if (state.phase !== "saving") return state;
      return { ...state, phase: "saved" };
    }

    case "PLACE_FAILED": {
      if (state.phase !== "saving") return state;
      // Async-UX rule: revert the in-progress state and surface the error.
      return {
        ...state,
        phase: state.trackingReady ? "ready-to-place" : "awaiting-tracking",
        errorMessage: event.message,
      };
    }

    case "PLACE_BLOCKED": {
      // A press that cannot place yet (no surface under the reticle / no GPS
      // alignment). Surface the hint WITHOUT entering `saving` — nothing was
      // attempted, so the phase is unchanged and the button stays placeable.
      // Only meaningful in the cache-miss placement branch.
      if (
        state.phase !== "awaiting-tracking" &&
        state.phase !== "ready-to-place"
      ) {
        return state;
      }
      if (state.errorMessage === event.message) return state;
      return { ...state, errorMessage: event.message };
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Soft-gate predicate: may the user dispatch a placement now? True only in
 * the cache-miss placement branch and never while a save is in flight.
 */
export function canPlaceAnchor(state: SetupState): boolean {
  return (
    state.phase === "awaiting-tracking" || state.phase === "ready-to-place"
  );
}
