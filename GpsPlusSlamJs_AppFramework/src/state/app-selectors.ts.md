# app-selectors.ts

## Purpose

App-level memoized selectors wrapping library getter functions with `createSelector` from Redux Toolkit. Establishes a consistent `select*` naming convention and provides the foundation for change-gated subscriptions via `subscribeToSelector`.

## Public API

| Symbol                       | Signature                                               | Returns                                       |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `selectAlignmentMatrix`      | `(state: CombinedRootState) => Matrix4 \| null`         | 4×4 alignment matrix, or null                 |
| `selectGpsPositions`         | `(state: CombinedRootState) => readonly GpsPoint[]`     | Recorded GPS positions with metadata          |
| `selectOdometryPositions`    | `(state: CombinedRootState) => readonly Vector3[]`      | Odometry positions (AR-local space)           |
| `selectOdometryRotations`    | `(state: CombinedRootState) => readonly Quaternion[]`   | Odometry rotations (AR-local space)           |
| `selectZeroReference`        | `(state: CombinedRootState) => LatLong \| null`         | GPS origin for coordinate conversion          |

All selectors use `state.gpsData` as the input dependency for `createSelector` memoization. If `gpsData` reference hasn't changed between calls, the cached result is returned without re-evaluating.

## Invariants & Assumptions

- Selectors return module-level empty array constants when `gpsData` is null, ensuring stable references for `subscribeToSelector` change detection.
- All selectors replicate the same property access as the library's getter functions (`getAlignmentMatrix`, `getGpsPositions`, etc.) but with `CombinedRootState` typing and `createSelector` memoization.
- The `gpsData` property path is part of the library's public `GpsSlamState` interface.

## Examples

```typescript
import { selectAlignmentMatrix, selectGpsPositions } from './app-selectors';

const matrix = selectAlignmentMatrix(store.getState()); // Matrix4 | null
const positions = selectGpsPositions(store.getState()); // readonly GpsPoint[]
```

## Tests

Covered by `app-selectors.test.ts` (13 test cases):

- Null state handling: returns null or empty array for each selector
- Populated state: returns correct values by reference
- Memoization: same reference for same state, stable empty arrays across calls

## Related Files

- [subscribe-to-selector.ts](subscribe-to-selector.ts) — uses these selectors for change detection
- [store-subscribers.ts](store-subscribers.ts) — primary consumer
- [store.ts](store.ts) — `CombinedRootState` type definition
- [ref-points-slice.ts](ref-points-slice.ts) — `selectCachedKnownRefPoints` follows the same pattern
