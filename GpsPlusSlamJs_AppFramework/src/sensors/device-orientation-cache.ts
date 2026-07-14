/**
 * Module-level cache of the latest `RawDeviceOrientation` reading from the
 * DeviceOrientationEvent watch.
 *
 * Moved here from `state/gps-event-coordinator.ts` (2026-07-10,
 * quality-review G-8): the cache is a sensor concern — `ar/webxr-session`
 * used to consume it through a state-module import, an ar→state dependency
 * inversion. Note that `sensors/absolute-orientation.ts` keeps its own
 * separate cache for the AbsoluteOrientationSensor stream; these are
 * different sensors feeding different fields, by design.
 */

import type { RawDeviceOrientation } from './gps';

let lastDeviceOrientation: RawDeviceOrientation | null = null;

/**
 * Update the cached device orientation.
 * Called by the host's orientation watch; read when a GPS event arrives and
 * by the XR frame loop's orientation snapshot.
 */
export function updateDeviceOrientation(
  orientation: RawDeviceOrientation
): void {
  lastDeviceOrientation = orientation;
}

/** Get the current cached device orientation (null before the first reading). */
export function getLastDeviceOrientation(): RawDeviceOrientation | null {
  return lastDeviceOrientation;
}

/** Clear the cache (testing / session reset). */
export function resetDeviceOrientationCache(): void {
  lastDeviceOrientation = null;
}
