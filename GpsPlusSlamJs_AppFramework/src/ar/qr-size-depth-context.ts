/**
 * `createQrSizeDepthContext` — build a {@link QrSizeDepthContext} (unprojector +
 * bilinear depth-grid lookup) from one {@link DepthSample}.
 *
 * This is the **shared** depth-context constructor for the QR sizing path. Both
 * consumers used to wire it independently:
 *   - the QR-tracking demo's `seams.getDepthContext` (live latest sample), and
 *   - the Recorder live-QR `qr-depth-resolver.contextFromSample` (as-of join).
 * They were byte-for-byte the same `createDepthUnprojector` +
 * `createDepthGridLookup` + `depthAt` wiring — a divergence risk (e.g. one
 * switching nearest↔bilinear would silently make the two apps measure different
 * QR sizes). Centralizing it here keeps them identical by construction; each
 * consumer composes whatever extra it needs on top (the demo adds `cameraPose` +
 * `projectionMatrix` for the PnP intrinsics).
 *
 * Deep-imported via `…/ar/qr-size-depth-context` (NOT the `…/ar` barrel) so the
 * Recorder's partially-mocked wiring tests don't pull heavy transitive deps —
 * same rationale as `qr-depth-resolver` / `qr-debug-view`.
 *
 * @see qr-size-measurer.ts — the `QrSizeDepthContext` consumer (size measurement).
 * @see depth-unprojection.ts / depth-grid-lookup.ts — the pieces this composes.
 */

import { createDepthUnprojector } from './depth-unprojection.js';
import { createDepthGridLookup } from './depth-grid-lookup.js';
import type { QrSizeDepthContext } from './qr-size-measurer.js';
import type { DepthSample } from '../types/ar-types.js';

// Re-exported so a consumer can get the value + its type from one subpath.
export type { QrSizeDepthContext };

/**
 * Build a {@link QrSizeDepthContext} from one depth sample, or `null` when it has
 * no projection matrix / a singular one (the unprojector cannot be built). The
 * grid lookup is **bilinear** (depth varies smoothly across a small QR face,
 * rather than snapping to one nearest node). Best-effort — never throws.
 */
export function createQrSizeDepthContext(
  sample: DepthSample
): QrSizeDepthContext | null {
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
