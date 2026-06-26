/**
 * Debug toggle for the library's Phase-4 Stage-0 cold-start compass yaw
 * override. Reads `?coldStartOverride=1` (or `=true`) from the page URL so a
 * field tester can enable the experimental override without a rebuild.
 *
 * The value is passed to `createSlamAppStore({ enableCompassColdStartOverride })`
 * (the framework option dispatches the library's `setColdStartOverrideEnabled`
 * once a GPS fix establishes the `gpsData` slice). Default OFF — the core solve
 * is unchanged. See
 * GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md.
 */

/** True iff the `coldStartOverride` query param is `1` or `true`. */
export function coldStartOverrideEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get("coldStartOverride");
  return value === "1" || value === "true";
}
