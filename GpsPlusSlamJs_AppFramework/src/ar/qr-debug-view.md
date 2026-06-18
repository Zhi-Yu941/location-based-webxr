# `qr-debug-view.ts` — shared QR "is it glued?" overlay

## Purpose

The single, framework-owned 3D debug overlay for a solved QR pose: a 3D **axis**
at the pose plus a semi-transparent **cube** sized to the QR so its front face
lands on the printed corners. Both consumers — the **QR-tracking demo** and the
**GPS Recorder** (WS-5) — render this exact view off their derived pose, so the
two apps cannot drift apart in how a detected QR is visualized.

## Public API

- `createQrDebugView(parent: Object3D): QrDebugView` — attaches an internal
  `WEBXR_TO_NUE` basis node under `parent` (the `arWorldGroup`) and hangs the
  axis + cube off it. Objects start hidden.
- `QrDebugView`:
  - `update(pose: Pose, sizeM: number | null): void` — places + reveals the axis
    from the pose; reveals the cube only when `sizeM` is non-null (otherwise the
    cube stays hidden rather than drawing a NaN/garbage-scaled box).
  - `clear(): void` — hides both objects WITHOUT detaching them (no flicker
    between throttled detections).
  - `dispose(): void` — detaches the basis subtree from `parent` and frees the
    axis/geometry/material GPU resources.

## Invariants & assumptions

- **Coordinate frame (load-bearing):** the pose is in **raw WebXR** space but
  `parent` local space is **NUE**, so the objects MUST ride the same
  `WEBXR_TO_NUE` basis the camera does. They hang off an internal basis node
  carrying that matrix (`matrixAutoUpdate = false`); parenting directly under
  `parent` would leave them East/North axis-swapped and they would not line up on
  device (the recurring scene-frame bug — see frame-tile / occupancy-cube /
  hit-test-reticle precedents). The camera is never touched; WebXR owns its pose.
- **Persistence:** `update()` runs on every lock; a detection MISS must NOT call
  `clear()`, so the objects keep their last pose between throttled detections.
- The cube is a 1 cm-deep slab (`CUBE_DEPTH_M`) pushed back by half its depth so
  its `+z` face sits on the printed code; in-plane it spans `sizeM`.
- Pure three.js — it knows nothing about who solved the pose, so it runs
  identically live and on replay.

## Examples

```ts
import { createQrDebugView } from 'gps-plus-slam-app-framework/ar/qr-debug-view';

const view = createQrDebugView(arWorldGroup);
view.update({ position: [1, 2, -3], rotation: [0, 0, 0, 1] }, 0.2); // axis + 20 cm cube
view.update(pose, null); // axis only (size not yet measured)
view.clear(); // hide, keep attached (no flicker)
view.dispose(); // detach + free GPU resources
```

Import via the deep subpath (`…/ar/qr-debug-view`), NOT the `…/ar` barrel — the
barrel eagerly evaluates heavy transitive deps; this module needs only the
constant `WEBXR_TO_NUE` matrix (three-only). Both the Recorder and the demo
import it this way.

## Tests

`qr-debug-view.test.ts` (colocated) covers: hidden-on-create, the
`WEBXR_TO_NUE`-basis world placement (the scene-frame regression), reveal+glue at
size, axis-only when size is `null`, cube reveal once a size arrives, and
`clear()` (hide, stay attached) vs `dispose()` (detach). Runs against a real
`THREE.Group` — no WebGL needed for transforms.

## History

Promoted from the QR-tracking demo to the framework (recorder live-QR WS-5) as
the shared consumer view. The demo previously kept a byte-identical local copy
(`GpsPlusSlamJs_QrTrackingDemo/src/qr-debug-view.ts`) with its own duplicate
test; both were removed once the demo switched to this shared module, so the two
apps render the identical overlay and cannot diverge.

@see qr-derived-pose.ts — derives the `Pose` this view renders (size + PnP).
@see webxr-nue-basis.ts — the `WEBXR_TO_NUE` basis the objects ride.
