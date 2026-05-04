# store-subscribers.ts

## Purpose

Reusable store subscriber wiring extracted from `main.ts` (Iteration 4, Risk R2 fix). Connects Redux-like store state changes to visualization dependencies: alignment matrix application, GPS event markers, and 2D map overlay. Both the live recording path and the desktop replay path call `wireStoreSubscribers()` with the same interface.

Uses `subscribeToSelector` for selective change detection — each state slice (alignment matrix, GPS positions, reference points) has its own subscription that only fires when that specific value changes by reference equality. This replaces the manual `lastX` tracking variables from the original design.

## Public API

| Symbol                 | Signature                                                                                                                                                            | Description                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `wireStoreSubscribers` | `(store: SubscribableStore, deps: StoreSubscriberDeps) => () => void`                                                                                                | Subscribe to store changes and drive visualizers. Returns unsubscribe.   |
| `SubscribableStore`    | `{ getState, subscribe }` interface                                                                                                                                  | Minimal store contract — satisfied by `RecorderStore` and replay stores. |
| `StoreSubscriberDeps`  | `{ applyAlignmentMatrix, gpsEventVisualizer, mapOverlay?, refPointVisualizer?, onNewGpsPosition?, onNewOdomPose?, onAlignmentSnapshot?, onNewGpsLatLng? }` interface | Injected dependencies for visualization updates.                         |

### `mapOverlay` dependency (optional)

| Method                  | Signature                  | Wiring                                                                               |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `setGpsPosition`        | `(lat, lon) => void`       | Called when GPS positions change, with the latest GPS position.                      |
| `addRawGpsPoint?`       | `(lat, lon) => void`       | Called per new GPS event with raw lat/lon (yellow breadcrumb polyline).              |
| `addFusedPoint?`        | `(lat, lon) => void`       | Called per new GPS event with fused lat/lon (alignment × odom → GPS, cyan polyline). |
| `addAlignmentSnapshot?` | `(lat, lon) => void`       | Called when alignment matrix changes — snapshot NUE position converted to lat/lon.   |
| `addRefPoint?`          | `(lat, lon, name) => void` | Called when new reference points appear in state (incremental, name = ref point id). |

### `wireStoreSubscribers(store, deps)`

On each state change the subscriber:

