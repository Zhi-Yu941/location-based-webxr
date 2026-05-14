# AR Types

## Purpose

Shared type definitions for AR-related modules. These types are extracted to a separate file to avoid circular dependencies between `webxr-session.ts` and `depth-sampler.ts`.

## Public API

### `ArPoseTuples`

Tuple-form AR pose for storage/serialization. Uses the library's `Vector3` / `Quaternion` readonly tuples instead of object-form `{ x, y, z }`. Used in storage interfaces (`RefPointObservation`, `ParsedRefPointAction`, `RefPointRecord`) where poses are persisted as plain number arrays in JSON.

```typescript
import type { Vector3, Quaternion } from 'gps-plus-slam-js';

interface ArPoseTuples {
  position: Vector3; // readonly [number, number, number]
  rotation: Quaternion; // readonly [number, number, number, number]
}
```

**See** `ARPose` for the object-form variant used in live AR tracking.

### `ARPose`

Device pose in AR space with position and orientation in the local-floor reference space. Composes `WebXRVec3` and `WebXRQuaternion`.

```typescript
interface ARPose {
  position: WebXRVec3;
  orientation: WebXRQuaternion;
}
```

### `WebXRVec3`

3D position in object-form as returned by the WebXR API (`XRViewerPose`). Distinct from the library's tuple-form `Vector3`. Also used in `CapturedImage.position` and `createMockPose()`.

```typescript
interface WebXRVec3 {
  x: number;
  y: number;
  z: number;
}
```

### `WebXRQuaternion`

Quaternion orientation in object-form as returned by the WebXR API (`XRViewerPose`). Distinct from the library's tuple-form `Quaternion`. Also used in `CapturedImage.rotation`, `MockXRView.transform.orientation`, and `createMockPose()`.

```typescript
interface WebXRQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}
```

### `DepthPoint`

A single depth point sample from the WebXR Depth API. Used for 3D reconstruction and validating AR tracking accuracy.

```typescript
interface DepthPoint {
  screenX: number; // Normalized screen X coordinate (0-1)
  screenY: number; // Normalized screen Y coordinate (0-1)
  depthM: number; // Depth value in meters
}
```

This is the **canonical definition** — the single source of truth used throughout the codebase. Consumers include `webxr-session.ts`, `depth-sampler.ts`, `image-capture.ts`, `gps-event-coordinator.ts`, and `store.ts`. Some modules (e.g., `webxr-session.ts`) also re-export it.

### `DepthSample`

A complete depth sample with camera pose and a grid of depth points. Produced by the depth sampler at ~1 Hz, consumed by the store for persistence and replay. This is the single canonical type — `store.ts` re-exports it for dispatch convenience.

```typescript
import type { Vector3, Quaternion } from 'gps-plus-slam-js';

interface DepthSample {
  timestamp: number; // Milliseconds
  cameraPos: Vector3; // Camera position [x, y, z] (readonly tuple)
  cameraRot: Quaternion; // Camera rotation quaternion [x, y, z, w] (readonly tuple)
  points: DepthPoint[]; // Grid of depth points
}
```

## Invariants & Assumptions

- **All interfaces are readonly** — fields are marked `readonly` to prevent accidental mutation. These are pure data types created once and never modified. Type-level guards in `ar-types.test.ts` enforce this via `expectTypeOf<T>().toEqualTypeOf<Readonly<T>>()` and `@ts-expect-error` patterns.
- Position coordinates are in meters, using right-handed coordinate system
- Orientation is a unit quaternion (w, x, y, z)
- Depth values are in meters (hence `depthM` suffix)
- Screen coordinates are normalized (0-1 range, hence `screenX`/`screenY` naming)

## Tests

Type structure and single-source-of-truth invariant are validated by compile-time checks and runtime tests in `ar-types.test.ts`. The "Single-source-of-truth" describe block specifically verifies that `image-capture.ts`'s `ImageCaptureCallbacks.getCurrentPose` uses the canonical `ARPose` from this file.
