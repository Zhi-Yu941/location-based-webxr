# system-session-end.ts

## Purpose

The app's reaction to the framework's session-end callback (F3, 2026-07-04
user feedback): when the **system** ends the XRSession (Android back gesture —
uncancelable, no popstate), turn the old "haunted scene" (black camera,
recording still running, stale history) into a clean, explained exit.

## Public API

- `createSystemSessionEndHandler(deps)` → `(info: SessionEndInfo) => Promise<void>`
  - The returned function is passed to the framework via `initAR`'s
    `callbacks.onSessionEnd` (in `main.ts`, during `handleEnterAR`). It returns
    a promise **only so tests can await it** — the framework treats it as
    fire-and-forget and every rejection is handled internally.
- `SystemSessionEndDeps` — injected collaborators, all thin wrappers over
  existing app functions:
  - `getCurrentScreen` → `ui/navigation`
  - `stopRecording` → `recordingSessionHandlers.handleStopRecording`
  - `replaceScreen` → `replaceScreenState`
  - `showSetupUi` → `showSetupModal`
  - `showToast` / `showError` → the existing toast/error channels
- `SYSTEM_END_SAVED_TOAST` / `SYSTEM_END_INFO_TOAST` — the exact user-facing
  strings (exported so tests and future UI reviews reference one source).

## Behavior / Invariants

- `requestedByApp: true` → **complete no-op.** Explicit `endARSession()` flows
  (stop recording, init-failure cleanup) own their own UI and navigation.
- Screen `recording` → `await stopRecording()`; the regular stop flow already
  persists the data, **replaces the stale `recording` history entry with
  `summary`** and shows the summary — this handler must NOT navigate or touch
  history again on the success path (double navigation would corrupt the
  stack). Then the "recording saved" toast.
- Stop/save failure → error surfaces via `showError` (never a "saved" toast —
  the final state must reflect the durable end state), and the handler itself
  repairs history (`replaceScreen('setup')`) + shows the setup UI so the user
  is not stranded on a dead recording screen.
- Screen `ar` → `replaceScreen('setup')` + setup UI + informational toast.
- Screens `setup`/`summary` → no-op (nothing AR-bound left to clean up).
- Re-registration: the framework clears the callback on every session end
  (`resetWebXRState()`), so `main.ts` re-passes it via the `initAR` callbacks
  struct on **each** Enter AR.

## Examples

```typescript
const handler = createSystemSessionEndHandler({
  getCurrentScreen,
  stopRecording: () => recordingSessionHandlers.handleStopRecording(),
  replaceScreen: replaceScreenState,
  showSetupUi: showSetupModal,
  showToast: (message) => showToast(message),
  showError,
});
await initAR(container, isolationOptions, sessionFeatures, {
  onSessionEnd: (info) => void handler(info),
});
```

## Tests

- `system-session-end.test.ts` — all five branches above, including the
  failure path required by the async-UI-feedback rule (error surfaced, no
  lying success toast, user not stranded).
- On-device gate (physical Android): back gesture mid-recording → camera-app
  exit + summary + toast + recording present; tracked in
  `GpsPlusSlamJs_Docs/docs/2026-07-04-1626-ar-clipping-planes-and-lifecycle-plan.md`.

## Related docs

- [2026-07-04-1626-ar-clipping-planes-and-lifecycle-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-04-1626-ar-clipping-planes-and-lifecycle-plan.md) (F3)
- [2026-02-15-lifecycle-orphans.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-15-lifecycle-orphans.md) §1
