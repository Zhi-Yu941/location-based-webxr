# `ref-points-v2-slice.ts`

## Purpose

Flat Redux slice owning all reference-point entries in the recorder app.
Each `RefPointEntry` is either a live observation (a "Capture" tap) or an
imported known landmark (from the OPFS sidecar fast-path).

The slice is the recorder-side replacement for the library's
`gpsData.referencePoints` field + the legacy recorder `refPoints` slice.
It is registered alongside the legacy slice under a parallel root key
(`refPointsV2`) and is **pure addition** until sub-step 5.7 of the
[slice-collapse plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md)
collapses the two.

## Public API

| Symbol | Kind | Description |
| --- | --- | --- |
| `RefPointEntry` | type | One entry: `{ id, timestamp, name?, rawGpsPoint, gpsPoint? }`. |
| `RefPointsV2State` | type | `{ entries: RefPointEntry[] }`. |
| `refPointsV2Reducer` | reducer | Mounted at `state.refPointsV2`. |
| `addRefPointEntry(entry)` | action | Appends a single entry. |
| `setImportedRefPointEntries(entries)` | action | Replaces the array wholesale (sidecar startup fast-path). |
| `resetRefPoints()` | action | Restores empty initial state. |
| `selectRefPointEntries(state)` | selector | Memoised; returns a stable empty sentinel when no entries. |
| `selectKnownAnchorsByCell(state)` | selector | Memoised; groups by H3 cell `id`; first-non-null `name` per cell wins. |
| `countEntriesByCellInSession(state, start, end)` | helper | `Map<id, count>` filtered by inclusive timestamp range. |

## Invariants

- Multiple entries can share the same `id` (H3 cell). Grouping happens
  only in selectors, never in state.
- `rawGpsPoint` is always present. `gpsPoint` is optional — absent for
  imported entries and for legacy entries replayed from pre-Step-1
  recordings.
- Reducers never mutate entries in-place; they only push or replace the
  array. The structural cast in `addRefPointEntry` /
  `setImportedRefPointEntries` bypasses Immer's WritableNonArrayDraft
  refusal to widen the readonly tuples nested inside `GpsPoint` —
  identical pattern to `ref-points-slice.ts` `setPriorRefPointMarks`.

## Tests

- [ref-points-v2-slice.test.ts](ref-points-v2-slice.test.ts) — reducer
  cases (`addRefPointEntry`, `setImportedRefPointEntries`,
  `resetRefPoints`) and action-type namespace assertions.
- [ref-points-v2-selectors.test.ts](ref-points-v2-selectors.test.ts) —
  `selectRefPointEntries` (incl. stable empty sentinel),
  `selectKnownAnchorsByCell` (grouping, first-non-null name, lat/lon
  surface, memoisation), and `countEntriesByCellInSession` (inclusive
  range filtering).
