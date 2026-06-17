/**
 * As-of depth resolver for the recorder live-QR debug viz (WS-5).
 *
 * The derive-on-read size join (`ar/qr-derived-pose.ts`) needs, for each QR
 * detection, the depth-sampling context that was active **at that detection's
 * timestamp**. The recorder records depth in its own stream (`recordDepthSample`),
 * but the store only keeps the LATEST sample — so this module keeps a small,
 * bounded history of depth samples and answers `resolveDepthAt(timestamp)` with
 * the sample whose timestamp is the latest `≤ timestamp` (the as-of join). It
 * then builds the {@link QrSizeDepthContext} the size measurer consumes
 * (unprojector + bilinear grid lookup), exactly like the QR demo's live
 * `getDepthContext`, but time-addressed.
 *
 * This is the **one genuinely new piece** WS-5 needs. It runs identically live
 * and on replay: `append` is fed every recorded depth sample (live: the capture
 * callback; replay: the re-dispatched `recordDepthSample` reflected in the
 * store's `latestDepthSample`), so the join reproduces the live result.
 *
 * **Clock domain (load-bearing):** depth timestamps are EPOCH ms
 * (`DepthSample.timestamp = performance.timeOrigin + frameTs`, `ar/depth-sampler.ts`),
 * and the QR producer MUST stamp detections from the same epoch clock (`Date.now()`;
 * plan open topic A). The lookup is a pure numeric `≤` over those stamps; if the QR
 * producer used relative `performance.now()` instead, every join would silently miss.
 *
 * @see gps-plus-slam-app-framework/ar/qr-derived-pose — the consumer of `resolveDepthAt`.
 * @see qr-debug-controller.ts — drives `append` + renders the derived placement.
 */

// Deep subpaths (NOT the `…/ar` barrel) — avoid pulling heavy transitive deps
// into main.ts's partially-mocked wiring tests (see qr-debug-view's rationale).
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';
import { createDepthGridLookup } from 'gps-plus-slam-app-framework/ar/depth-grid-lookup';
import type { QrSizeDepthContext } from 'gps-plus-slam-app-framework/ar/qr-size-measurer';
import type { DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';

/** Default cap on retained depth samples — matches the recorder QR history (100). */
const DEFAULT_QR_DEPTH_HISTORY = 100;

export interface QrDepthResolver {
  /**
   * Add one recorded depth sample to the history (oldest dropped past the cap).
   * Idempotent on identity: appending the same sample object twice is a no-op,
   * so a store subscriber can call it on every change without de-duping itself.
   */
  append(sample: DepthSample): void;
  /**
   * The depth context active at `timestamp` (the latest sample with
   * `sample.timestamp ≤ timestamp`), or `null` when no such sample exists or it
   * lacks a usable projection (no unprojector). Best-effort — never throws.
   */
  resolveDepthAt(timestamp: number): QrSizeDepthContext | null;
  /** Drop all retained samples (e.g. on session end / replay reset). */
  reset(): void;
}

/**
 * Build a {@link QrSizeDepthContext} from one depth sample, or `null` when it has
 * no projection matrix / a singular one (the unprojector cannot be built). The
 * grid lookup is bilinear (depth varies smoothly across a small QR face).
 */
function contextFromSample(sample: DepthSample): QrSizeDepthContext | null {
  const unprojector = createDepthUnprojector(
    sample.cameraPos,
    sample.cameraRot,
    sample.projectionMatrix
  );
  if (!unprojector) return null;
  const lookup = createDepthGridLookup(sample.points);
  return {
    unprojector,
    depthAt: (x, y) => lookup.depthAt(x, y),
  };
}

/**
 * Create an as-of depth resolver. Samples are expected to arrive in roughly
 * non-decreasing timestamp order (the capture/replay cadence), but the lookup
 * scans for the latest `≤ timestamp` regardless of insertion order, so a
 * momentarily out-of-order append is tolerated.
 */
export function createQrDepthResolver(options?: {
  maxSamples?: number;
}): QrDepthResolver {
  const maxSamples = options?.maxSamples ?? DEFAULT_QR_DEPTH_HISTORY;
  let samples: DepthSample[] = [];
  let last: DepthSample | null = null;

  return {
    append(sample: DepthSample): void {
      if (sample === last) return; // same object → already recorded
      last = sample;
      samples.push(sample);
      if (samples.length > maxSamples) {
        samples = samples.slice(samples.length - maxSamples);
      }
    },
    resolveDepthAt(timestamp: number): QrSizeDepthContext | null {
      // Latest sample at or before the query timestamp (the as-of join).
      let best: DepthSample | null = null;
      for (const s of samples) {
        if (s.timestamp <= timestamp) {
          if (!best || s.timestamp > best.timestamp) best = s;
        }
      }
      return best ? contextFromSample(best) : null;
    },
    reset(): void {
      samples = [];
      last = null;
    },
  };
}
