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
  startDepthCapture,
  stopDepthCapture,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import {
  createReticleMesh,
  updateReticle,
} from "gps-plus-slam-app-framework/visualization";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state/create-slam-app-store";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage/null-storage-backend";
import { recordDepthSample } from "gps-plus-slam-app-framework/state/recording-slice";
import { createOccupancyView } from "./occupancy-view";
import { createPhysicsRuntime } from "./physics-runtime";
import {
  createMeshViewController,
  type MeshStyle,
} from "./mesh-view-controller";

export interface ArModeDeps {
  readonly container: HTMLElement;
  readonly dropButton: HTMLButtonElement;
  readonly clearButton: HTMLButtonElement;
  readonly statsEl: HTMLElement;
  readonly meshVisibleInput: HTMLInputElement;
  readonly meshStyleSelect: HTMLSelectElement;
  /** Surface a failure (permission denied, no depth, WebXR error) to the UI. */
  readonly onError: (message: string) => void;
  /** Called once the live AR session is up and physics is running. */
  readonly onStarted?: () => void;
}

/** Request a screen-centre hit-test source (null on older runtimes). */
async function requestHitTestSource(
  session: XRSession,
): Promise<XRHitTestSource | null> {
  const viewerSpace = await session.requestReferenceSpace("viewer");
  const source = await session.requestHitTestSource?.({ space: viewerSpace });
  return source ?? null;
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
      { requestHitTest: true, requestDepthOcclusion: true },
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
      deps.statsEl.textContent = `balls ${balls} · collider ${boxes} boxes`;
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

  // Screen-centre hit-test reticle + tap-to-spawn (mirrors reticle-hit-test.ts).
  const reticle = createReticleMesh();
  arWorldGroup.add(reticle);
  const reticleWorld = new THREE.Vector3();

  const spawnAtReticle = (lift: number): void => {
    if (!reticle.visible) return;
    reticle.getWorldPosition(reticleWorld);
    runtime.spawnAtWorld(reticleWorld.clone(), lift);
  };

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestRequested = false;
  let selectWired = false;

  const unregisterFrame = registerXrFrameUpdate(
    ({ frame, referenceSpace, session }) => {
      // Step physics every XR frame (the throttle uses wall-clock ms).
      runtime.step(performance.now());

      // Tap-to-spawn: a ball at the reticle-hit surface.
      if (!selectWired) {
        selectWired = true;
        session.addEventListener("select", () => spawnAtReticle(0.05));
      }

      if (!hitTestSource) {
        if (!hitTestRequested) {
          hitTestRequested = true;
          requestHitTestSource(session)
            .then((source) => {
              hitTestSource = source;
            })
            .catch(() => {
              hitTestRequested = false; // allow a retry next frame
            });
        }
        updateReticle(reticle, null);
        return;
      }

      const [hit] = frame.getHitTestResults(hitTestSource);
      const pose = hit?.getPose(referenceSpace);
      updateReticle(reticle, pose ? pose.transform.matrix : null);
    },
  );

  deps.dropButton.addEventListener("click", () => spawnAtReticle(0.5));
  deps.clearButton.addEventListener("click", () => runtime.clearBalls());

  deps.onStarted?.();

  return () => {
    unregisterFrame();
    hitTestSource?.cancel();
    stopDepthCapture();
    occupancy.dispose();
    runtime.dispose();
    void endARSession();
  };
}
