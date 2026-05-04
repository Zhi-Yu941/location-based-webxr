# `create-slam-app-store.ts`

## Purpose

Composable Redux store factory for any AR+GPS application built on
`gps-plus-slam-app-framework`. Wires the library reducers
(`gpsData` / `gpsElements` / `arElements`), the framework-owned recording
lifecycle slice (`recorder`), and the persistence middleware. Caller-supplied
slices and middleware plug in via `extraReducers` / `extraMiddleware`.

Introduced in **Iter 1** of the
[AppFramework / RecorderApp boundary migration plan](../../../../GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
Replaces the recorder-flavoured `createRecorderStore` in
[store.ts](store.ts) for non-recorder consumers; the recorder will keep a
thin `createRecorderStore` that calls this factory with its own extras.

## Public API

- `createSlamAppStore<ExtraReducers>(options)` — returns a `SlamAppStore`.
- `SlamAppStore<ExtraReducers>` — opaque store with `getState` / `dispatch` /
  `subscribe` / `writeFrame` / `writeSessionMetadata`.
- `SlamAppStoreOptions<ExtraReducers>` — `{ storageBackend, extraReducers?, extraMiddleware?, onWriteFailure?, enableDevChecks?, licenseKey? }`.
- `SlamAppRootState` — base state shape (no extras).
- `SlamAppCombinedState<ExtraReducers>` — base state plus typed extras.
- `SlamAppMiddleware` — middleware signature accepted by `extraMiddleware`.

## Invariants & assumptions

- `storageBackend` is **required**. Tests / replay paths must pass
  `NullStorageBackend`. The factory does not silently fall back to OPFS — the
  caller decides.
- `licenseKey` defaults to the bundled `COMMUNITY_LICENSE_KEY`. Validation
  always runs (`validateLicenseKey`) and throws on invalid / expired / empty
  keys; there is no bypass.
- `extraReducers` keys must not collide with the built-in slice keys
  (`gpsData`, `gpsElements`, `arElements`, `recorder`). RTK overwrites the
  built-in if a collision occurs — callers are responsible for avoiding it.
- `extraMiddleware` is appended **after** the persistence middleware, so
  consumer middleware sees actions that have already been persisted.
- The factory does **not** know about routing, ref-points, or scenarios. Any
  app needing those plugs them in via `extraReducers`.

## Examples

```ts
// Minimal generic AR+GPS app — no recorder slices.
import {
  createSlamAppStore,
  NullStorageBackend,
} from 'gps-plus-slam-app-framework/state';

const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
store.getState().gpsData; // library state, ready to use
```

```ts
// Recorder-flavoured composition (target shape after Iter 1D).
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { routingReducer } from './recorder-state/routing-slice';
import { scenarioReducer } from './recorder-state/scenario-slice';
import { refPointsReducer } from 'gps-plus-slam-app-framework/state';

const store = createSlamAppStore({
  storageBackend,
  extraReducers: {
    routing: routingReducer,
    scenario: scenarioReducer,
    refPoints: refPointsReducer,
  },
});
```

## Tests

Covered by [create-slam-app-store.test.ts](create-slam-app-store.test.ts):

- Base state shape contains library reducers + `recorder`.
- Routing / refPoints / scenario are absent unless supplied as extras.
- `startSession` / `endSession` flow through the recording slice.
- `extraReducers` mount under their slice keys and accept their actions.
- `extraMiddleware` runs alongside the persistence middleware.
- `writeFrame` / `writeSessionMetadata` route through the supplied backend.
- Empty / invalid license keys throw at construction.
