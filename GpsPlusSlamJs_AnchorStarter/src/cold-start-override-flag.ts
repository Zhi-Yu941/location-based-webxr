/**
 * Toggle for the library's Phase-4 Stage-0 cold-start compass yaw override.
 * Stage 0 is a default-ON feature, so this reader defaults to enabled; a field
 * tester can opt OUT without a rebuild via `?coldStartOverride=0` (or `=false`)
 * — e.g. to capture §6a calibration recordings with the compass unmodified.
 *
 * The value is passed to `createSlamAppStore({ enableCompassColdStartOverride })`
 * (the framework option dispatches the library's `setColdStartOverrideEnabled`
 * once a GPS fix establishes the `gpsData` slice). See
 * GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md.
 */

/** True unless the `coldStartOverride` query param explicitly opts out (`0`/`false`). */
export function coldStartOverrideEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get("coldStartOverride");
  return value !== "0" && value !== "false";
}
