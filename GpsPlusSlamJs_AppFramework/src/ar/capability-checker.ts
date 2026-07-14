/**
 * Pure capability-gating helpers, promoted from the AnchorStarter app so the
 * minimal AR example and AnchorStarter share the *decision* and *message*
 * without sharing app-specific copy.
 *
 * The async feature probing (`isWebXRSupported()` / geolocation availability)
 * stays in each app's `main.ts`; only the browser-free decision and the
 * user-facing message live here so they can be unit-tested without a browser.
 *
 * See `2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md` §6.4.
 */

/** The two capabilities every GPS+AR demo requires to run. */
export interface CapabilitySupport {
  /** Browser supports a WebXR `immersive-ar` session. */
  readonly webxr: boolean;
  /** Geolocation API is available. */
  readonly geolocation: boolean;
}

/** Options that let an app flavour the otherwise-neutral gating message. */
export interface CapabilityMessageOptions {
  /**
   * App-specific "what this demo lets you do" phrase, appended as
   * `…outdoors, to try ${contextLabel}.`. Omit for a neutral message that
   * ends at `…outdoors.`. Example: `'the persistent-anchor flow'`.
   */
  readonly contextLabel?: string;
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
 *
 * The trailing "to try …" clause is app-specific and supplied via
 * `options.contextLabel`; without it the message ends neutrally at
 * "…outdoors.".
 */
export function capabilityMessage(
  support: CapabilitySupport,
  options: CapabilityMessageOptions = {}
): string | null {
  if (isFullySupported(support)) return null;

  const missing: string[] = [];
  if (!support.webxr) missing.push('WebXR augmented reality');
  if (!support.geolocation) missing.push('GPS / geolocation');

  const suffix = options.contextLabel ? `, to try ${options.contextLabel}` : '';

  return (
    `This demo needs ${missing.join(' and ')}, which this device or browser ` +
    `does not provide. Open it on an AR-capable phone (e.g. Chrome on ` +
    `Android with ARCore), outdoors${suffix}.`
  );
}
