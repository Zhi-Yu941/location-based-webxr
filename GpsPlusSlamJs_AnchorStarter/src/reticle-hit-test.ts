/**
 * Hit-test reticle controller (WebXR glue) for the persistent-anchor starter.
 *
 * Owns the per-frame XR plumbing that drives a screen-centre hit-test reticle:
 * it parents the framework's reticle mesh under `arWorldGroup` (AR-local space)
 * and, each XR frame, reads `frame.getHitTestResults(...)` to move/show/hide it.
 * The reticle's *view-model* (`createReticleMesh` / `updateReticle`) is the
 * framework's tested `hit-test-reticle.ts`; only the device-only XR loop lives
 * here, so this file is verified manually via `pnpm dev` (same convention as the
 * MinimalExample's `startArInteraction`). It is swapped out wholesale in e2e via
 * the `startReticleHitTest` seam.
 *
 * Unlike the MinimalExample, AnchorStarter does NOT wire a `select` (tap)
 * handler: placement is driven by the `#place-button`, which reads this
 * controller's `isVisible()` / `getWorldPosition()` at press time.
 */

import type { Object3D, Vector3 } from "three";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import {
  createReticleMesh,
  updateReticle,
} from "gps-plus-slam-app-framework/visualization";

/** What the placement glue needs to know about the live reticle. */
export interface ReticleHandle {
  /** Is a surface currently under the screen-centre reticle? */
  isVisible(): boolean;
  /**
   * Write the reticle's current world position into `out` and return it. Only
   * meaningful while `isVisible()` is true; the value is the GPS-world (NUE)
   * pose once `arWorldGroup` carries the alignment.
   */
  getWorldPosition(out: Vector3): Vector3;
  /** Remove the reticle mesh and unregister the frame loop (idempotent). */
  dispose(): void;
}

/**
 * Request a screen-centre hit-test source from the live session. Returns `null`
 * when the runtime does not expose `requestHitTestSource` (older WebXR builds);
 * the caller keeps the reticle hidden in that case.
 */
async function requestHitTestSource(
  session: XRSession,
): Promise<XRHitTestSource | null> {
  const viewerSpace = await session.requestReferenceSpace("viewer");
  const source = await session.requestHitTestSource?.({ space: viewerSpace });
  return source ?? null;
}

/**
 * Install the hit-test reticle under `arWorldGroup` and start driving it from
 * the XR frame loop. Returns a handle the placement glue reads at Place time.
 */
export function startReticleHitTest(args: {
  arWorldGroup: Object3D;
}): ReticleHandle {
  const reticle = createReticleMesh();
  args.arWorldGroup.add(reticle);

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  let disposed = false;
  let removeEndListener: (() => void) | null = null;

  // Reset on session end so a fresh session re-requests its own hit-test source.
  const handleSessionEnd = () => {
    hitTestSource = null;
    hitTestSourceRequested = false;
  };

  const unregister = registerXrFrameUpdate(
    ({ frame, referenceSpace, session }) => {
      // Register the session-end listener exactly once. The request-retry path
      // below resets `hitTestSourceRequested`, so it must not live in that
      // block or a failed request would stack a duplicate listener each frame.
      if (!removeEndListener) {
        session.addEventListener("end", handleSessionEnd);
        removeEndListener = () =>
          session.removeEventListener("end", handleSessionEnd);
      }

      if (!hitTestSourceRequested) {
        hitTestSourceRequested = true;
        requestHitTestSource(session)
          .then((source) => {
            // Guard the race where dispose() ran while the request was in
            // flight: cancel the now-orphaned source instead of leaking it.
            if (disposed) {
              source?.cancel();
              return;
            }
            hitTestSource = source;
          })
          .catch(() => {
            // Allow a later frame to retry if the request failed transiently.
            hitTestSourceRequested = false;
          });
      }

      if (!hitTestSource) {
        updateReticle(reticle, null);
        return;
      }

      const [hit] = frame.getHitTestResults(hitTestSource);
      const pose = hit?.getPose(referenceSpace);
      updateReticle(reticle, pose ? pose.transform.matrix : null);
    },
  );

  return {
    isVisible: () => reticle.visible,
    getWorldPosition: (out) => reticle.getWorldPosition(out),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unregister();
      removeEndListener?.();
      removeEndListener = null;
      // Stop the live hit-test so it does not keep running after teardown.
      hitTestSource?.cancel();
      hitTestSource = null;
      args.arWorldGroup.remove(reticle);
    },
  };
}
