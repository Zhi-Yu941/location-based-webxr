/**
 * Physics runtime — the mode-independent core shared by the desktop-replay and
 * live-AR paths: a Rapier world + ball session parented under a `WEBXR_TO_NUE`
 * group, a throttled collider rebuild from the growing reconstructed mesh, and a
 * world-space spawn entry point. Both modes drive it identically; only how `step`
 * is ticked (window rAF for replay, the XR frame loop for AR) and how a spawn
 * point is obtained (pointer raycast vs. WebXR hit-test) differ — see the
 * placement abstraction in `main.ts`.
 *
 * Extracting this keeps the two modes from duplicating the physics wiring and
 * makes the spawn → rebuild → step → sync loop headless-testable.
 */

import * as THREE from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { Aabb } from "gps-plus-slam-app-framework/ar/occupancy-mesher";
import { createPhysicsWorld } from "./physics-world";
import { createPhysicsSession } from "./physics-session";

/** The occupied-AABB feed (the framework `OcclusionMesh`) the collider follows. */
export interface AabbSource {
  getAabbs(): readonly Aabb[];
}

export interface PhysicsRuntimeOptions {
  /** Min delay between collider rebuilds (ms). Default 500 (coalesce, design §6). */
  readonly colliderRebuildMs?: number;
  /** Called after each step with the current ball + collider-box counts. */
  readonly onStats?: (ballCount: number, colliderShapeCount: number) => void;
}

export interface PhysicsRuntime {
  /**
   * Rebuild the collider from the AABB source (throttled to `colliderRebuildMs`),
   * step the world, sync ball meshes, and report stats. `nowMs` is the frame
   * timestamp (rAF / XR frame time) driving the rebuild throttle.
   */
  step(nowMs: number): void;
  /** Spawn a ball `liftM` above a WORLD-space point (converted to physics space). */
  spawnAtWorld(worldPoint: THREE.Vector3, liftM?: number): void;
  clearBalls(): void;
  ballCount(): number;
  colliderShapeCount(): number;
  dispose(): void;
}

/**
 * Create the runtime. `arWorldGroup` is the scene node carrying the alignment
 * (replay scene or live AR); the balls hang under a `WEBXR_TO_NUE` child of it so
 * they ride the same chain as the reconstructed mesh. `aabbSource` is the
 * occlusion mesh (or `null` to run without a collider, e.g. occupancy disabled).
 */
export function createPhysicsRuntime(
  arWorldGroup: THREE.Object3D,
  aabbSource: AabbSource | null,
  options: PhysicsRuntimeOptions = {},
): PhysicsRuntime {
  const colliderRebuildMs = options.colliderRebuildMs ?? 500;
  const physics = createPhysicsWorld();

  const ballGroup = new THREE.Group();
  ballGroup.matrixAutoUpdate = false;
  ballGroup.matrix.copy(WEBXR_TO_NUE);
  arWorldGroup.add(ballGroup);

  const session = createPhysicsSession(physics, ballGroup);
  let lastRebuild = -Infinity;

  return {
    step(nowMs: number): void {
      if (aabbSource && nowMs - lastRebuild >= colliderRebuildMs) {
        const aabbs = aabbSource.getAabbs();
        if (aabbs.length > 0) {
          session.setColliderFromAabbs(aabbs);
        }
        lastRebuild = nowMs;
      }
      session.step();
      options.onStats?.(session.ballCount(), session.colliderShapeCount());
    },
    spawnAtWorld(worldPoint: THREE.Vector3, liftM = 0.3): void {
      // Convert the world hit into the ball group's local (raw-WebXR) space.
      ballGroup.updateWorldMatrix(true, false);
      const local = ballGroup.worldToLocal(worldPoint.clone());
      session.spawnBallAt({ x: local.x, y: local.y + liftM, z: local.z });
    },
    clearBalls(): void {
      session.clearBalls();
    },
    ballCount: () => session.ballCount(),
    colliderShapeCount: () => session.colliderShapeCount(),
    dispose(): void {
      session.dispose();
      arWorldGroup.remove(ballGroup);
      physics.dispose();
    },
  };
}
