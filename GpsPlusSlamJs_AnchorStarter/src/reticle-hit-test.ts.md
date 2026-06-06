# reticle-hit-test.ts

## Purpose

WebXR glue that drives a screen-centre hit-test reticle for the cache-miss
placement flow. It parents the framework's reticle mesh under `arWorldGroup` and
moves/shows/hides it from the XR frame loop, exposing a small `ReticleHandle`
the `#place-button` glue reads at press time.

The reticle _view-model_ (`createReticleMesh` / `updateReticle`) is the
framework's tested [hit-test-reticle.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/hit-test-reticle.ts);
only the device-only per-frame plumbing lives here.

## Public API

- `interface ReticleHandle`:
  - `isVisible(): boolean` — is a surface under the screen-centre reticle?
  - `getWorldPosition(out: Vector3): Vector3` — the reticle's current world pose
    (GPS-world NUE once `arWorldGroup` carries the alignment).
  - `dispose(): void` — remove the mesh + unregister the frame loop (idempotent).
- `startReticleHitTest({ arWorldGroup }): ReticleHandle` — install + start.

## Invariants & assumptions

- AnchorStarter does **not** wire a `select` (tap) handler — placement is the
  `#place-button`, unlike the MinimalExample.
- The reticle stays hidden until a hit-test source is obtained and a surface is
  found; on older runtimes without `requestHitTestSource` it stays hidden.
- `dispose()` is idempotent (guarded), so disposing on successful placement and
  again on `beforeunload`/boot-rollback is safe. It also tears down the live XR
  state: it cancels the `XRHitTestSource` (`source.cancel()`) so it stops running
  after teardown and removes the one-shot `session` `"end"` listener.
- The `"end"` listener is registered exactly once. The request-retry path resets
  `hitTestSourceRequested`, so the listener is kept out of that block to avoid
  stacking a duplicate listener on every failed `requestHitTestSource`.
- Swapped wholesale in e2e via the `startReticleHitTest` seam (Playwright
  Chromium has no WebXR), so the per-frame loop here is verified on-device only.

## Examples

```ts
const handle = startReticleHitTest({ arWorldGroup });
// at Place time:
if (handle.isVisible()) {
  const worldPose = handle.getWorldPosition(new Vector3());
  // …place the marker at worldPose…
}
handle.dispose();
```

## Tests

The per-frame surface _rendering_ (the on-device hit-test draw) stays manually
verified, but the XR _lifecycle_ is unit-tested in
[reticle-hit-test.test.ts](reticle-hit-test.test.ts) (framework barrels mocked):
the `"end"` listener is registered exactly once across request retries,
`dispose()` cancels the live source + removes the listener (and is idempotent),
a source that resolves after `dispose()` is cancelled rather than adopted, and
the reticle is driven with the hit pose / hidden with `null` (incl. runtimes
without `requestHitTestSource`). The placement decision it feeds is unit-tested
in [placement-decision.test.ts](placement-decision.test.ts), and the e2e
[placement-flow.spec.js](../playwright-tests/placement-flow.spec.js) drives the
seam fake to assert the reticle gate (visible → places; hidden → hint).
