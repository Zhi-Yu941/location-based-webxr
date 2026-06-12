# Recording Session Handlers

## Purpose

Encapsulates recording-session lifecycle state and event handlers, extracted from `main.ts` via a factory pattern. Dependencies that change over the app lifecycle (store, scenario name, recording options) are injected; sensor/storage/UI modules are imported directly.

## Public API

### Types

| Export                     | Kind      | Description                                                             |
| -------------------------- | --------- | ----------------------------------------------------------------------- |
| `RecordingSessionDeps`     | Interface | Dependency bag for the factory (store access, options, callbacks, etc.) |
| `RecordingSessionHandlers` | Interface | Returned handle with lifecycle methods and tracker proxies              |

### Factory

| Function                               | Returns                    | Description                                              |
| -------------------------------------- | -------------------------- | -------------------------------------------------------- |
| `createRecordingSessionHandlers(deps)` | `RecordingSessionHandlers` | Creates a handler set bound to the provided deps closure |

### Handler methods

| Method                        | Description                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `handleStartRecording()`      | Starts session: storage, sensors, GPS watch, sync manager, store subscribers                        |
| `handleStopRecording()`       | Re-entrancy-guarded: stops sensors, final sync, hides recording controls (Bug 8 fix), shows summary |
| `handleBackDuringRecording()` | Shows confirmation dialog; on confirm stops recording and navigates back                            |
| `getCurrentSessionName()`     | Returns the current session name string                                                             |
| `setCurrentSessionName(name)` | Sets session name                                                                                   |
| `recordWriteSuccess()`        | Null-safe proxy to write-failure tracker                                                            |
| `recordWriteFailure(err)`     | Null-safe proxy to write-failure tracker                                                            |
| `recordCaptureSuccess()`      | Null-safe proxy to capture-failure tracker                                                          |
| `recordCaptureFailure()`      | Null-safe proxy to capture-failure tracker                                                          |
| `cleanupForNewRecording()`    | Tears down sync manager, store subscribers, failure trackers for soft reset                         |
| `reset()`                     | Full reset of all internal state                                                                    |

## Invariants & Assumptions

- **Factory pattern**: Each call to `createRecordingSessionHandlers` returns independent state. No module-level mutable state.
- **Dependency injection**: `getStore()` is called on every use to resolve the _current_ store (supports soft reset via Bug 9 getter pattern).
- **Scenario fallback is centralized**: Start-recording, metadata writing, and OPFS ZIP export all use the shared `FALLBACK_SCENARIO` constant when no scenario has been selected.
- **Recording controls cleanup**: `hideRecordingControls()` is called before transitioning to the summary screen so the HUD does not render on top of the summary overlay (Bug 8 fix).
- **Recording format**: New recordings write `odomCoordVersion: 5` to session metadata. Action payloads use `rawGpsPoint` (no derived fields) and `rawDeviceOrientation` as sibling fields. The reducer converts these to full `GpsPoint` when building state. Session metadata also includes optional `build` (commit hash, versions, build time) and a sanitized `pageUrl` (scheme + host + path, with search/hash stripped via the URL object) for debugging without persisting query/hash secrets. The scheme is preserved for URLs with opaque origins (e.g. `file://`).
- **Build metadata is best-effort**: `handleStopRecording()` logs and omits the optional `build` field if metadata lookup fails. The rest of `session.json` must still be written.
- **Back-button guard**: `backDuringRecordingInProgress` prevents concurrent back-button presses during the async stop flow.
- **Stop re-entrancy guard (Sentry issue 7319627943)**: `handleStopRecording()` is a thin guard around the real teardown (`performStop()`). A `stopInProgress` flag makes a second Stop tap during the multi-second final sync a no-op. Without it, the second invocation stopped + nulled the shared `syncManager` while the first was still awaiting `syncManager.syncNow()`, so the first then threw `Cannot read properties of null (reading 'stop')`. Defense in depth: `performStop()` also captures the manager into a local (`const sm = syncManager; syncManager = null;`) **before** the `await`, so any concurrent teardown (second stop, or `cleanupForNewRecording` on an XR session-end) sees `null` and no-ops instead of double-stopping. As feedback (and to remove the double-tap trigger), `handleStopRecording()` calls `setStopButtonBusy(true)` immediately — the Stop button is disabled + relabelled "Stopping…" for the duration; `showRecordingControls()` resets it to idle for the next recording.
- **Tracking store re-wire on new recording (Finding #1, 2026-05-23 user feedback)**: `handleStartRecording` must call `deps.setTrackingStore(newStore)` after `deps.setStore(newStore)`. The WebXR session caches the store reference passed at app boot; without re-pointing it, every `poseReceived` flows into the orphaned old store and the new store's `tracking.phase` never leaves `'initializing'`, which keeps the tracking-quality HUD pinned to "AR LOST" for the entire recording.

## Examples

```typescript
import { createRecordingSessionHandlers } from './recording-session-handlers';

const handlers = createRecordingSessionHandlers({
  getStore: () => store,
  setStore: (s) => {
    store = s;
  },
  setTrackingStore: (s) => setTrackingStore(s), // re-point WebXR at the new store (Finding #1)
  createNewStore: () => createRecorderStore(),
  getRecordingOptions: () => recordingOptions,
  getMapOverlay: () => mapOverlay,
  // (5.7a-3 Option C) clearRefPointUsage dep dropped; per-session usage tracking removed.
  getSessionNotes: () => notesInput.value,
  waitForZeroReference: (ms) => waitForGpsZero(ms),
  loadAndDisplayRefPoints: (h) => loadRefPoints(h),
  collectAndResetErrors: (t) => t.getAndReset(),
  applyAlignmentMatrix: (m) => scene.setMatrix(m),
});

await handlers.handleStartRecording();
// ... recording in progress ...
await handlers.handleStopRecording();
```

## Tests

- `recording-session-handlers.test.ts` — 63 tests covering:
  - Start/stop lifecycle, sensor wiring, storage session creation
  - Sync manager creation and final sync
  - Bug 8 regression: `hideRecordingControls` called before summary transition
  - Bug 12 baseline: documents main-thread ZIP export behavior
  - Build metadata inclusion and best-effort fallback when lookup fails
  - Back-during-recording confirmation flow
  - Write/capture failure tracker proxies
  - Cleanup and full reset
  - **Sentry 7319627943 regression** (`handleStopRecording` describe): a second Stop tap while the first final sync is in flight must not throw and must stop the sync manager + show the summary exactly once; `cleanupForNewRecording` racing the in-flight sync must not double-stop (capture-local defense); the Stop button is marked busy when stopping begins even when the final sync rejects.
- The `setStopButtonBusy` DOM behavior itself is covered in `../ui/hud.test.ts`.
