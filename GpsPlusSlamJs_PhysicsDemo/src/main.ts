/**
 * Physics demo entry point.
 *
 * This iteration (Part C1 of the 2026-07-15 replay-as-dev-harness): the
 * desktop-replay skeleton. It detects WebXR support (live AR physics lands in a
 * later iteration) and, on the desktop, lets the developer load a recorded walk
 * and replay it via the framework's `startReplaySession` — rendering the live
 * occupancy-mesh reconstruction while offering play/pause + speed controls. The
 * Rapier physics, mesh-view controller and spawn UX build on this skeleton.
 *
 * Logic lives in the tested modules (`mode-detection`, `replay-launch`); this
 * file is the DOM glue, covered by the Playwright smoke test.
 */

import * as THREE from "three";
import { detectArSupport } from "./mode-detection";
import { loadAndStartReplay, type ReplayLaunchSink } from "./replay-launch";
import {
  createMeshViewController,
  type MeshStyle,
} from "./mesh-view-controller";
import { initRapier, createPhysicsWorld } from "./physics-world";
import { createPhysicsSession } from "./physics-session";
import {
  pointerToNdc,
  pickWorldPoint,
} from "gps-plus-slam-app-framework/visualization";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import type { ReplaySessionController } from "gps-plus-slam-app-framework/state";

function requireEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}

async function main(): Promise<void> {
  const app = requireEl("app");
  const modeScreen = requireEl("mode-screen");
  const capabilityMessage = requireEl("capability-message");
  const fileInput = requireEl<HTMLInputElement>("recording-input");
  const startArButton = requireEl<HTMLButtonElement>("start-ar-button");
  const replayPanel = requireEl("replay-panel");
  const replayStatus = requireEl("replay-status");
  const playPauseButton = requireEl<HTMLButtonElement>("play-pause-button");
  const speedInput = requireEl<HTMLInputElement>("replay-speed");
  const speedValue = requireEl("replay-speed-value");
  const meshVisibleInput = requireEl<HTMLInputElement>("mesh-visible");
  const meshStyleSelect = requireEl<HTMLSelectElement>("mesh-style");
  const dropBallButton = requireEl<HTMLButtonElement>("drop-ball-button");
  const clearBallsButton = requireEl<HTMLButtonElement>("clear-balls-button");
  const statsEl = requireEl("stats");

  // Live AR physics is a later iteration; here the button only advertises it so
  // a capable device is not left thinking the demo is desktop-only.
  if (await detectArSupport()) {
    startArButton.hidden = false;
    startArButton.addEventListener("click", () => {
      capabilityMessage.hidden = false;
      capabilityMessage.textContent =
        "Live AR physics lands in a later iteration — load a recording to try the replay harness now.";
    });
  }

  let controller: ReplaySessionController | null = null;
  let playing = false;

  const setPlaying = (next: boolean): void => {
    playing = next;
    playPauseButton.textContent = next ? "Pause" : "Play";
  };

  const sink: ReplayLaunchSink = {
    onLoading() {
      fileInput.disabled = true;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = "Loading recording…";
    },
    onReady(readyController, actionCount) {
      controller = readyController;
      modeScreen.hidden = true;
      replayPanel.hidden = false;
      replayStatus.textContent = `Replaying ${actionCount} recorded actions — the mesh reconstructs as the walk plays back.`;

      // Live mesh-view toggle over the visualizers the session owns.
      const meshView = createMeshViewController(
        {
          cubes: readyController.getCubesVisualizer(),
          occlusionMesh: readyController.getOcclusionMesh(),
        },
        {
          visible: meshVisibleInput.checked,
          style: meshStyleSelect.value as MeshStyle,
        },
      );
      meshVisibleInput.addEventListener("change", () =>
        meshView.setVisible(meshVisibleInput.checked),
      );
      meshStyleSelect.addEventListener("change", () =>
        meshView.setStyle(meshStyleSelect.value as MeshStyle),
      );

      // Physics starts once Rapier's WASM is ready (loaded lazily on first replay).
      void initRapier().then(() => setupPhysics(readyController));

      setPlaying(true);
      void controller.play(Number(speedInput.value) || 1);
    },
    onError(message) {
      fileInput.disabled = false;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = `⚠ ${message}`;
    },
  };

  // Rebuild the collider from the growing occupied AABBs at most this often (ms),
  // coalescing the fast replay-driven grid growth so a rebuild every frame does
  // not teleport resting balls (design §6 churn note).
  const COLLIDER_REBUILD_MS = 500;

  function setupPhysics(session: ReplaySessionController): void {
    const scene = session.getScene();
    const occlusionMesh = session.getOcclusionMesh();

    // Balls live in raw-WebXR space; parent them under a WEBXR_TO_NUE node so they
    // ride the same alignment × WEBXR_TO_NUE chain as the reconstructed mesh and
    // visually coincide with it.
    const ballGroup = new THREE.Group();
    ballGroup.matrixAutoUpdate = false;
    ballGroup.matrix.copy(WEBXR_TO_NUE);
    scene.arWorldGroup.add(ballGroup);

    const physics = createPhysicsWorld();
    const physicsSession = createPhysicsSession(physics, ballGroup);

    let lastRebuild = -Infinity;
    const tick = (t: number): void => {
      if (occlusionMesh && t - lastRebuild >= COLLIDER_REBUILD_MS) {
        const aabbs = occlusionMesh.getAabbs();
        if (aabbs.length > 0) {
          physicsSession.setColliderFromAabbs(aabbs);
        }
        lastRebuild = t;
      }
      physicsSession.step();
      statsEl.textContent = `balls ${physicsSession.ballCount()} · collider ${physicsSession.colliderShapeCount()} boxes`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const spawnAtWorld = (world: THREE.Vector3, lift: number): void => {
      const local = ballGroup.worldToLocal(world.clone());
      physicsSession.spawnBallAt({ x: local.x, y: local.y + lift, z: local.z });
    };

    // Click a real reconstructed surface → spawn a ball just above it (Part B
    // raycast against the occlusion mesh).
    const canvas = scene.renderer.domElement;
    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (!occlusionMesh) return;
      const ndc = pointerToNdc(
        e.clientX,
        e.clientY,
        canvas.getBoundingClientRect(),
      );
      const hit = pickWorldPoint(scene.camera, ndc, [occlusionMesh.getMesh()]);
      if (hit) spawnAtWorld(hit, 0.3);
    });

    dropBallButton.addEventListener("click", () => {
      const camWorld = scene.camera.getWorldPosition(new THREE.Vector3());
      spawnAtWorld(camWorld, 0.5);
    });
    clearBallsButton.addEventListener("click", () =>
      physicsSession.clearBalls(),
    );
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
      void loadAndStartReplay(file, app, sink);
    }
  });

  playPauseButton.addEventListener("click", () => {
    if (!controller) {
      return;
    }
    if (playing) {
      controller.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      void controller.resume();
    }
  });

  const applySpeed = (): void => {
    const factor = Number(speedInput.value) || 1;
    speedValue.textContent = `${factor}×`;
    controller?.setSpeed(factor);
  };
  speedInput.addEventListener("input", applySpeed);
}

void main();
