# ref-points-slice.ts

## Purpose

Redux slice managing reference point state that was previously stored as closure variables in `ref-point-handlers.ts`. Moving this into Redux enables store subscribers, DevTools inspection, and clean dependency boundaries for library extraction.

## Public API

### State Shape (`RefPointsState`)

| Field                  | Type                     | Description                                                                                                                                                   |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `importedRefPoints`    | `ImportedRefPoint[]`     | Prior ref points loaded from previous session ZIPs                                                                                                            |
| `sessionRefPointUsage` | `Record<string, number>` | Times each ref point was marked (keyed by H3 index)                                                                                                           |
| `priorMarks?`          | `RefPointMark[]`         | Per-observation marks loaded from prior sessions; drives green-sphere rendering via store subscription. Optional in the type; the reducer always sets it.     |
| `currentMarks?`        | `RefPointMark[]`         | Per-observation marks added during the current session; drives red-sphere rendering via store subscription. Optional in the type; the reducer always sets it. |

### Actions

| Action                      | Payload              | Description                                                                                               |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `setImportedRefPoints`      | `ImportedRefPoint[]` | Replace the full set of imported ref points                                                               |
| `incrementRefPointUsage`    | `string`             | Increment usage count for a ref point by H3 ID                                                            |
| `clearSessionRefPointUsage` | -                    | Reset session usage counts to `{}`                                                                        |
| `setPriorRefPointMarks`     | `RefPointMark[]`     | Replace the full set of prior-session marks; subscribers re-render. (Finding 5, 2026-04-30)               |
| `addCurrentRefPointMark`    | `RefPointMark`       | Append a single mark observed in the current session; subscribers add one sphere. (Finding 5, 2026-04-30) |
| `clearCurrentRefPointMarks` | -                    | Empty the current-session mark list (e.g., on scenario reset). Subscribers reset their high-water mark.   |
| `resetRefPointsState`       | -                    | Reset all ref-point state to initial values                                                               |

### Selectors

| Selector                     | Input            | Output            | Description                                     |
| ---------------------------- | ---------------- | ----------------- | ----------------------------------------------- |
| `selectCachedKnownRefPoints` | `RefPointsState` | `KnownRefPoint[]` | Memoized derivation of H3-indexed known ref pts |

### Exports

| Export             | Type      | Description       |
| ------------------ | --------- | ----------------- |
| `refPointsReducer` | `Reducer` | The slice reducer |

## Invariants & Assumptions

- `sessionRefPointUsage` uses `Record<string, number>` (not `Map`) for Redux serializability
- `selectCachedKnownRefPoints` is memoized by reference equality of `importedRefPoints`
- H3 resolution 11 is used for GPS-to-H3 conversion (~25m edge length)
- The slice is integrated into the combined store via `refPoints/` action prefix routing
- `priorMarks` / `currentMarks` are typed as optional purely to remain backward-compatible with older inline `RefPointsState` literals in tests; the reducer always initialises both arrays. Production code can treat them as defined.
- `RefPointMark` carries readonly tuple types (`Vector3`, `Quaternion`) that Immer's `WritableNonArrayDraft` declines to widen, so the mark-setting reducers use a structural cast (`state as { priorMarks?: RefPointMark[] }`). Marks are never mutated in place — arrays are replaced or appended — so the cast is sound.
- See [docs/2026-04-30-refpoint-marks-into-redux-plan.md](../../../GpsPlusSlamJs_Docs/docs/2026-04-30-refpoint-marks-into-redux-plan.md) for the Finding 5 plan.

## Examples

```typescript
import {
  setImportedRefPoints,
  selectCachedKnownRefPoints,
} from './ref-points-slice';

// Dispatch
store.dispatch(
  setImportedRefPoints([
    { id: 'bench', lat: 49.0, lon: 8.0, sourceZipName: 'session1.zip' },
  ])
);

// Select
const known = selectCachedKnownRefPoints(store.getState().refPoints);
```

## Tests

- `ref-points-slice.test.ts` — 13 tests covering initial state, all actions, selector computation and memoization, and `displayName` fallback from `name` to `id`
