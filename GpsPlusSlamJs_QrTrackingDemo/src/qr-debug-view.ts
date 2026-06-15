/**
 * QR debug view — the two on-screen objects the §5 verification gate checks
 * (Note 4): a 3D axis at the solved QR pose, and a semi-transparent cube sized
 * to the QR so its front face lands on the printed corners ("is it glued to the
 * code?"). Both are parented under `arWorldGroup` so they ride the alignment /
 * transform chain exactly like real content.
 *
 * Persistence across detection misses (Note 3): `update()` is called on every
 * lock; `clear()` is NOT called on a miss, so the objects keep their last pose
 * and never flicker between throttled detections. They stay hidden until the
 * first `update()`.
 */

import { AxesHelper, BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import type { Object3D } from "three";
import type { Pose } from "gps-plus-slam-app-framework/ar";

/** A thin slab so the cube's front face sits on the printed code (1 cm deep). */
const CUBE_DEPTH_M = 0.01;

export interface QrDebugView {
  /** Glue the axis + cube to a solved pose at the given physical size (m). */
  update(pose: Pose, sizeM: number): void;
  /** Hide the objects (e.g. on reset); does NOT detach them from the scene. */
  clear(): void;
  /** Remove the objects from the parent and free GPU resources. */
  dispose(): void;
}

/**
 * Create the debug axis + cube under `parent` (the `arWorldGroup`). Objects
 * start hidden; the first `update()` reveals and positions them.
 */
export function createQrDebugView(parent: Object3D): QrDebugView {
  const axes = new AxesHelper(0.15);
  axes.visible = false;

  const cubeMaterial = new MeshBasicMaterial({
    color: 0x33ddff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const cube = new Mesh(new BoxGeometry(1, 1, 1), cubeMaterial);
  cube.visible = false;

  parent.add(axes);
  parent.add(cube);

  function applyPose(object: Object3D, pose: Pose): void {
    object.position.set(pose.position[0], pose.position[1], pose.position[2]);
    object.quaternion.set(
      pose.rotation[0],
      pose.rotation[1],
      pose.rotation[2],
      pose.rotation[3],
    );
  }

  return {
    update(pose: Pose, sizeM: number): void {
      applyPose(axes, pose);
      applyPose(cube, pose);
      // Front face on the printed code: span sizeM in-plane, thin in depth, and
      // push the slab back by half its depth so the +z face sits at the code.
      cube.scale.set(sizeM, sizeM, CUBE_DEPTH_M);
      cube.translateZ(-CUBE_DEPTH_M / 2);
      axes.visible = true;
      cube.visible = true;
    },
    clear(): void {
      axes.visible = false;
      cube.visible = false;
    },
    dispose(): void {
      parent.remove(axes);
      parent.remove(cube);
      axes.dispose();
      cube.geometry.dispose();
      cubeMaterial.dispose();
    },
  };
}
