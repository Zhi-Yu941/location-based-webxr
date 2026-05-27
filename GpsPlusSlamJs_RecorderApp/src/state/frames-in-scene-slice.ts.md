# `frames-in-scene-slice.ts`

> **Status (2026-05-27):** Dead-writer mirror, scheduled for removal in
> Step 5 of the
> [collapse-refPoint-and-frame-slices plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md).
> Since Step 3 of that plan, the frame-tile visualizer subscribes to
> the framework selector `selectFrameTilesInWebXR(state)`, which reads
> `state.gpsData.odometryPath.points` directly. The slice and its
> `add-2d-image-listener.ts` middleware are still wired in
> `createRecorderStore` but no consumer reads `state.framesInScene`
> anymore.

## Purpose

Tiny Redux slice that holds the list of captured frames (`gpsData/add2dImage`
payloads) that should render as textured 3D tiles in the scene. Per F3
of
[2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md)
the visualizer never bypasses the store — both live and replay flow
through this slice via a listener middleware on `gpsData/add2dImage`.

## Public API

- `FrameInScene` — one entry: `{ imageFile, position, rotation,
screenRotation, capturedAt? }`. `position` / `rotation` are raw WebXR
  pose (caller converts to scene coordinates when materializing the
  mesh).
- `FramesInSceneState` — `{ frames: FrameInScene[] }`.
- `framesInSceneReducer` — default export of the slice reducer.
- `addFrameInScene(payload)` — append-only.
- `clearFramesInScene()` — empties the array.
- `resetFramesInSceneState()` — full state reset.

## Invariants & assumptions

- Append-only by design; the visualizer relies on monotonic growth to
  detect newly added frames via subscription.
- No filtering happens here. The size-threshold broken-frame filter
  applies in the **visualizer** (where the blob is fetched) so the
  slice stays a faithful mirror of every `add2dImage` action that
  passed the library reducer guard.
- `position` / `rotation` tuples are stored as-is (readonly cast via
  the same Immer pattern used by `addCurrentRefPointMark` in
  `ref-points-slice.ts`).

## Examples

```ts
import { framesInSceneReducer, addFrameInScene } from './frames-in-scene-slice';

const state0 = framesInSceneReducer(undefined, { type: '@@INIT' });
const state1 = framesInSceneReducer(
  state0,
  addFrameInScene({
    imageFile: 'frames/frame-000001.jpg',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    screenRotation: 0,
  })
);
// state1.frames.length === 1
```

## Tests

- `frames-in-scene-slice.test.ts` — reducer behaviour (initial state,
  append, clear, reset).
- `frames-in-scene-listener.test.ts` — wiring with the listener
  middleware (lives next door).
