/**
 * Capability gate for the QR-tracking demo.
 *
 * The demo needs **WebXR immersive-AR** to run at all; **depth-sensing** is
 * optional — without it the auto-size path is unavailable and the app falls
 * back to a manually-entered size (Note 4 "gate the auto-size feature on depth
 * support; without it fall back"). GPS is NOT needed (the demo is geo-less).
 *
 * Pure functions over a plain support object so the gate is unit-testable
 * without touching `navigator.xr`.
 */

export interface DemoCapabilitySupport {
  /** `navigator.xr` immersive-AR session support — required. */
  webxr: boolean;
  /** WebXR depth-sensing support — optional (auto-size needs it). */
  depthSensing: boolean;
}

/** True when the demo can run at all (WebXR present). */
export function isDemoSupported(support: DemoCapabilitySupport): boolean {
  return support.webxr;
}

/**
 * A human message for the start screen, or `null` when everything the demo
 * needs is present. A WebXR-less browser blocks; a depth-less but WebXR-capable
 * browser runs with a non-blocking note about the manual-size fallback.
 */
export function capabilityMessage(
  support: DemoCapabilitySupport,
): string | null {
  if (!support.webxr) {
    return "This demo needs WebXR immersive-AR (Android Chrome). Open it on a supported device.";
  }
  if (!support.depthSensing) {
    return "Depth sensing is unavailable — auto-sizing is off; enter the QR size manually.";
  }
  return null;
}
