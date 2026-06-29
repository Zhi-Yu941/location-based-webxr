# heading-up-rotation.ts

## Purpose

Compute the three.js `CSS3DObject` quaternion that rotates the flat live minimap
so a given user heading points "up/forward" (heading-up mode), instead of the
fixed north-up baseline. See the
[heading-up plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-heading-up-minimap-rotation-plan.md).

## Public API

- `headingUpQuat(azimuthDeg: number): [x, y, z, w]`
  - Input: the in-plane yaw to apply, in degrees, in the atan2(x,−z) azimuth
    convention (0° = the map's north edge points along world −Z; +90° = +X).
    **The consumer passes `viewAzimuth − userHeading`, NOT the absolute heading**
    (see the camera-relative note below). Any range is accepted (`deg` ≡ `deg+360`).
  - Output: a unit quaternion `yaw(−azimuthDeg about +Y) · tilt(−π/2 about +X)`.
  - `azimuthDeg = 0` returns the baseline tilt-only orientation (north-up).
  - No error modes — pure numeric function, no allocation per call beyond the
    returned tuple (uses module-scoped scratch quaternions).
- `viewAzimuthDeg(matrixWorldElements: ArrayLike<number>): number`
  - Input: a camera's `matrixWorld.elements` (column-major).
  - Output: the camera's horizontal viewing azimuth in `[0, 360)`, same
    convention as `headingUpQuat`'s input (0° = looking along −Z, +90° = +X).
    Reconstructs world-forward = −(3rd column); pitch is ignored.

## Invariants & assumptions

- The minimap's baseline orientation is exactly `rotation.x = −π/2`
  (`leaflet-map-overlay.ts`), so the DOM-plane normal (local +Z) maps to world
  +Y. `headingUpQuat` preserves this: the yaw is about +Y, so the normal is
  invariant — the map stays flat and only spins in-plane.
- The map's parent (`CameraFollower`) is rotation-identity, so object-local axes
  equal world axes; the yaw is about true world up.
- **Camera-relative (the 2026-06-29 fix):** the minimap is world-locked but is
  composited through the **live head-tracked camera** (`css3dManager.render(scene,
camera)`), so the camera already rotates the map's on-screen appearance as the
  user turns. The local yaw must therefore be `viewAzimuth − userHeading`, not the
  absolute heading. Using the absolute heading double-counts the camera and leaks
  the GPS↔scene **alignment-yaw** offset in (the camera lives in the raw AR frame;
  the alignment is applied to `arWorldGroup`, not the camera) — the symptom was
  "only points forward at one heading (~the alignment yaw), wrong elsewhere".
  Subtracting the live camera azimuth cancels the camera's contribution exactly
  (no lag) and removes the offset.
- **Sign:** axis + magnitude are test-pinned; the _perceived_ turn direction was
  **device-verified correct with `YAW_SIGN = -1`** (2026-06-29). `YAW_SIGN`
  remains the single knob to flip if a future frame/convention change inverts it.

## Examples

```ts
import { headingUpQuat, viewAzimuthDeg } from './heading-up-rotation';
camera.updateMatrixWorld();
const viewAz = viewAzimuthDeg(camera.matrixWorld.elements);
// Heading undefined (null) → HOLD the last orientation: do NOT update the
// quaternion. (Using `userHeadingDeg ?? viewAz` would compute `viewAz - viewAz
// = 0` and wrongly snap the map back to north-up — that violates the live
// overlay's `updatePosition` contract, which returns early when the heading is
// null.)
if (userHeadingDeg !== null) {
  cssObject.quaternion.set(...headingUpQuat(viewAz - userHeadingDeg));
}
```

## Tests

- `heading-up-rotation.test.ts`:
  - `headingUpQuat`: baseline tilt at 0; unit-quaternion; plane normal stays +Y
    for all inputs (in-plane spin only); north edge maps −Z at 0° / +X at 90°;
    properties (north edge horizontal + unit; `deg` ≡ `deg+360`).
  - `viewAzimuthDeg`: cardinal cameras (−Z→0, +X→90, +Z→180, −X→270); pitch
    ignored; range `[0,360)`.
