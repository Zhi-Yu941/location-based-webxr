# `enable-gps-ar.ts` — headless "Enable GPS AR" seam

## Purpose

The reusable permission/enter-AR **orchestration** an app's "Enable GPS AR"
button drives (Decision B3). It composes the framework's existing building
blocks — WebXR support check, the individual permission requesters, the
GPS/orientation watches and `initAR` — into one in-gesture sequence with an
observable status. The app renders its **own** `<button>` over the state; the
framework does not own button DOM (unlike three.js' `ARButton`).

## Public API

- `createEnableGpsArController(deps?: Partial<EnableGpsArDeps>) => EnableGpsArController`
  - `getState(): EnableGpsArState` — `{ status, error? }`.
  - `subscribe(listener) => unsubscribe` — state-change notifications.
  - `refreshSupport(): Promise<void>` — `checking → ready | unsupported`.
  - `enable(config: EnableGpsArConfig): Promise<EnableGpsArResult>` — the
    in-gesture orchestration; returns `{ ok, error? }`.
- Types: `EnableGpsArStatus`, `EnableGpsArState`, `EnableGpsArConfig`,
  `EnableGpsArResult`, `EnableGpsArDeps`, `EnableGpsArController`.

### `EnableGpsArStatus`

`checking → ready → starting → running` on success; any failure routes to
`error`; an unsupported probe routes to `unsupported`.

## Invariants & assumptions

- **Minimal default permission set:** the default path requests only WebXR
  support + geolocation + orientation. `requestWebXRWithDepthPermission` is
  called **only** when `config.requestDepth === true`. The seam never calls
  `requestAllPermissions()` (which would also probe depth _and_ camera).
- **Required vs. best-effort:** geolocation (and depth, when opted in) are
  blocking — a non-`granted` status routes to `error` and `initAR` is never
  reached. Orientation is best-effort: a denial is ignored (the compass simply
  degrades; we still request it so iOS prompts inside the gesture).
- **Async UX rule:** `enable()` always passes through the transitional
  `starting` state before the durable `running`/`error` final state, on both the
  success and the denied path. Tests assert this ordering for both.
- **Idempotency:** `enable()` is a no-op (returns `{ ok: false }`) while the
  status is `starting` or `running`, so a double-tap cannot start two sessions.
- **In-gesture requirement:** `enable()` must be called synchronously from a
  user gesture so the permission prompts are allowed by the browser.
- **DI:** every collaborator is injectable; defaults bind to the real framework
  functions (`isWebXRSupported`, `requestGeolocationPermission`,
  `requestOrientationPermission`, `requestWebXRWithDepthPermission`,
  `startGpsWatch`, `startOrientationWatch`, `initAR`). This keeps the
  orchestration unit-testable without WebXR/GPS hardware or a DOM.
- Uses the `PermissionStatus`-returning `requestOrientationPermission` from
  `sensors/permission-checker.ts`, **not** the legacy `boolean`-returning one in
  `sensors/gps.ts` (plan §6.1 disambiguation).

## Examples

```ts
import { createEnableGpsArController } from 'gps-plus-slam-app-framework/ar';

const controller = createEnableGpsArController();
await controller.refreshSupport();

button.disabled = controller.getState().status !== 'ready';
button.addEventListener('click', () => {
  void controller.enable({
    container: document.getElementById('app')!,
    requestHitTest: true,
    onGpsPosition: (p) => store.dispatch(/* … */),
  });
});
controller.subscribe((s) => {
  button.textContent = s.status === 'starting' ? 'Starting…' : 'Enable GPS AR';
});
```

## Tests

`enable-gps-ar.test.ts` covers: support probe (`ready`/`unsupported`/throwing),
minimal default set (depth NOT probed), `requestHitTest` forwarding, depth opt-in,
geolocation-denied error (no `initAR`), orientation-denied proceed, depth-denied
error, `initAR` rejection, the `starting → running` and `starting → error`
transitional ordering, idempotency (running + still-starting), and unsubscribe
hygiene.

## Related

- Plan: `GpsPlusSlamJs_Docs/docs/2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md`
  §5 Step 1, §6.1, §6.5.
- [webxr-session.ts](./webxr-session.ts) — `initAR`, `isWebXRSupported`,
  `SessionFeatureOptions`.
- [gps.ts](../sensors/gps.ts) — `startGpsWatch`, `startOrientationWatch`.
- [permission-checker.ts](../sensors/permission-checker.ts) — the permission requesters.
