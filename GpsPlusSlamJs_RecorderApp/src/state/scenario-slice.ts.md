# scenario-slice.ts

## Purpose

Recorder-app Redux slice owning the currently-selected scenario name. Carved out of the framework's `recording-slice` in Iter 1D of the [AppFramework / RecorderApp boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) so the framework's recording lifecycle has nothing scenario-specific in it.

## Public API

- `scenarioReducer` â€” RTK reducer; mounted under the `scenario` key in `createRecorderStore`.
- `setCurrentScenarioName(name: string)` â€” action creator. Action type: `scenario/setCurrentScenarioName`.
- `resetCurrentScenarioName()` â€” action creator. Clears back to the empty-string default.
- `ScenarioState` â€” `{ currentScenarioName: string }`.

## Invariants & assumptions

- Empty string means "no scenario selected"; this is the initial state and the post-reset state.
- The slice does not persist itself to OPFS â€” it is read by the recorder when stamping `SessionMetadata.contextTag` at start-recording and stop-recording. The framework's persistence middleware stays scenario-agnostic.

## Examples

```ts
import { configureStore } from '@reduxjs/toolkit';
import { scenarioReducer, setCurrentScenarioName } from './scenario-slice';

const store = configureStore({ reducer: { scenario: scenarioReducer } });
store.dispatch(setCurrentScenarioName('Park Walk'));
store.getState().scenario.currentScenarioName; // â†’ 'Park Walk'
```

## Tests

- `scenario-slice.test.ts` â€” initial state, set / reset behaviour, action-type stability, persistence across `recorder/startSession`.
