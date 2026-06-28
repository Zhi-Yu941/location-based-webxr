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
 *  - **Predicate** fires whenever `gpsData` is non-null and at least one opt-in
 *    is still unset. This is intentionally *level-based*, not edge-based: keying
 *    on "a flag is unset" (rather than a `null → non-null` transition) means a
 *    recreated `gpsData` (store swap / origin reset) with cleared flags
 *    re-triggers the apply, matching the pre-existing re-apply semantics. Do not
 *    "simplify" it to a transition predicate — that would silently drop the
 *    re-apply (the 2026-06-27 field bug).
 *  - **Effect** dispatches every still-unset opt-in as a top-level action.
 *    `isSet` is re-read against the *current* store state immediately before
 *    each dispatch (not against one snapshot taken at effect entry). Redux
 *    dispatch is synchronous, so a flag is already set by the time the next
 *    check runs — and an opt-in's own dispatch re-triggers the predicate, which
 *    can re-enter this effect before the loop finishes. Re-checking per dispatch
 *    makes that re-entrancy idempotent: a flag is dispatched only while still
 *    unset, so it can never be dispatched twice (no "storm").
 */
export function createSlamAppStoreListenerMiddleware(
  optIns: readonly CompassOptIn[]
): Middleware {
  const listenerMiddleware = createListenerMiddleware();
  listenerMiddleware.startListening({
    predicate: (_action, currentState): boolean => {
      const s = currentState as LibraryRootState;
      return s.gpsData !== null && optIns.some((optIn) => !optIn.isSet(s));
    },
    effect: (_action, api): void => {
      for (const optIn of optIns) {
        const s = api.getState() as LibraryRootState;
        if (s.gpsData === null) return; // flags live on gpsData; nothing to set yet
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
