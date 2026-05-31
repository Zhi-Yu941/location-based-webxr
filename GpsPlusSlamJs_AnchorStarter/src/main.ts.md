# `main.ts` — application entry (glue)

- **Purpose:** The "framework wiring — don't touch" layer. Composes the tested
  seams into the persistent-anchor flow: capability gate → AR boot on a user
  gesture → GPS/orientation wiring → onboarding coaching → soft-gated
  placement (cache-miss) or seed-and-re-converge (cache-hit).
- **Public API:** none (side-effecting entry). Editable seam is
  `createAnchorMarker()` in [marker.ts](marker.ts), imported under the clearly
  marked `--- your content here ---` banner.
- **Key flow:**
  - `main()` probes `checkWebXRSupport` + `checkGeolocationPermission`; if not
    fully supported, shows `capabilityMessage` (E1) and disables Start.
  - `startAr()` (user gesture): `createSlamAppStore({ NullStorageBackend })` →
    `setTrackingStore` → `initAR` → `startSession` (so the GPS coordinator
    feeds alignment) → `createGpsPositionHandler` + `startGpsWatch` →
    `requestDeviceOrientationPermission` + `startOrientationWatch` →
    `loadAnchor()` → `dispatchSetup(BOOTED)`.
  - `placeAnchor()` (cache-miss): `PLACE_REQUESTED` (saving) →
    `spawnAnchor(gps, false)` + `saveAnchor(gps)` → `PLACE_SUCCEEDED`, or
    `PLACE_FAILED` on error (revert + error line).
  - `spawnAnchor()` builds `createGpsAnchor` with `getAlignmentMatrix` /
    `getGpsZeroRef` / `getCurrentGpsPoint` bound to the live store + last GPS.
- **Invariants & assumptions:**
  - Selectors are run via the `sel()` helper which casts the store state per
    selector (only the read slices exist at runtime — same pattern as the
    MinimalExample).
  - `createGpsAnchor` self-registers its frame update, so the anchor ticks on
    the AR render loop automatically.
  - `lastGps` always carries a finite altitude (defaults to `0`) so the anchor
    seed is a well-formed `LatLongAlt`.
- **Tests:** glue is verified manually via `pnpm dev` on an AR device. The
  decision logic it composes is unit-tested in the sibling modules
  ([setup-state-machine](setup-state-machine.ts.md),
  [anchor-storage](anchor-storage.ts.md),
  [guidance-view](guidance-view.ts.md), [placement-view](placement-view.ts.md),
  [capability](capability.ts.md), [marker](marker.ts.md)).
