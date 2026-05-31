/**
 * Pure capability-gating helpers for the E1 "try anywhere" fallback
 * (decision D5 / Finding 5). The async feature probing lives in `main.ts`
 * (it calls the framework's `checkWebXRSupport` / `checkGeolocationPermission`);
 * the *decision* and the user-facing copy are pulled out here so they can be
 * unit-tested without a browser.
 */

export interface CapabilitySupport {
  /** Browser supports a WebXR `immersive-ar` session. */
  readonly webxr: boolean;
  /** Geolocation API is available. */
  readonly geolocation: boolean;
}

/** True only when both AR and GPS are available — the demo can run. */
export function isFullySupported(support: CapabilitySupport): boolean {
  return support.webxr && support.geolocation;
}

/**
 * Build the capability-gated message shown when the demo cannot run. Names
 * exactly which capabilities are missing so the user understands *why*, and
 * always points them at the supported environment (an AR phone, outdoors).
 * Returns `null` when everything is supported (no message needed).
 */
export function capabilityMessage(support: CapabilitySupport): string | null {
  if (isFullySupported(support)) return null;

  const missing: string[] = [];
  if (!support.webxr) missing.push('WebXR augmented reality');
  if (!support.geolocation) missing.push('GPS / geolocation');

  return (
    `This demo needs ${missing.join(' and ')}, which this device or browser ` +
    `does not provide. Open it on an AR-capable phone (e.g. Chrome on ` +
    `Android with ARCore), outdoors, to try the persistent-anchor flow.`
  );
}
