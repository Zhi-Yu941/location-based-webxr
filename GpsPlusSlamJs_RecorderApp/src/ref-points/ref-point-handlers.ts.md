# ref-point-handlers.ts

## Purpose

Encapsulates all reference-point state and event handlers extracted from `main.ts` (Finding #7 decomposition, Step 2). Provides a factory function that creates a self-contained handler object with private state for imported ref-points, mark-in-progress guard, and per-session usage tracking.

## Public API

### `createRefPointHandlers(deps: RefPointHandlersDeps): RefPointHandlers`

Factory that creates ref-point handlers with injected dependencies.

**`RefPointHandlersDeps`:**

- `getStore()` — returns the current `RecorderStore` (may change between recordings).
- `getCurrentSessionName()` — returns the current recording session name.

**`RefPointHandlers`** returned object:

| Method                      | Signature                                 | Description                                                                               |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `handleMarkRefPoint`        | `() => Promise<void>`                     | Full mark-ref-point flow: validate → picker → build → persist → visualize.                |
| `checkNearbyRefPoint`       | `(lat, lng) => string \| undefined`       | Check if (lat,lng) is near a known imported ref point. Returns display name or undefined. |
| `getImportedRefPoints`      | `() => ImportedRefPoint[]`                | Returns the current imported ref-points array.                                            |
| `setImportedRefPoints`      | `(refPoints: ImportedRefPoint[]) => void` | Replaces the imported ref-points array.                                                   |
| `getSessionRefPointUsage`   | `() => Map<string, number>`               | Returns the per-session ref-point usage counter map.                                      |
| `clearSessionRefPointUsage` | `() => void`                              | Clears the usage map (called at recording start).                                         |
| `reset`                     | `() => void`                              | Clears all state (ref-points, guard flag, usage map).                                     |

## Invariants & Assumptions

- **Concurrent-call guard**: `handleMarkRefPoint` sets `markRefPointInProgress = true` and returns early on re-entry, preventing overlapping picker flows.
- **Re-observation cooldown**: After a re-observation mark, a per-H3-cell 10-second cooldown prevents duplicate markings of the same location. Stored in `lastReObservationTimestamp` (closure `Map<string, number>`). New ref points via the picker are unaffected. Reset on `reset()`.
- **Re-observation toast feedback** (Finding 3, `2026-04-29-ref-points-user-feedback.md`): the single-click re-observation branch is silent for the user (no picker is shown). After the OPFS persist resolves successfully and `nearbyMatch` is set, `handleMarkRefPoint` calls `showToast(`Re-observed "<name>"`, { severity: 'info' })`. The toast is **never** fired on the picker-driven new-ref-point path (the picker UI itself is the feedback), on cooldown rejections (silent by design), or when the OPFS write fails (the existing `showError` channel handles failure feedback).
- **`persistRefPointObservation` returns `boolean`**: `true` on successful save, `false` on caught error (after `showError` is invoked). The return value gates the re-observation toast so the toast reflects the durable end state.
- **Picker-visible guard**: Returns early if the ref-point picker is already visible.
- **Raw-storage pattern**: `dispatchRefPointAction` destructures a full `GpsPoint` to extract only `RawGpsPoint` fields, dispatching `{ rawGpsPoint }` instead of `{ gpsPoint }`. The library reducer computes derived fields when building state.
- **Alignment-matrix propagation** (step 2 of the [2026-05-27 slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md)): when the live `gpsData.gpsEvents.alignmentMatrix` is set at mark time, `dispatchRefPointAction` forwards it on the `markReferencePoint` payload so the library reducer can derive the at-mark-time fused-GPS snapshot itself. When no alignment matrix exists (early recording, legacy data) the field is **omitted** so the reducer falls back to the raw-projection path.
- The factory's `deps.getStore()` / `deps.getCurrentSessionName()` are called lazily (at handler invocation time), so they always reflect the latest app state.
- All other dependencies (AR, file-system, picker, HUD, store actions) are direct imports — same modules they were in `main.ts`. Visualization is **not** called directly from this module any more: `visualizeRefPoint` dispatches `addCurrentRefPointMark` into the slice, and the visualizer subscribes via `wireStoreSubscribers` (Finding 5, [docs/2026-04-30-refpoint-marks-into-redux-plan.md](../../../GpsPlusSlamJs_Docs/docs/2026-04-30-refpoint-marks-into-redux-plan.md)).
- `reset()` does **not** interact with the store — the caller manages store lifecycle.
- Observation persistence uses `saveRefPointObservation` with the current scenario handle and session name.
- When the alignment matrix is available at mark time, `buildRefPointObservation` computes `fusedGpsPoint` via `fusedGpsFromOdom(alignmentMatrix, odomPosition, zeroRef)` (helper in `utils/fused-path.ts`). The `altitude` from the aligned VIO pipeline is included when the GPS origin carries altitude; otherwise it is `undefined`. The field is omitted entirely when no alignment matrix exists (early recording, legacy data).
- `visualizeRefPoint` mirrors the loader's per-field fallback (Option B, see `2026-04-29-ref-points-user-feedback.md` Finding 1): fused lat/lon are preferred, but each field independently falls back to the raw `lastGpsPoint` when missing. This keeps the in-session red sphere co-located with the future-session green sphere even for recordings that pre-date the calcGpsCoords altitude fix.
- `visualizeRefPoint` also prefers `fusedGpsPoint` over raw `gpsPoint` when present, so the current-session red sphere sits at the same position where the next session's green sphere will appear (loader-side behavior in `ref-point-loader.ts#flattenRefPointsToMarks`). See `GpsPlusSlamJs_Docs/docs/2026-04-24-refpoint-positioning-investigation.md` §7.

## Examples

```typescript
import { createRefPointHandlers } from './ref-points/ref-point-handlers';

const refPointHandlers = createRefPointHandlers({
  getStore: () => store,
  getCurrentSessionName: () => currentSessionName,
});

// Wire into UI
initUI({ onMarkRefPoint: () => refPointHandlers.handleMarkRefPoint() });

// On new recording
refPointHandlers.clearSessionRefPointUsage();

// On folder open with ref-points
refPointHandlers.setImportedRefPoints(importResult.refPoints);

// On app reset
refPointHandlers.reset();
```

## Tests

- **`ref-point-handlers.test.ts`** — 54 unit tests covering factory creation, state management, validation guards, picker integration, observation building (including fusedGpsPoint computation with altitude propagation), persistence, visualization (including current-session fused-preference), concurrent-call prevention, H3-based IDs, proximity detection, re-observation cooldown (10s per H3 cell), and full end-to-end flow.
- Key mock pattern: all external deps are mocked via `vi.hoisted()` + `vi.mock()`. Mock return values must be explicitly reset in every `beforeEach` because `vi.clearAllMocks()` does not reset `mockReturnValue` / `mockResolvedValue`.
