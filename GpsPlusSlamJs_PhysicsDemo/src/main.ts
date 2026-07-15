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

import { detectArSupport } from "./mode-detection";
import { loadAndStartReplay, type ReplayLaunchSink } from "./replay-launch";
import {
  createMeshViewController,
  type MeshStyle,
} from "./mesh-view-controller";
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

      setPlaying(true);
      void controller.play(Number(speedInput.value) || 1);
    },
    onError(message) {
      fileInput.disabled = false;
      capabilityMessage.hidden = false;
      capabilityMessage.textContent = `⚠ ${message}`;
    },
  };

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
