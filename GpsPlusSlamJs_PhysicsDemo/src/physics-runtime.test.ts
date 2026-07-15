/**
 * Headless tests for the shared physics runtime (real Rapier + real THREE).
 *
 * Why this test matters:
 * Both the desktop-replay and live-AR modes drive this one runtime, so its two
 * mode-independent behaviours are pinned here: (1) the collider is rebuilt from
 * the growing mesh only once per throttle window (coalescing the fast grid growth
 * so resting balls are not teleported every frame), and (2) a WORLD-space spawn
 * point is converted into the ball group's local raw-WebXR space via the
 * `WEBXR_TO_NUE` chain — the conversion that makes AR/desktop spawns land where
 * the user pointed and coincide with the reconstructed mesh.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { initRapier } from "./physics-world";
import { createPhysicsRuntime, type AabbSource } from "./physics-runtime";
import type { Aabb } from "gps-plus-slam-app-framework/ar/occupancy-mesher";

const FLOOR: readonly Aabb[] = [
  { center: [0, -0.075, 0], halfExtents: [5, 0.075, 5] },
];

/** A mutable AABB source so a test can grow the reconstructed mesh over time. */
function mutableSource(initial: readonly Aabb[]): AabbSource & {
  set(aabbs: readonly Aabb[]): void;
} {
  let current = initial;
  return {
    getAabbs: () => current,
    set(aabbs) {
      current = aabbs;
    },
  };
}

beforeAll(async () => {
  await initRapier();
});

describe("createPhysicsRuntime", () => {
  it("rebuilds the collider from the AABB source only once per throttle window", () => {
    const arWorldGroup = new THREE.Group();
    const source = mutableSource(FLOOR);
    const runtime = createPhysicsRuntime(arWorldGroup, source, {
      colliderRebuildMs: 500,
    });

    runtime.step(0); // first step rebuilds (throttle satisfied from -Infinity)
    expect(runtime.colliderShapeCount()).toBe(1);

    // Grow the mesh to 3 AABBs; a step INSIDE the window must NOT pick it up yet.
    source.set([
      { center: [0, 0, 0], halfExtents: [1, 1, 1] },
      { center: [2, 0, 0], halfExtents: [1, 1, 1] },
      { center: [0, 0, 2], halfExtents: [1, 1, 1] },
    ]);
    runtime.step(100);
    expect(runtime.colliderShapeCount()).toBe(1);

    // A step past the window rebuilds to the new geometry.
    runtime.step(600);
    expect(runtime.colliderShapeCount()).toBe(3);
    runtime.dispose();
  });

  it("converts a WORLD-space spawn point into the ball group local (WEBXR_TO_NUE) space", () => {
    const arWorldGroup = new THREE.Group(); // identity → ball group world = WEBXR_TO_NUE
    const runtime = createPhysicsRuntime(arWorldGroup, null);

    // A reference node with the same WEBXR_TO_NUE transform maps a KNOWN local
    // point to its world point; spawning at that world point must round-trip back
    // to the known local on the internal ball mesh.
    const targetLocal = new THREE.Vector3(0.5, 1.0, -0.3);
    const ref = new THREE.Group();
    ref.matrixAutoUpdate = false;
    ref.matrix.copy(WEBXR_TO_NUE);
    ref.updateWorldMatrix(false, false);
    const worldPoint = ref.localToWorld(targetLocal.clone());

    runtime.spawnAtWorld(worldPoint, 0); // lift 0 so the local equals targetLocal

    expect(runtime.ballCount()).toBe(1);
    const ballGroup = arWorldGroup.children[0]!; // the WEBXR_TO_NUE group
    const ballMesh = ballGroup.children[0]!; // the spawned ball
    expect(ballMesh.position.x).toBeCloseTo(0.5, 5);
    expect(ballMesh.position.y).toBeCloseTo(1.0, 5);
    expect(ballMesh.position.z).toBeCloseTo(-0.3, 5);
    runtime.dispose();
  });

  it("spawns and clears balls, and reports stats via onStats", () => {
    const arWorldGroup = new THREE.Group();
    let lastBalls = -1;
    const runtime = createPhysicsRuntime(arWorldGroup, mutableSource(FLOOR), {
      onStats: (balls) => {
        lastBalls = balls;
      },
    });
    runtime.spawnAtWorld(new THREE.Vector3(0, 1, 0));
    runtime.spawnAtWorld(new THREE.Vector3(0, 1, 0));
    expect(runtime.ballCount()).toBe(2);

    runtime.step(0);
    expect(lastBalls).toBe(2); // onStats saw the balls

    runtime.clearBalls();
    expect(runtime.ballCount()).toBe(0);
    runtime.dispose();
  });
});
