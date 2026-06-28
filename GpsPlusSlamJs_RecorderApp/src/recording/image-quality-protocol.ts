/**
 * Message protocol between the main thread and the image-quality Web Worker.
 *
 * Kept in its own module (no DOM, no `new Worker`) so both the worker entry
 * (`image-quality.worker.ts`) and the main-thread client (`image-quality-client.ts`)
 * import the same shapes, and so a test can construct messages without pulling in
 * the worker. Mirrors the (now-removed) QR demo's `opencv-pnp-protocol.ts`.
 *
 * @see ./image-quality-client.ts
 * @see ./image-quality.worker.ts
 * @see GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md §3
 */

import type { QualityFilterConfig } from 'gps-plus-slam-app-framework/ar/image-quality';

// The individual message interfaces are intentionally NOT exported (only the
// `WorkerInbound`/`WorkerOutbound` unions are): consumers narrow on `type`, so
// exporting the members would just be dead public surface (knip flags it).

/** main → worker: (re)initialize the gate + thresholds for a new recording. */
interface InitMessage {
  readonly type: 'init';
  readonly config: QualityFilterConfig;
}

/** main → worker: analyze one encoded JPEG frame. */
interface AnalyzeMessage {
  readonly type: 'analyze';
  /** Correlation id echoed back in the matching verdict. */
  readonly id: number;
  readonly blob: Blob;
}

/** Anything the main thread may post to the worker. */
export type WorkerInbound = InitMessage | AnalyzeMessage;

/** worker → main: gate initialized, ready to analyze. */
interface ReadyMessage {
  readonly type: 'ready';
}

/** worker → main: verdict for a prior analyze message. */
interface VerdictMessage {
  readonly type: 'verdict';
  /** Echoes the analyze message id this verdict answers. */
  readonly id: number;
  readonly accept: boolean;
  readonly reason: string | null;
}

/** Anything the worker may post to the main thread. */
export type WorkerOutbound = ReadyMessage | VerdictMessage;
