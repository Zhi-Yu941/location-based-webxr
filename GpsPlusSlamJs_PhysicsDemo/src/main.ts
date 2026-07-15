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
import { initRapier } from "./physics-world";
import { createPhysicsRuntime } from "./physics-runtime";
import { startArMode } from "./ar-mode";
import { shootBallFromCamera } from "./shoot-ball";
import { pointerToNdc } from "gps-plus-slam-app-framework/visualization";
import type { ReplaySessionController } from "gps-plus-slam-app-framework/state/replay-session";

function requireEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}

function main(): void {
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
  const replayControls = requireEl("replay-controls");

  // Live AR: on a WebXR-capable device, "Start AR" launches a genuine AR physics
  // session (device-only — verified via `pnpm dev` on a phone). The play/pause +
  // speed row is replay-only, so it is hidden in AR; the mesh + physics controls
  // are shared. Detection is fire-and-forget so the replay listeners below wire
  // synchronously (a blocking await here would leave the file input briefly dead).
  void detectArSupport().then((supported) => {
    if (!supported) return;
    startArButton.hidden = false;
    startArButton.addEventListener("click", () => {
      startArButton.disabled = true;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = "Starting AR…";
      void initRapier().then(() =>
        startArMode({
          container: app,
          dropButton: dropBallButton,
          clearButton: clearBallsButton,
          statsEl,
          meshVisibleInput,
          meshStyleSelect,
          onError: (message) => {
            startArButton.disabled = false;
            capabilityMessage.hidden = false;
            capabilityMessage.textContent = `⚠ ${message}`;
          },
          onStarted: () => {
            modeScreen.hidden = true;
            replayPanel.hidden = false;
            replayControls.hidden = true; // play/pause/speed are replay-only
            replayStatus.textContent =
              "AR running — tap a surface to drop a ball.";
          },
        }),
      );
    });
  });

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
      void initRapier().then(() => setupReplayPhysics(readyController));

      setPlaying(true);
      void controller.play(Number(speedInput.value) || 1);
    },
    onError(message) {
      fileInput.disabled = false;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = `⚠ ${message}`;
    },
  };

  function setupReplayPhysics(session: ReplaySessionController): void {
    const scene = session.getScene();
    const occlusionMesh = session.getOcclusionMesh();
    const runtime = createPhysicsRuntime(scene.arWorldGroup, occlusionMesh, {
      onStats: (balls, boxes) => {
        statsEl.textContent = `balls ${balls} · collider ${boxes} boxes`;
      },
    });

    // Desktop replay is driven by window rAF.
    const tick = (t: number): void => {
      runtime.step(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Placement (desktop): click → shoot a ball FROM the camera toward where you
    // clicked, so it flies out, hits the reconstructed mesh and bounces.
    const canvas = scene.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      const ndc = pointerToNdc(
        e.clientX,
        e.clientY,
        canvas.getBoundingClientRect(),
      );
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), scene.camera);
      shootBallFromCamera(
        runtime,
        scene.camera.getWorldPosition(new THREE.Vector3()),
        raycaster.ray.direction,
      );
    });

    dropBallButton.addEventListener("click", () =>
      shootBallFromCamera(
        runtime,
        scene.camera.getWorldPosition(new THREE.Vector3()),
        scene.camera.getWorldDirection(new THREE.Vector3()),
      ),
    );
    clearBallsButton.addEventListener("click", () => runtime.clearBalls());
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

main();
