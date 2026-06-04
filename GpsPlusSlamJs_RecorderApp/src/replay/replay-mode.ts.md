# replay-mode.ts

## Purpose

Orchestrates all replay building blocks (Iterations 1-5) into a single entry point for desktop replay mode. Loads actions from a zip file, creates a store, initializes the Three.js scene, wires store subscribers, and returns a controller for the UI.

## Public API

### `startReplayMode(zipData, config): Promise<ReplayModeController>`

| Parameter           | Type                       | Description                         |
| ------------------- | -------------------------- | ----------------------------------- |
| `zipData`           | `Uint8Array`               | Raw zip file bytes                  |
| `config.container`  | `HTMLElement`              | DOM element for the Three.js canvas |
| `config.onProgress` | `(current, total) => void` | Progress callback                   |
| `config.onComplete` | `() => void`               | Completion callback                 |
| `config.onError`    | `(index, error) => void`   | Per-action error callback (R7)      |

### `ReplayModeController`

| Method              | Signature                   | Description                                  |
| ------------------- | --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `play(speedFactor)` | `(number) => Promise<void>` | Start dispatching actions at the given speed |
| `pause()`           | `() => void`                | Pause the replay                             |
| `resume()`          | `() => Promise<void>`       | Resume from where we paused                  |
| `setSpeed(factor)`  | `(number) => void`          | Change playback speed mid-replay             |
| `getState()`        | `() => ReplayState`         | Get current engine state                     |
| `getEngine()`       | `() => ReplayEngine`        | Get the underlying engine                    |
| `getStore()`        | `() => RecorderStore`       | Get the replay store (R6: same instance)     |
| `getActionCount()`  | `() => number`              | Total number of loaded actions               |
| `setMapOverlay(o)`  | `(MapOverlay                | null) => void`                               | Set/clear the real map overlay target for the proxy (forwards setGpsPosition, render, addCurrentMarker) |
| `dispose()`         | `() => void`                | Clean up scene, engine, and subscribers      |

## Invariants & Assumptions

- **R6 (Store identity):** The same `RecorderStore` instance is passed to `wireStoreSubscribers()` and `ReplayEngine.play()`. This ensures dispatched actions trigger visualization updates.
- **R7 (Error handling):** `onError` from config is wired to `ReplayEngine.onError()`. Dispatch errors don't crash the loop.
- **R8 (Data flow):** `loadActionsFromZip(zipData)` → maps each entry's `.action` → `ReplayAction[]` → `engine.play()`.
- Store uses `NullStorageBackend` — no persistence side effects during replay.
- **R9 / Issue #3 (Orbit auto-follow):** `onNewGpsPosition` is intentionally **not** wired. The orbit target is now driven by `onAlignmentSnapshot` (Issue #3), which fires when alignment-matrix changes create a snapshot. The snapshot NUE position ($A_k \cdot p_k$) is in scene-root space and is passed directly to `updateOrbitTarget()`. This centers the orbit camera on the system's best-estimate GPS position (coinciding with the visible red snapshot spheres) rather than tracking every odom pose.
- **6.2 (AR pose replay):** `onNewOdomPose` callback writes recorded `odomPosition`/`odomRotation` to the `arpose` Object3D (via `getArPose()`) each time a new GPS event is dispatched. Positions are converted from NUE to WebXR space via `nuePositionToWebXR()` before setting arpose.position, and rotations are converted from NUE to WebXR via `nueQuaternionToWebXR()` before setting arpose.quaternion, because `applyAlignmentMatrix()` composes the alignment with `WEBXR_TO_NUE`. This ensures `(alignment × W2N) × arpose_WebXR = alignment × odom_NUE` for both position and rotation. The `onNewOdomPose` callback no longer updates the orbit target — that responsibility moved to `onAlignmentSnapshot` (Issue #3).
- `initReplayScene()` is called once; `disposeReplayScene()` is called on dispose.
- The `mapOverlay` subscriber dep is a **proxy** that delegates to a late-bound real overlay via `setMapOverlay()`. This allows store subscribers to forward map updates to the overlay even though the overlay is created lazily by `handleReplayMapToggle`. The proxy forwards three overlay methods: `setGpsPosition` (recenter), `render` (the unified `MapData` trajectory snapshot), and `addCurrentMarker` (reference points). Each method uses optional chaining on the target so calls are silently dropped when no real overlay is bound.

## Examples

```typescript
import { startReplayMode } from './replay-mode.js';

const zipBytes = new Uint8Array(await file.arrayBuffer());
const controller = await startReplayMode(zipBytes, {
  container: document.getElementById('replay-container')!,
  onProgress: (current, total) => updateUI(`Action ${current}/${total}`),
  onComplete: () => showToast('Replay complete'),
  onError: (index, err) => showToast(`Action ${index} failed: ${err.message}`),
});

await controller.play(5); // 5x speed
controller.setSpeed(10); // change to 10x mid-replay
controller.pause();
await controller.resume();
controller.dispose();
```

## Tests

- Unit tests: [replay-mode.test.ts](replay-mode.test.ts) — 20 tests covering:
  - Data flow: zip → actions → store (R8)
  - Scene initialization with container
  - Store identity for subscribers (R6)
  - Controller API shape
  - Action count
  - Play dispatches to store
  - Progress and complete callbacks
  - Dispose lifecycle
  - Error handling wiring (R7)
  - Pause/resume
  - Speed changes
  - `setMapOverlay` proxy delegation, null clearing, and forwarding of `render` (MapData) and `addCurrentMarker`
