# ar-session-scope.ts

## Purpose

Disposer registry owning the teardown of AR-session-scoped resources (visualizers, store subscriptions, frame-loop handles) created by `main.ts`. Replaces the former per-resource hand-bookkeeping (dispose-first guards in `handleEnterAR` + the ordered list in `resetMainState`) with a single rule: whoever creates a session resource registers its teardown here, once, at the creation site.

## Public API

- `createArSessionScope(warn?)` → `ArSessionScope`. `warn(message, error?)` defaults to a `createLogger('ArSessionScope').warn` call; tests inject a spy.
- `ArSessionScope.add(name, disposer)` — register teardown for a resource created at the call site.
- `ArSessionScope.wire(name, enabled, factory)` — the shared gated-wiring shape: skip when `!enabled`; run `factory()` in try/catch (a throw logs `"<name> wiring skipped; recording continues without it"` and is swallowed); a function returned by the factory is auto-registered as the block's disposer.
- `ArSessionScope.dispose()` — run all registered disposers in reverse registration order, each isolated in its own try/catch (a throw logs `"<name> teardown failed; continuing with the rest"`), then leave the registry empty for the next session.

## Invariants & assumptions

- Reverse registration order — per wiring block, subscriptions unwind before the visualizers they feed (the property main.ts's old `resetMainState` order encoded by hand).
- Each disposer runs exactly once; the scope instance is app-lifetime and reused across sessions.
- Disposers registered during `dispose()` (teardown side effects) land in the NEXT session's registry.
- Error isolation both ways: a throwing factory never breaks AR entry; a throwing disposer never strands the remaining teardown.

## Examples

```ts
const scope = createArSessionScope();
scope.wire('frame tiles', options.visualization.frameTiles, () => {
  const viz = createFrameTileVisualizer(...);
  const unsubscribe = wireFrameTileSubscribers(...);
  return () => {
    unsubscribe();
    viz.dispose();
  };
});
scope.dispose(); // re-entering AR or resetMainState
```

## Tests

- `ar-session-scope.test.ts` — reverse order, one-shot dispose, error isolation (factory + disposer), gating, auto-registration, add-during-dispose.
- `ar-session-scope.property.test.ts` — fast-check: exactly-once + exact reverse order for arbitrary sequences with arbitrary throwing subsets.
