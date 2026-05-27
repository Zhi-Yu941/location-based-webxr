# `store-ref.ts`

## Purpose

Tiny observable reference for the recorder app's "current store". Lets
consumer-side subscribers re-attach when the store is swapped (start of
recording, replay, soft reset), instead of capturing the boot store in a
closure and silently regressing — the F1 failure mode documented in
[2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

## Public API

- `createStoreRef<T>(initial: T): StoreRef<T>` — constructor.
- `StoreRef<T>`:
  - `get(): T` — returns the current value.
  - `set(value: T): void` — updates the value and notifies every
    subscriber synchronously, in subscription order. No equality check
    (caller decides; the swap case wants notification even if the new
    reference is `===` the old one in tests).
  - `subscribe(listener: (value: T) => void): () => void` — registers a
    listener and returns an unsubscribe function. Listeners are
    invoked _after_ the internal value has been updated, so
    `ref.get()` inside the listener returns the new value.

## Invariants

- Listener notification is synchronous and ordered.
- A listener that calls `unsubscribe()` from within itself does not
  affect the current notification pass (snapshot iteration). Other
  listeners still fire.
- No defensive validation of `value` shape — the type system is the
  contract.

## Example

```ts
const ref = createStoreRef(bootStore);
ref.subscribe((s) => attachHudSubscriber(s));
// Later, on start-recording:
ref.set(newRecordingStore);
```

## Tests

- `store-ref.test.ts` — unit tests covering get/set/subscribe semantics
  and the "unsubscribe during notify" tolerance.
- Used indirectly by
  `ui/hud-tracking-quality-subscriber.test.ts` for the F1 fix.
