# ref-point-subscribers.ts

## Purpose

Recorder-app wiring between the `refPoints` slice and the framework's
`RefPointVisualizer`. Replaces the framework's `refPointVisualizer`
subscription branch that was removed in Iter 3 of the AppFramework /
RecorderApp boundary cleanup.

## Public API

- `wireRefPointSubscribers(store, visualizer): () => void`
  - `store: RecorderStore` — recorder store with `refPoints.priorMarks` and
    `refPoints.currentMarks`.
  - `visualizer: Pick<RefPointVisualizer, 'displayPriorRefPoints' | 'addCurrentRefPoint'> | null`
    — `null` is accepted (no-op) so headless / replay paths can opt out.
  - Returns an unsubscribe function that detaches the store listener.

## Invariants & assumptions

- Calls `displayPriorRefPoints` exactly once per change in the
  `priorMarks` reference (compares by reference, like the previous
  framework subscription).
- Calls `addCurrentRefPoint` exactly once per new tail entry of
  `currentMarks` (high-water mark tracking).
- When `currentMarks.length` shrinks (e.g. scenario reset), the high-water
  mark is reset so the next dispatched mark re-renders.

## Tests

- `ref-point-subscribers.test.ts` — covers all three invariants plus the
  null-visualizer no-op path.

## Related docs

- `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md`
- `recorder-store.ts.md`
- `ref-points-slice.ts.md`