1. **Alignment matrix** — uses `selectAlignmentMatrix` selector (via `subscribeToSelector`) to detect when alignment changes. Calls `deps.applyAlignmentMatrix(matrix)` only when the matrix reference changes. This sets `arWorldGroup.matrix`, and fused markers (children of `arWorldGroup`) update their world positions automatically via scene-graph propagation.
2. **Alignment snapshots** — triggered by the same alignment matrix subscription. When the matrix changes and odometry positions exist, computes $A_k \cdot p_k$ (alignment × latest odom) using `gl-matrix` and calls `deps.gpsEventVisualizer.addAlignmentSnapshot(transformedPos)`. Also calls `deps.onAlignmentSnapshot?.(transformedPos)` so replay mode can update the orbit camera target (Issue #3). This creates a red sphere capturing the system's instantaneous GPS belief.
3. **GPS event markers** — incrementally adds markers for new GPS events (since the last notification). Sets the zero reference on the visualizer when first available.
4. **Orbit target** — if `deps.onNewGpsPosition` is provided, calls it with the GPS world-space coordinates of each new event. Used in replay mode to auto-follow `OrbitControls` (Risk R9).
5. **AR pose update** — if `deps.onNewOdomPose` is provided, calls it with `(odomPosition, odomRotation)` for each new event that has both position and rotation data. Used in replay mode to update the `arpose` Object3D so the camera follows the recorded trajectory.
6. **Map overlay** — updates `deps.mapOverlay.setGpsPosition(lat, lon)` with the latest GPS position. For each new GPS event with an alignment matrix and zero reference, computes the fused GPS position via `fusedGpsFromOdom(alignmentMatrix, odomPos, zeroRef)` and calls `addFusedPoint`. When alignment matrix changes, calls `addAlignmentSnapshot` with the snapshot's GPS coordinates. Incrementally forwards new reference points via `addRefPoint(lat, lon, id)`. All optional methods are safely skipped if not provided. Skipped entirely if `mapOverlay` is `null`/`undefined`.
7. **GPS lat/lng callback** — if `deps.onNewGpsLatLng` is provided, calls it with `(lat, lng)` for each new GPS event. Used in live recording to drive ref-point proximity detection for the dynamic button label.
8. **Reference-point visualization (Finding 5, 2026-04-30)** — if `deps.refPointVisualizer` is provided, two additional subscriptions are wired:
   - `selectPriorRefPointMarks` → `displayPriorRefPoints(priorMarks)`. Fires whenever `priorMarks` changes by reference, replacing the green-sphere set wholesale.
   - `selectCurrentRefPointMarks` → `addCurrentRefPoint(mark)`. Append-only with a high-water-mark counter (`lastCurrentMarksLen`). When the array shrinks (e.g., `clearCurrentRefPointMarks` on scenario reset), the counter is reset to 0 so subsequent re-adds render again.
     Call sites no longer call `refPointVisualizer.displayPriorRefPoints` / `addCurrentRefPoint` directly — they dispatch `setPriorRefPointMarks` / `addCurrentRefPointMark` instead. See [docs/2026-04-30-refpoint-marks-into-redux-plan.md](../../../GpsPlusSlamJs_Docs/docs/2026-04-30-refpoint-marks-into-redux-plan.md).

Each call creates **fresh selector subscriptions** scoped to that call — no manual reset needed between sessions.

Returns an unsubscribe function that removes all listeners from the store.

## Invariants & Assumptions

- `gpsPositions` and `odometryPositions` arrays grow monotonically (append-only).
- A GPS event at index `i` is only visualized once (tracked by the per-subscription counter).
- `mapOverlay` may be `null` in replay mode or before AR session starts — handled gracefully.
- `onNewGpsPosition` is optional — not provided in live recording mode (camera is XR-controlled). In replay mode, the caller passes a callback that drives `updateOrbitTarget()` from `replay-scene.ts`.
- `onNewOdomPose` is optional — not provided in live recording mode (arpose stays at identity). In replay mode, the caller passes a callback that writes recorded odom position/rotation to the `arpose` Object3D. Skipped defensively if `odometryRotations[i]` is missing.
- `onAlignmentSnapshot` is optional — not provided in live recording mode. In replay mode, the caller passes a callback that routes the snapshot NUE position to `updateOrbitTarget()` in `replay-scene.ts`, centering the orbit camera on alignment-snapshot points (Issue #3).
- The `applyAlignmentMatrix` function and `gpsEventVisualizer`/`mapOverlay` methods are called synchronously during the store notification. No async operations.
- The `LatLong` type is `{ lat: number; lon: number }` from `gps-plus-slam-js`.

## Examples

### Live recording (in main.ts)

```typescript
import { wireStoreSubscribers } from './state/store-subscribers';

// After creating store and initializing storage:
unsubscribeStore = wireStoreSubscribers(store, {
  applyAlignmentMatrix,
  gpsEventVisualizer,
  mapOverlay,
});

// On cleanup:
unsubscribeStore();
```

### Replay mode (future — Iteration 6)

```typescript
import { wireStoreSubscribers } from './state/store-subscribers';

const replayStore = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});
const unsub = wireStoreSubscribers(replayStore, {
  applyAlignmentMatrix,
  gpsEventVisualizer,
  mapOverlay: null, // no map during replay (or provide one)
  onNewGpsPosition: (coords) => updateOrbitTarget(new THREE.Vector3(...coords)),
});

// Replay engine dispatches actions → subscribers react → markers appear
replayEngine.play(actions, replayStore);

// On cleanup:
unsub();
```

## Tests

Covered by `store-subscribers.test.ts` (43 test cases):

- Subscription lifecycle: subscribe, unsubscribe, no callbacks after unsubscribe
- Alignment matrix: applied when present, updates fused markers, skipped when gpsData null
- GPS event visualization: sets zero ref, incremental marker addition, skips incomplete data
- Orbit target auto-follow: calls onNewGpsPosition with coordinates, last event with multiple, safe when callback absent (Risk R9)
- Map overlay: updates with latest position, handles null gracefully, skips empty positions
- Map overlay raw GPS: calls addRawGpsPoint per event, safe when method absent
- Map overlay fused path (Phase 1b): calls addFusedPoint with alignment-corrected GPS coords, skips when alignment or zeroRef missing, safe when method absent
- Map overlay alignment snapshots (Phase 1b): calls addAlignmentSnapshot with GPS coords on matrix change, skips when zeroRef missing, safe when method absent
- Map overlay reference points (Phase 1b): calls addRefPoint incrementally for new ref points, safe when method absent
- Fresh counter: each `wireStoreSubscribers()` call starts from 0

## Related Files

- [store.ts](store.ts) — `CombinedRootState`, `RecorderStore` interface
- [subscribe-to-selector.ts](subscribe-to-selector.ts) — `subscribeToSelector` utility, `SubscribableStore` interface
- [app-selectors.ts](app-selectors.ts) — memoized selectors for alignment matrix, GPS positions, etc.
- [../ar/webxr-session.ts](../ar/webxr-session.ts) — `applyAlignmentMatrix`
- [../visualization/gps-event-markers.ts](../visualization/gps-event-markers.ts) — `GpsEventVisualizer`
- [../visualization/map-overlay.ts](../visualization/map-overlay.ts) — `MapOverlay`
- [../main.ts](../main.ts) — consumer (live recording path)
- [2026-02-19-replay-mode.md](../../../GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md) — Risk R2 definition
