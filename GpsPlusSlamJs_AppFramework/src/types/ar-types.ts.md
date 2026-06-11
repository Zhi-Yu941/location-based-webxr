# AR Types

## Purpose

Shared type definitions for AR-related modules, extracted to avoid circular dependencies between `webxr-session.ts` and `depth-sampler.ts`. Pure types — no runtime code.

## Public API

- **`ArPoseTuples`** — `{ position: Vector3, rotation: Quaternion }` tuple-form pose for storage/serialization (library tuple types from `gps-plus-slam-js`).
- **`WebXRVec3` / `WebXRQuaternion`** — object-form `{x,y,z}` / `{x,y,z,w}` as returned by the WebXR API (`XRViewerPose`), distinct from the library's readonly tuples.
- **`ARPose`** — `{ position: WebXRVec3, orientation: WebXRQuaternion }`, the raw local-floor device pose (NOT alignment-transformed).
- **`DepthPoint`** — `{ screenX, screenY, depthM }`, one normalized-view depth read.
- **`DepthSample`** — `{ timestamp, cameraPos, cameraRot, points, projectionMatrix? }`, the persisted payload of `recording/recordDepthSample`.

## Invariants & Assumptions

1. **`DepthSample.cameraPos`/`cameraRot` are raw WebXR** (local-floor; X=East, Y=Up, Z=South) — no NUE conversion anywhere in the depth pipeline. Consumers needing NUE must convert.
2. **`DepthSample.timestamp` is epoch ms** (`performance.timeOrigin + xrFrameTime`), matching all other persisted action timestamps.
3. **`projectionMatrix` is optional and additive** — column-major 16-tuple (`Matrix4` from `gps-plus-slam-js`, not THREE's class) of the capturing `XRView`. Recordings made before 2026-06 lack it; consumers must skip unprojection for those samples.
4. All `DepthSample` fields are plain JSON-serializable data (Redux persistence + replay).

## Examples

```ts
import type { DepthSample } from '../types/ar-types';
const sample: DepthSample = {
  timestamp: Date.now(),
  cameraPos: [0, 1.6, 0],
  cameraRot: [0, 0, 0, 1],
  points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
};
```

## Tests

No own test file (pure types). Behavior covered by `depth-sampler.test.ts` (sample shape, projectionMatrix copy/absence) and the RecorderApp `action-schema.test.ts` (persisted JSON shape).
