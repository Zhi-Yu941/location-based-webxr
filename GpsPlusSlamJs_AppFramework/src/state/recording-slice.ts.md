# recording-slice.ts

## Purpose

Redux Toolkit slice for recorder session management. Extracted from inline code in `store.ts` (Â§4 â€” `configureStore` migration) to break circular dependencies with `persistence-middleware.ts` and follow the same pattern as `ref-points-slice.ts` and `routing-slice.ts`.

## Public API

| Export               | Kind           | Description                                                                           |
| -------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `RecordingState`      | Type           | Shape of the `recorder` state slice                                                   |
| `SessionMetadata`    | Type           | Session metadata: scenario name, session name, start time, etc.                       |
| `recordingReducer`    | Reducer        | RTK slice reducer for `recorder/*` actions                                            |
| `startSession`       | Action creator | `recorder/startSession` â€” sets `isRecording = true`, stores metadata, resets counters |
| `endSession`         | Action creator | `recorder/endSession` â€” sets `isRecording = false`                                    |
| `recordDepthSample`  | Action creator | `recorder/recordDepthSample` â€” no state mutation; persisted for replay                |
| `recordWriteFailure` | Action creator | `recorder/recordWriteFailure` â€” increments `failedWriteCount`                         |

## Invariants & Assumptions

- `startSession` resets `actionCount` and `failedWriteCount` to 0 â€” each session starts clean.
- `recordDepthSample` intentionally has no state mutation; the action payload is persisted by `persistence-middleware.ts` for replay.
- `recordWriteFailure` is the only action tracking persistence errors. It is **excluded** from persistence by the middleware to prevent recursion.
- This slice is scenario-agnostic. The currently-selected scenario name lives in the recorder app's [`scenario-slice`](../../../GpsPlusSlamJs_RecorderApp/src/state/scenario-slice.ts.md) and is read by the recorder when stamping `SessionMetadata` (Iter 1D of the [boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md))..

## Examples

```typescript
import {
  recordingReducer,
  startSession,
  endSession,
  recordWriteFailure,
} from './recording-slice';

// In configureStore:
const store = configureStore({
  reducer: { recorder: recordingReducer /* ... */ },
});

// Start a session
store.dispatch(
  startSession({
    scenarioName: 'Park',
    sessionName: 'run-1',
    startTime: Date.now(),
  })
);

// Track a write failure
store.dispatch(recordWriteFailure('OPFS write failed'));
console.log(store.getState().recorder.failedWriteCount); // 1
```

## Tests

- `store.test.ts` â€” covers all recorder actions as part of the integrated store (state transitions, startSession/endSession, failedWriteCount tracking).
- `persistence-middleware.test.ts` â€” 13 tests verify that `recordWriteFailure` is excluded from persistence and dispatched on errors.

## Related

- [store.ts](store.ts.md) â€” factory that combines this slice with 5 others
- [persistence-middleware.ts](persistence-middleware.ts.md) â€” middleware consuming `recordWriteFailure`
- [ref-points-slice.ts](ref-points-slice.ts.md) â€” sibling slice following the same pattern
- [routing-slice.ts](routing-slice.ts.md) â€” sibling slice following the same pattern
