/**
 * Live-AR mode — a genuine on-device AR physics session (the other half of the
 * demo; the desktop-replay path lives in `main.ts`).
 *
 * It starts a WebXR session (`initAR`), reconstructs the room from the live depth
 * stream (`createOccupancyView` — the same occupancy stack the replay path uses),
 * runs the shared `createPhysicsRuntime`, and places balls where a screen-centre
 * WebXR hit-test reticle sits when the user taps. Everything below the tested
 * pieces (occupancy view, physics runtime, mesh-view controller) is device-only
 * WebXR glue — verified manually via `pnpm dev` on an Android phone, per the repo
 * norm (Playwright Chromium has no `navigator.xr`), mirroring the sibling apps'
 * `reticle-hit-test.ts` / `startArInteraction`.
 */

import * as THREE from "three";
import {
  initAR,
  endARSession,
  getArWorldGroup,
  getCamera,
  startDepthCapture,
  stopDepthCapture,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state/create-slam-app-store";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage/null-storage-backend";
import { recordDepthSample } from "gps-plus-slam-app-framework/state/recording-slice";
import { createOccupancyView } from "./occupancy-view";
import { createPhysicsRuntime } from "./physics-runtime";
import { shootBallFromCamera } from "./shoot-ball";
import {
  createMeshViewController,
  type MeshStyle,
} from "./mesh-view-controller";

export interface ArModeDeps {
  readonly container: HTMLElement;
  readonly statsEl: HTMLElement;
  readonly meshVisibleInput: HTMLInputElement;
  readonly meshStyleSelect: HTMLSelectElement;
  /** Surface a failure (permission denied, no depth, WebXR error) to the UI. */
  readonly onError: (message: string) => void;
  /** Called once the live AR session is up and physics is running. */
  readonly onStarted?: () => void;
}

/**
 * Start the live-AR physics session. Resolves once the session is running (or
 * rejects/`onError`s on failure). The returned disposer ends the AR session.
 */
export async function startArMode(deps: ArModeDeps): Promise<() => void> {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });

  try {
    await initAR(
      deps.container,
      {},
      { requestDepthOcclusion: true },
      {
        tracking: { store },
        depth: {
          onCaptured: (sample) => store.dispatch(recordDepthSample(sample)),
          onUnavailable: () =>
            deps.onError("Depth sensing is unavailable on this device."),
        },
      },
    );
  } catch (err) {
    deps.onError(
      err instanceof Error ? err.message : "Could not start the AR session.",
    );
    return () => {};
  }

  const arWorldGroup = getArWorldGroup();
  if (!arWorldGroup) {
    deps.onError("AR session started without a scene.");
    void endARSession();
    return () => {};
  }

  // Live room reconstruction from the depth stream.
  startDepthCapture();
  const occupancy = createOccupancyView(arWorldGroup, store);

  // Shared physics runtime (collider follows the occlusion mesh).
  const runtime = createPhysicsRuntime(arWorldGroup, occupancy.occlusionMesh, {
    onStats: (balls, boxes) => {
      deps.statsEl.textContent = `balls ${balls} · collider ${boxes} tris`;
    },
  });

  // Live mesh-view toggle (Cubes / Detailed), shared with the replay path.
  const meshView = createMeshViewController(
    { cubes: occupancy.cubes, occlusionMesh: occupancy.occlusionMesh },
    {
      visible: deps.meshVisibleInput.checked,
      style: deps.meshStyleSelect.value as MeshStyle,
    },
  );
  deps.meshVisibleInput.addEventListener("change", () =>
    meshView.setVisible(deps.meshVisibleInput.checked),
  );
  deps.meshStyleSelect.addEventListener("change", () =>
    meshView.setStyle(deps.meshStyleSelect.value as MeshStyle),
  );

  // Tap-to-shoot: a ball leaves the camera along its forward direction and flies
  // into the reconstructed room. No reticle — the ball goes where you look.
  const shootForward = (): void => {
    const camera = getCamera();
    if (!camera) return;
    shootBallFromCamera(
      runtime,
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3()),
    );
  };

  let selectWired = false;
  const unregisterFrame = registerXrFrameUpdate(({ session }) => {
    // Step physics every XR frame (the throttle uses wall-clock ms).
    runtime.step(performance.now());
    if (!selectWired) {
      selectWired = true;
      session.addEventListener("select", shootForward);
    }
  });

  deps.onStarted?.();

  return () => {
    unregisterFrame();
    stopDepthCapture();
    occupancy.dispose();
    runtime.dispose();
    void endARSession();
  };
}
