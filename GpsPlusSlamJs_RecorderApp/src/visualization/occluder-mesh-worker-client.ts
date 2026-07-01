/**
 * Occluder mesh worker client — builds the {@link OccluderMeshDriver} for the
 * recorder, backed by the {@link occlusion-mesher.worker} Web Worker.
 *
 * The framework owns the driver + protocol; this thin app-side glue creates the
 * actual `Worker`, adapts it to the driver's {@link MeshWorkerPoster} seam, and
 * degrades to the driver's **synchronous fallback** if a worker can't be
 * constructed (unsupported env / test). See
 * `2026-07-01-occluder-worker-and-chunked-remesh-plan.md`.
 */

import {
  OccluderMeshDriver,
  type MeshWorkerPoster,
} from 'gps-plus-slam-app-framework/visualization/occluder-mesh-driver';
import type { MeshWorkerResponse } from 'gps-plus-slam-app-framework/ar/occlusion-mesh-worker';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('OccluderMeshWorker');

/** Default factory — the real module worker (Vite bundles it from the URL). */
function defaultCreateWorker(): Worker {
  return new Worker(
    new URL('../workers/occlusion-mesher.worker.ts', import.meta.url),
    { type: 'module' }
  );
}

/**
 * Create an {@link OccluderMeshDriver} that meshes off the main thread. Returns
 * the driver plus a `dispose` that also terminates the worker. If the worker
 * can't be created (no support, or `createWorker` throws), the driver falls back
 * to synchronous main-thread meshing — the occluder still works, just on-thread.
 *
 * @param createWorker injectable for tests; defaults to the real module worker.
 */
export function createOccluderMeshWorker(
  createWorker: () => Worker = defaultCreateWorker
): { driver: OccluderMeshDriver; dispose: () => void } {
  const { worker, poster } = tryCreateWorker(createWorker);
  const driver = new OccluderMeshDriver(poster);
  return {
    driver,
    dispose: () => {
      driver.dispose();
      worker?.terminate();
    },
  };
}

/** Create the worker + its poster adapter, or `{null, null}` on any failure. */
function tryCreateWorker(createWorker: () => Worker): {
  worker: Worker | null;
  poster: MeshWorkerPoster | null;
} {
  try {
    const worker = createWorker();
    const poster: MeshWorkerPoster = {
      postMessage: (message, transfer) =>
        worker.postMessage(message, transfer as Transferable[]),
      onmessage: null,
    };
    worker.onmessage = (event: MessageEvent): void => {
      poster.onmessage?.({ data: event.data as MeshWorkerResponse });
    };
    worker.onerror = (event): void => {
      // A worker error means no response for the in-flight job; log and let the
      // next refresh retry. (The occluder just stays a beat staler.)
      log.warn('Occluder mesh worker error', event.message ?? event);
    };
    return { worker, poster };
  } catch (err) {
    log.warn('Occluder mesh worker unavailable; meshing synchronously', err);
    return { worker: null, poster: null };
  }
}
