/**
 * Tiny observable reference for the recorder app's "current store".
 *
 * Background — F1 from
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * the recorder app swaps the Redux store when the user starts a new
 * recording (or switches into replay). Any subscriber that captured the
 * boot-time `store` reference in a closure keeps reading the stale store
 * after the swap. The previous F1 fix re-pointed the producer
 * (`setTrackingStore(newStore)`); this module is the consumer-side
 * analogue: an emitter that fires whenever the active store identity
 * changes, so subscribers can re-attach to the new store instead of
 * silently regressing.
 *
 * Intentionally minimal — no equality check on `set` (caller decides),
 * synchronous listener notification, no error swallowing.
 */

export interface StoreRef<T> {
  /** Read the current value. */
  get(): T;
  /** Replace the current value and notify every listener synchronously. */
  set(value: T): void;
  /**
   * Subscribe to value changes. The listener is invoked *after* the
   * internal value has been updated, so `ref.get()` inside the listener
   * returns the new value. Returns an unsubscribe function.
   */
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * Attach a resource to the CURRENT store and re-attach on every store swap
 * (quality-review G-11 — five recorder wirers hand-rolled this identical
 * dance and one copy had already drifted; the F1 feedback doc records this
 * exact stale-store bug class).
 *
 * `attach(store)` wires against the given store and returns its detach.
 * Swap-specific resets (clearing a visualizer, resetting throttle counters)
 * belong at the START of `attach` — they are no-ops on the initial
 * attachment and run exactly once per swap after the previous detach.
 * The returned disposer detaches the current attachment and stops following.
 */
export function followStore<T>(
  storeRef: StoreRef<T>,
  attach: (store: T) => () => void
): () => void {
  let detach = attach(storeRef.get());
  const unsubscribeSwap = storeRef.subscribe((nextStore) => {
    detach();
    detach = attach(nextStore);
  });
  return () => {
    detach();
    unsubscribeSwap();
  };
}

export function createStoreRef<T>(initial: T): StoreRef<T> {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => current,
    set: (value: T) => {
      current = value;
      // Snapshot to tolerate listeners that unsubscribe during iteration.
      for (const listener of [...listeners]) listener(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
