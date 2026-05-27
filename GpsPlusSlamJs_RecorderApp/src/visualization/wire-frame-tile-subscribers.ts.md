# wire-frame-tile-subscribers.ts

F3.4 of the [tracking-quality regression & replay-gaps feedback](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

Connects frame-tile data to the `FrameTileVisualizer` (F3.3).

## Data source

As of Step 3 of the [2026-05-27 collapse-refPoint-and-frame-slices plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md)
the wirer reads from the framework selector
`selectFrameTilesInWebXR(state)` instead of the recorder-local
`state.framesInScene.frames` mirror. The selector pulls
`state.gpsData.odometryPath.points` (the library's NUE-stored frames)
and converts them back to WebXR coordinates. The legacy
`framesInScene` slice and its listener are kept temporarily as a
dead-writer mirror; both are removed in Step 5 of the same plan.

## Responsibilities

- Subscribe to the active store in `StoreRef<RecorderStore>` and run
  `selectFrameTilesInWebXR` on every dispatch. The selector is
  reselect-memoised over `state.gpsData`, so the subscribe handler is
  cheap when no frame was added.
- Diff the returned `readonly ArImageCapture[]` (aliased as
  `FrameTile` for callers) tail and process each newly observed entry.
- For each new `FrameTile`:
  1. fetch the JPEG blob via the injected `blobSource(imageFile)`,
  2. apply `minFrameBytes` (default `DEFAULT_MIN_FRAME_BYTES = 2000`)
     to reject broken / empty frames,
  3. decode via the injected `decodeTexture(blob)` (caller wires
     `createImageBitmap` in production),
  4. call `visualizer.addTile(frame, texture)`.
- De-duplicate by `imageFile` within a single store lifetime via an
  internal `Set<string>`.
- React to store swaps (F1 pattern): clear the visualizer, reset the
  processed-set by re-attaching to the new store.

## Why dependency injection of `blobSource` and `decodeTexture`

The wirer is jsdom-testable and identical in shape between live mode
(blob from OPFS cache populated by `handleImageCaptured`) and replay
mode (blob from the `@zip.js/zip.js` reader). Both flows differ only
in the `blobSource` they pass in. `decodeTexture` is injected so unit
tests can use a `THREE.Texture` stub instead of the real
`createImageBitmap`, which jsdom doesn't implement.

## Out of scope

- The actual `createImageBitmap`-based decoder lives in the F3.5
  wiring (`main.ts` / `replay-mode.ts`).
- Threshold calibration against the corpus is part of F3.6.
