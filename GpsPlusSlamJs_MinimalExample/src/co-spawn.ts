/**
 * Co-spawn helper for the Step 4 contrast demo.
 *
 * On a (GPS-gated) tap the example spawns two objects at the **same initial
 * global pose** but under different parents, to make the framework's
 * drift-compensation value proposition visible:
 *
 * - the **root cube** under the GPS-aligned `scene` (the deliberate floater —
 *   see placement.ts), and
 * - an **anchor marker** under `arWorldGroup`, handed to `createGpsAnchor` so it
 *   holds its tapped pose during bootstrap, then snaps to the GPS median when
 *   off-screen.
 *
 * This module is the pure geometry: it places both objects so their **world**
 * positions coincide across their different parent frames (the cube via a world
 * position under `scene`; the marker via the AR-local equivalent under
 * `arWorldGroup`). The live `createGpsAnchor` wiring (store-bound alignment
 * getters, GPS seed) stays in main.ts because it needs the running store; that
 * part is verified on-device. `ANCHOR_MODE` pins the plan's required
 * `snap-when-offscreen` behaviour so a future edit can't silently change it.
 */
import {
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GpsAnchorMode } from 'gps-plus-slam-app-framework/visualization';

import { placeRootCube } from './placement.js';

/**
 * The anchor mode the example uses. `snap-when-offscreen` is required by the
 * plan: it keeps the teaching "jump" out of the user's view (the anchor only
 * corrects to the GPS median while off-screen).
 */
export const ANCHOR_MODE: GpsAnchorMode = 'snap-when-offscreen';

/** Build the anchor marker — a small green sphere, visually distinct from the
 * orange floater cube. Internal to this module (used by `coSpawnAtWorldPose`). */
function createAnchorMarker(): Mesh {
  return new Mesh(
    new SphereGeometry(0.1, 16, 12),
    new MeshStandardMaterial({ color: 0x66ff99 })
  );
}

export interface CoSpawnResult {
  /** The deliberate floater, parented under the GPS-aligned scene root. */
  readonly cube: Mesh;
  /** The anchor's object3D, parented under `arWorldGroup` (hand to createGpsAnchor). */
  readonly anchorObject: Mesh;
}

/**
 * Place both objects at the same world pose under their respective parents.
 *
 * The cube goes under `scene` at `worldPosition`; the anchor marker goes under
 * `arWorldGroup` at the AR-local equivalent of the same world point, so the two
 * start coincident. `arWorldGroup`'s world matrix is refreshed first so the
 * world→local conversion uses the current transform.
 */
export function coSpawnAtWorldPose(opts: {
  scene: Object3D;
  arWorldGroup: Object3D;
  worldPosition: Vector3;
}): CoSpawnResult {
  const { scene, arWorldGroup, worldPosition } = opts;

  const cube = placeRootCube(scene, worldPosition);

  const anchorObject = createAnchorMarker();
  arWorldGroup.add(anchorObject);
  arWorldGroup.updateWorldMatrix(true, false);
  anchorObject.position.copy(arWorldGroup.worldToLocal(worldPosition.clone()));

  return { cube, anchorObject };
}
