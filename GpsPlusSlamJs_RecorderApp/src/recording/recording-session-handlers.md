# recording-session-handlers

## Purpose

Encapsulates recording-session lifecycle state and event handlers extracted from `main.ts` (Finding #7, Step 3 of main.ts decomposition). Follows the same factory-with-DI pattern as `replay-handlers.ts` (Step 1) and `ref-point-handlers.ts` (Step 2).

## Public API

### `createRecordingSessionHandlers(deps: RecordingSessionDeps): RecordingSessionHandlers`

Factory function. Returns a handlers object that owns the recording lifecycle.

#### `RecordingSessionDeps` (injected by main.ts)

| Dependency                | Type                                                     | Purpose                                   |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `getStore`                | `() => RecorderStore`                                    | Access the current store instance         |
| `setStore`                | `(store) => void`                                        | Replace the module-level store in main.ts |
| `createNewStore`          | `() => RecorderStore`                                    | Create a fresh store for each recording   |
| `getCurrentScenarioName`  | `() => string`                                           | Read current scenario name                |
| `getRecordingOptions`     | `() => RecordingOptions`                                 | Read capture settings (depth, interval)   |
| `getMapOverlay`           | `() => LeafletMapOverlay \| null`                        | Access the map overlay                    |
| `clearRefPointUsage`      | `() => void`                                             | Reset ref-point tracking for new session  |
| `getSessionNotes`         | `() => string`                                           | Read session notes from UI                |
| `waitForZeroReference`    | `(timeoutMs?) => Promise<LatLong \| null>`               | Wait for GPS zero reference               |
| `loadAndDisplayRefPoints` | `(handle) => Promise<{refPointCount, observationCount}>` | Load prior ref points                     |
| `collectTrackerErrors`    | `(tracker, label, errors) => void`                       | Collect failure tracker errors            |
| `applyAlignmentMatrix`    | `(matrix) => void`                                       | Apply alignment to AR scene               |

#### `RecordingSessionHandlers` (returned interface)

| Method                        | Description                                                               |
| ----------------------------- | ------------------------------------------------------------------------- |
| `handleStartRecording()`      | Start a new recording session (creates store, starts GPS/sensors/capture) |
| `handleStopRecording()`       | Stop recording (stops sensors, exports zip, shows summary)                |
| `handleBackDuringRecording()` | Back-button during recording with confirmation dialog                     |
| `getCurrentSessionName()`     | Get the current session name                                              |
| `setCurrentSessionName(name)` | Set the current session name                                              |
| `recordWriteSuccess()`        | Null-safe proxy to write failure tracker                                  |
| `recordWriteFailure(err)`     | Null-safe proxy to write failure tracker                                  |
| `recordCaptureSuccess()`      | Null-safe proxy to capture failure tracker                                |
| `recordCaptureFailure()`      | Null-safe proxy to capture failure tracker                                |
| `cleanupForNewRecording()`    | Soft reset for starting a new recording                                   |
| `reset()`                     | Full state reset                                                          |

## State Owned (private)

- `writeFailureTracker` / `captureFailureTracker` — created per-session in `handleStartRecording`
- `currentSessionName` — timestamp-based session filename
- `syncManager` / `lastSyncResult` — external zip sync lifecycle
- `backDuringRecordingInProgress` — guard against double-tap of back button
- `unsubscribeStore` — store subscriber cleanup

Note: the ref-point VIEW subscribers (3D spheres + live-map markers) are NOT
wired here any more — they are AR-scoped and store-swap-following via main's
`storeRef` ([ui/ref-point-view-wiring.ts](../ui/ref-point-view-wiring.md),
round-3 feedback 2026-07-05); the `setStore(newStore)` call in
`handleStartRecording` is what triggers their re-wire.

## Invariants

- `handleStartRecording` always creates a **new store** via `deps.createNewStore()` and pushes it via `deps.setStore()`.
- `handleStartRecording` calls `gpsEventVisualizer.clearAll()` (disposes prior markers) and **immediately re-asserts** the `visualization.gpsAlignmentMarkers` opt-out via `setVisible(...)`. This is load-bearing: `clearAll()` resets the shared visualizer to its pristine _visible_ state (a replay-safety reset), and this path runs **after** Enter-AR already applied the opt-out — without the re-assert, GPS spheres reappear during recording despite the toggle being off (regression fixed 2026-06-18).
- Tracker proxy methods are null-safe — they do nothing if trackers haven't been created yet (i.e., before first recording starts).
- `cleanupForNewRecording` stops sync manager, resets trackers, and clears `currentSessionName`.
- `reset` sets everything to initial state (null trackers, empty session name, no sync manager).

## Tests

- [recording-session-handlers.test.ts](recording-session-handlers.test.ts) — 54 unit tests covering factory creation, start/stop lifecycle, back-button confirmation, cleanup, reset, and tracker proxies.
