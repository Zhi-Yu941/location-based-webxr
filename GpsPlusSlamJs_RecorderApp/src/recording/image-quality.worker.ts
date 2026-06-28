/**
 * Image-quality Web Worker — the off-main-thread half of the blur/blackness
 * capture gate. Receives an encoded JPEG, decodes it (downscaled) to pixels, and
 * returns a verdict computed by the framework's PURE `image-quality` metrics +
 * `ImageQualityGate`. All pixel work (decode + Laplacian + luminance + rolling
 * history) happens here, never on the render thread — the off-main-thread
 * guarantee (plan §8).
 *
 * This file is the device seam: it is NOT unit-tested (it needs a real worker,
 * `createImageBitmap`, and `OffscreenCanvas`). The logic it calls is fully
 * tested in the framework's `image-quality.test.ts`; the main-thread transport
 * is tested in `image-quality-client.test.ts` with a fake worker.
 *
 * @see ./image-quality-client.ts
 * @see ./image-quality-protocol.ts
 */

import {
  rgbaToGrayscale,
  sharpnessScore,
  meanLuminance,
  ImageQualityGate,
  DEFAULT_QUALITY_FILTER,
  type QualityFilterConfig,
} from 'gps-plus-slam-app-framework/ar/image-quality';
import type { WorkerInbound, WorkerOutbound } from './image-quality-protocol';

/**
 * Long-edge (px) the frame is downscaled to before analysis. Variance-of-
 * Laplacian and mean-luminance are robust to downscaling, and a small buffer
 * keeps the per-frame cost trivial (the gate runs ~0.5 Hz on already-calm
 * frames). Placeholder pending field tuning.
 */
const MAX_ANALYZE_EDGE = 320;

// `self` is typed as `Window` under the app's DOM lib (no webworker lib); cast to
// the minimal worker surface we use so `postMessage(message)` typechecks.
const ctx = self as unknown as {
  postMessage: (message: WorkerOutbound) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void;
};

let config: QualityFilterConfig = DEFAULT_QUALITY_FILTER;
let gate = new ImageQualityGate();

interface DecodedFrame {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Decode a JPEG blob to a downscaled RGBA buffer via an OffscreenCanvas. */
async function decodeToRgba(blob: Blob): Promise<DecodedFrame | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > MAX_ANALYZE_EDGE ? MAX_ANALYZE_EDGE / longEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const c2d = canvas.getContext('2d');
    if (!c2d) return null;
    c2d.drawImage(bitmap, 0, 0, width, height);
    const image = c2d.getImageData(0, 0, width, height);
    return { data: image.data, width, height };
  } finally {
    bitmap.close();
  }
}

async function handleAnalyze(id: number, blob: Blob): Promise<void> {
  try {
    const decoded = await decodeToRgba(blob);
    if (!decoded) {
      // Could not decode → fail open (save) rather than lose the interval.
      ctx.postMessage({
        type: 'verdict',
        id,
        accept: true,
        reason: 'decode-failed',
      });
      return;
    }
    const lum = meanLuminance(decoded.data);
    const gray = rgbaToGrayscale(decoded.data);
    const sharp = sharpnessScore(gray, decoded.width, decoded.height);
    const verdict = gate.evaluate(sharp, lum, config);
    ctx.postMessage({
      type: 'verdict',
      id,
      accept: verdict.accept,
      reason: verdict.reason,
    });
  } catch {
    // Any failure → fail open. A dropped frame is worse than a soft one.
    ctx.postMessage({
      type: 'verdict',
      id,
      accept: true,
      reason: 'analyze-error',
    });
  }
}

ctx.addEventListener('message', (event: MessageEvent): void => {
  const msg = event.data as WorkerInbound;
  if (msg.type === 'init') {
    config = msg.config;
    gate = new ImageQualityGate(); // fresh baseline per recording
    ctx.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'analyze') {
    void handleAnalyze(msg.id, msg.blob);
  }
});
