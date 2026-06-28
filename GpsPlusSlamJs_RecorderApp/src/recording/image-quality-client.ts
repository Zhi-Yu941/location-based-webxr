/**
 * Main-thread client for the off-thread image-quality (blur/blackness) gate.
 *
 * Owns the init/ready handshake, id-correlated async `analyze` calls, and
 * disposal — the same shape the QR demo's removed `worker-pnp-client` had. The
 * transport-agnostic logic lives in {@link createImageQualityClient} (unit-tested
 * with a fake worker); {@link createImageQualityAnalyzer} is the thin device seam
 * that spawns the real module worker (Vite-bundled, not unit-tested).
 *
 * The returned `analyze` is injected into the framework via
 * `setImageQualityAnalyzer`, which forwards it to `ImageCaptureManager` as its
 * `analyzeFrame` callback. Fail-open is the rule throughout: any worker error or
 * disposal resolves pending verdicts as `accept: true`, so a flaky worker can
 * never lose a recording interval (the manager also has its own safety timeout).
 *
 * @see ./image-quality-protocol.ts
 * @see ./image-quality.worker.ts
 * @see GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md §3, §8
 */

import type {
  CapturedFrame,
  FrameQualityVerdict,
} from 'gps-plus-slam-app-framework/ar/image-capture';
import type { QualityFilterConfig } from 'gps-plus-slam-app-framework/ar/image-quality';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { WorkerInbound, WorkerOutbound } from './image-quality-protocol';

const log = createLogger('ImageQualityClient');

/**
 * The minimal surface of a `Worker` this client uses, so a fake can be injected
 * in tests without a real worker thread.
 */
export interface WorkerLike {
  postMessage(message: WorkerInbound): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** The injectable analyzer handed to `setImageQualityAnalyzer`. */
export interface ImageQualityClient {
  /** Analyze one encoded frame; resolves with the verdict (fail-open). */
  analyze: (frame: CapturedFrame) => Promise<FrameQualityVerdict>;
  /** Terminate the worker and fail-open any in-flight analyses. */
  dispose: () => void;
}

const ACCEPT: FrameQualityVerdict = { accept: true, reason: 'fail-open' };

/**
 * Build a client over an already-constructed worker. Posts `init` immediately;
 * `analyze` calls before the worker reports `ready` are queued and flushed in
 * order once it does (so a verdict is never computed before the gate exists).
 */
export function createImageQualityClient(
  config: QualityFilterConfig,
  worker: WorkerLike
): ImageQualityClient {
  const pending = new Map<number, (verdict: FrameQualityVerdict) => void>();
  const preReadyQueue: (() => void)[] = [];
  let ready = false;
  let disposed = false;
  let seq = 0;

  worker.onmessage = (event: MessageEvent): void => {
    const msg = event.data as WorkerOutbound;
    if (msg.type === 'ready') {
      ready = true;
      while (preReadyQueue.length > 0) preReadyQueue.shift()?.();
      return;
    }
    if (msg.type === 'verdict') {
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve({ accept: msg.accept, reason: msg.reason });
      }
    }
  };

  worker.onerror = (event: unknown): void => {
    // A worker error is fatal. Mark the client disposed (and terminate the dead
    // worker) so future analyze() calls fail open immediately instead of posting
    // to a worker that will never reply — which would otherwise stall
    // ImageCaptureManager.awaitingVerdict until its safety timeout on every
    // frame. Resolve everything outstanding so nothing is left hanging.
    log.error('image-quality worker error — failing open', event);
    if (disposed) return;
    disposed = true;
    failOpenAll();
    worker.terminate();
  };

  function failOpenAll(): void {
    for (const resolve of pending.values()) resolve(ACCEPT);
    pending.clear();
    preReadyQueue.length = 0;
  }

  worker.postMessage({ type: 'init', config });

  function analyze(frame: CapturedFrame): Promise<FrameQualityVerdict> {
    if (disposed) return Promise.resolve(ACCEPT);
    return new Promise<FrameQualityVerdict>((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      const send = (): void => {
        // Re-check disposal: the worker may have been torn down while queued.
        if (disposed) {
          pending.delete(id);
          resolve(ACCEPT);
          return;
        }
        worker.postMessage({ type: 'analyze', id, blob: frame.blob });
      };
      if (ready) send();
      else preReadyQueue.push(send);
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    failOpenAll();
    worker.terminate();
  }

  return { analyze, dispose };
}

/**
 * Device seam: spawn the real Vite-bundled module worker and wrap it. Not
 * unit-tested (it instantiates a Worker); the logic it delegates to is covered
 * via {@link createImageQualityClient} with a fake worker.
 */
export function createImageQualityAnalyzer(
  config: QualityFilterConfig
): ImageQualityClient {
  const worker = new Worker(
    new URL('./image-quality.worker.ts', import.meta.url),
    { type: 'module' }
  );
  return createImageQualityClient(config, worker as unknown as WorkerLike);
}
