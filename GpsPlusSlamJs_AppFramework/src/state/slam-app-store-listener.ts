/**
 * `createSlamAppStoreListenerMiddleware` — applies the compass debug/experiment
 * opt-in flags (`coldStartOverrideEnabled`, `compassRotationPriorEnabled`,
 * `compassWebXRConsistencyEnabled`) as **top-level** dispatches once the
 * `gpsData` slice exists.
 *
 * Why a listener middleware (and not `store.subscribe`)
 * -----------------------------------------------------
 * The flags live on the library `gpsData` slice, which is `null` until the
 * first `setZeroPos`. So we must dispatch a *follow-up* action in reaction to
 * `gpsData` appearing. Doing that from a raw `store.subscribe` listener
 * dispatches **synchronously inside** the trigger's `next()`, and the recorder's
 * persistence middleware assigns its replay index *after* `next()` — so the
 * nested opt-in gets a LOWER index than the `setZeroPos` that created
 * `gpsData`, is recorded *before* its trigger, and is dropped on replay
 * (field bug 2026-06-27, recordings 64c6a294 / e7431b85).
 *
 * A prepended listener-middleware *effect* runs **after** the triggering
 * dispatch has fully unwound, so `api.dispatch(...)` here is a fresh top-level
 * dispatch that reaches the persistence middleware *after* the trigger and
 * therefore replays in causal order — the fix is structural, with no
 * `queueMicrotask` / re-entrancy guard to hand-maintain. This mirrors the
 * established {@link createTrackingQualityListenerMiddleware} precedent in the
 * same folder.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-28-subscriber-dispatch-persistence-ordering-plan.md
 * @see GpsPlusSlamJs_Docs/docs/2026-06-28-subscriber-dispatch-persistence-ordering-review.md
 * @see ./tracking-quality.ts (createTrackingQualityListenerMiddleware)
 */
import type { Middleware, UnknownAction } from '@reduxjs/toolkit';
import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { RootState as LibraryRootState } from 'gps-plus-slam-js';

/**
 * A single compass opt-in: a predicate reading whether the flag is already set
 * on `gpsData`, and the action that sets it.
 *
 * `apply` receives a bound `dispatch` (the listener effect's) rather than
 * closing over the store, so the descriptor can be built *before* the store
 * exists (the middleware is passed into `configureStore`).
 */
export interface CompassOptIn {
  /** Whether the flag is already set on the current library state. */
  isSet: (state: LibraryRootState) => boolean;
  /** Dispatch the action that sets the flag (e.g. `setColdStartOverrideEnabled(true)`). */
  apply: (dispatch: (action: UnknownAction) => void) => void;
}

/**
 * Build a listener middleware that applies the requested compass opt-ins once
 * `gpsData` exists and a flag is still unset. Register it via `.prepend(...)`
 * (so its effect dispatches *outside* the trigger's `next()` — see module doc).
 *
 * Behaviour:
 *  - **Predicate** fires whenever the `gpsData` *object reference* is new since
 *    the last apply AND at least one opt-in is still unset. Two terms, each load-
 *    bearing:
 *    - `s.gpsData !== lastApplied` makes the predicate edge-triggered on gpsData
 *      identity. A recreated `gpsData` (store swap / origin reset) is a fresh
 *      object, so it still re-triggers the apply — the re-apply semantics the
 *      2026-06-27 field bug demands are preserved. Do NOT weaken this to a
 *      `null → non-null` transition: that would drop the re-apply. The point of
 *      keying on the *reference* (not on "a flag is unset") is that it also stops
 *      the effect from re-firing for the SAME gpsData.
 *    - `optIns.some((o) => !o.isSet(s))` keeps the no-op case (all flags already
 *      set) from scheduling an effect at all.
 *    Why the reference guard matters: without it the predicate is purely level-
 *    based, so if an opt-in's `apply` dispatches but `isSet` never flips true
 *    (e.g. consumer/library **version skew** where the action type no longer
 *    matches the reducer — the packages are published independently), the
 *    condition stays true forever and every effect dispatch re-arms it: an
 *    unbounded storm that freezes the app. The per-dispatch `isSet` re-check
 *    below guards only against dispatching an *already-set* flag twice; it does
 *    nothing when the flag never sets. The reference guard is what bounds it.
 *  - **Effect** records the gpsData reference it is acting on, then dispatches
 *    every still-unset opt-in as a top-level action. `isSet` is re-read against
 *    the *current* store state immediately before each dispatch (not one snapshot
 *    at effect entry): a dispatch is synchronous, so a flag is already set by the
 *    time the next check runs, and an opt-in's own dispatch can re-enter this
 *    effect before the loop finishes. Re-checking per dispatch makes that
 *    re-entrancy idempotent — a flag is dispatched only while still unset.
 */
export function createSlamAppStoreListenerMiddleware(
  optIns: readonly CompassOptIn[]
): Middleware {
  const listenerMiddleware = createListenerMiddleware();
  // The gpsData reference the opt-ins were last applied against. Guards the
  // predicate from re-firing for the same gpsData (see module doc) while still
  // re-applying when gpsData is recreated (a new reference).
  let lastApplied: unknown = null;
  listenerMiddleware.startListening({
    predicate: (_action, currentState): boolean => {
      const s = currentState as LibraryRootState;
      return (
        s.gpsData !== null &&
        s.gpsData !== lastApplied &&
        optIns.some((optIn) => !optIn.isSet(s))
      );
    },
    effect: (_action, api): void => {
      const entry = api.getState() as LibraryRootState;
      if (entry.gpsData === null) return; // flags live on gpsData; nothing to set yet
      lastApplied = entry.gpsData;
      for (const optIn of optIns) {
        const s = api.getState() as LibraryRootState;
        if (s.gpsData === null) return;
        if (!optIn.isSet(s)) {
          optIn.apply((action) => {
            api.dispatch(action);
          });
        }
      }
    },
  });
  return listenerMiddleware.middleware;
}
