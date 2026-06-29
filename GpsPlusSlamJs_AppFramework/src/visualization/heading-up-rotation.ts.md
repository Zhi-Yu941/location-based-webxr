# heading-up-rotation.ts

## Purpose

Compute the three.js `CSS3DObject` quaternion that rotates the flat live minimap
so a given user heading points "up/forward" (heading-up mode), instead of the
fixed north-up baseline. See the
[heading-up plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-29-heading-up-minimap-rotation-plan.md).

## Public API

- `headingUpQuat(headingDeg: number): [x, y, z, w]`
  - Input: absolute view bearing in degrees clockwise from geographic north
    (the same `userHeadingDeg` produced by `computeUserHeadingDeg` /
    `buildMapData`). Any range is accepted (`deg` and `deg + 360` are equivalent).
  - Output: a unit quaternion `yaw(−headingDeg about +Y) · tilt(−π/2 about +X)`.
  - `headingDeg = 0` returns the baseline tilt-only orientation (north-up).
  - No error modes — pure numeric function, no allocation per call beyond the
    returned tuple (uses module-scoped scratch quaternions).

## Invariants & assumptions

- The minimap's baseline orientation is exactly `rotation.x = −π/2`
  (`leaflet-map-overlay.ts`), so the DOM-plane normal (local +Z) maps to world
  +Y. `headingUpQuat` preserves this: the yaw is about +Y, so the normal is
  invariant — the map stays flat and only spins in-plane.
- The map's parent (`CameraFollower`) is rotation-identity, so object-local axes
  equal world axes; the yaw is therefore about true world up.
- **Sign caveat:** axis + magnitude are test-pinned, but the _perceived_ turn
  direction on a north-up basemap is a device spot-check. `YAW_SIGN` is the
  single knob to flip if the device check shows the map turns the wrong way.

## Examples

```ts
import { headingUpQuat } from './heading-up-rotation';
cssObject.quaternion.set(...headingUpQuat(userHeadingDeg ?? 0));
```

## Tests

- `heading-up-rotation.test.ts`: baseline tilt at heading 0; unit-quaternion;
  plane normal stays +Y for all headings (in-plane spin only); north edge maps
  −Z at 0° and +X at 90°; properties (north edge stays horizontal + unit;
  `deg` ≡ `deg + 360`).
