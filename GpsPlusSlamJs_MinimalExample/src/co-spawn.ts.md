# co-spawn.ts

## Purpose

The Step 4 contrast co-spawn. On a GPS-gated tap the example spawns two objects
at the **same initial global pose** under different parents, to make the
framework's drift-compensation value visible:

- the **root cube** under the GPS-aligned `scene` (the deliberate floater — see
  [placement.ts](placement.ts)), and
- an **anchor marker** under `arWorldGroup`, handed to `createGpsAnchor` so it
  holds its tapped pose during bootstrap and then snaps to the GPS median when
  off-screen.

This module is the pure geometry that places both objects so their **world**
positions coincide across their different parent frames. The live
`createGpsAnchor` wiring (store-bound alignment getters, GPS seed, default
bootstrap) lives in [main.ts](main.ts) because it needs the running store and is
verified on-device.

## Public API

- `ANCHOR_MODE: GpsAnchorMode = 'snap-when-offscreen'` — the required mode; keeps
  the teaching "jump" out of view (the anchor only corrects while off-screen).
- `coSpawnAtWorldPose({ scene, arWorldGroup, worldPosition }): { cube, anchorObject }`
  - cube → `placeRootCube(scene, worldPosition)` (GPS-aligned root);
  - anchorObject → under `arWorldGroup` at `arWorldGroup.worldToLocal(worldPosition)`
    (so both coincide in world space). `arWorldGroup`'s world matrix is refreshed
    first so the conversion uses the current transform.

## Invariants & assumptions

- Both objects must coincide in **world** space, not merely share a local
  position — `arWorldGroup` typically carries a non-trivial alignment transform,
  so a naive shared-local-position port would place them metres apart.
- The cube is parented to `scene`, the anchor object to `arWorldGroup`. Do not
  swap these — the whole demo depends on the contrast.
- `createGpsAnchor` must use the **default bootstrap** (no `skipBootstrap`): the
  marker holds its tapped pose while sampling GPS, then makes one lazy
  `snap-when-offscreen` correction. The bootstrap "no movement" and snap
  behaviours are owned and tested by the framework
  ([gps-anchor.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/gps-anchor.ts)),
  not re-tested here.

## Tests

[co-spawn.test.ts](co-spawn.test.ts) — pins world-pose coincidence under a
non-trivial `arWorldGroup` transform, the parenting (cube→scene,
anchor→arWorldGroup), and `ANCHOR_MODE === 'snap-when-offscreen'`.
