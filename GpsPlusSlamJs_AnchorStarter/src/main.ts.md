# `main.ts` — application entry (glue)

- **Purpose:** The "framework wiring — don't touch" layer. Composes the tested
  seams into the persistent-anchor flow: capability gate → AR boot on a user
  gesture → GPS/orientation wiring → onboarding coaching → soft-gated
  placement (cache-miss) or seed-and-re-converge (cache-hit).
- **Public API:** none (side-effecting entry). Editable seam is
  `createAnchorMarker()` in [marker.ts](marker.ts), imported under the clearly
  marked `--- your content here ---` banner.
- **Test seam:** every framework call site (`initAR`, `getArWorldGroup`,
  `getCamera`, `startGpsWatch`, `startOrientationWatch`,
  `requestDeviceOrientationPermission`, `createGpsAnchor`,
  `enableArWorldGroupAlignment`, `selectTrackingQuality`,
  `selectAlignmentMatrix`, `startReticleHitTest`,
  `checkWebXRSupport`, `checkGeolocationPermission`, `createAnchorMarker`) is
  resolved through `getSeams()` from [seams.ts](seams.ts.md) instead of being
  called directly. In production `getSeams()` returns the real imports; the
  DEV-only `window.__anchorStarterSeams` override lets the Tier 1 Playwright e2e
  suite drive the real placement → `?show=` → copy-link glue without WebXR. See
  the prod-inert guarantee in [seams.ts.md](seams.ts.md).
- **Key flow:**
  - `main()` probes `checkWebXRSupport` + `checkGeolocationPermission`; if not
    fully supported, shows `capabilityMessage` (E1) and disables Start.
  - `startAr()` (user gesture): `createSlamAppStore({ NullStorageBackend })` →
    `setTrackingStore` → `initAR` (with the camera/depth crash-surface flags
    `enableCameraAccess` / `enableDepthSensingFeature` /
    `enableCameraTextureAcquisition` set to `false`, and `requestHitTest: true`
    in the session-features arg so the cache-miss reticle works; this example
    places 3D anchors under a screen-centre hit-test reticle and never reads the
    camera image; `dom-overlay` / CSS3D stay on for the overlay UI) →
    `startSession` (so the GPS coordinator
    feeds alignment) → `enableArWorldGroupAlignment({ store, arWorldGroup })`
    (lerps the alignment onto `arWorldGroup` so the camera + anchor ride it
    together — GPS-registers the view, without which the camera is pure-VIO) →
    `createGpsPositionHandler` + `startGpsWatch` →
    `requestDeviceOrientationPermission` + `startOrientationWatch` →
    wire `placeButton` + `copyLinkButton` clicks →
    `readCachedAnchor()` → on a **cache-miss** start the reticle loop
    (`startReticleHitTest({ arWorldGroup })`); on a **cache-hit** spawn the
    saved anchor (`skipBootstrap` + `hideUntilAligned`) → `dispatchSetup(BOOTED)`.
  - `placeAnchor()` (cache-miss): gated by `decideAnchorPlacement` — a press
    only commits when a surface is under the reticle AND a GPS alignment exists,
    else it surfaces a hint via `PLACE_BLOCKED` (stays placeable, no `saving`).
    On a valid press: `PLACE_REQUESTED` (saving) →
    `spawnAnchor(gps, false, {}, { worldPosition, onBootstrapComplete })` places
    the marker at the reticle world pose and starts the bootstrap. `?show=` is
    **not** written here — it is persisted from the committed bootstrap median
    via `onBootstrapComplete`, which also disposes the reticle and dispatches
    `PLACE_SUCCEEDED`. So `saving` holds until the median lands and `saved`
    reflects the durable URL write (per the repo async-UX rule). A throw during
    spawn → `PLACE_FAILED` (revert + error line) and `dispose()`s any partially
    created `anchor` so a retry can never accumulate overlapping markers.
  - `spawnAnchor()` builds `createGpsAnchor` with `getAlignmentMatrix` /
    `getGpsZeroRef` bound to the live store, and `getCurrentGpsPoint` bound to
    the marker's own **GPS-world (NUE) world pose** via `worldNueToGps`. Its
    optional `{ worldPosition }` places the marker at the reticle hit point
    (world→`arWorldGroup`-local); `{ onBootstrapComplete }` is forwarded to the
    anchor so the cache-miss path can persist the committed median into `?show=`.
    It adds the marker to the AR world group _before_ `createGpsAnchor`; if
    creation throws it removes the marker again, and it wraps the returned
    `dispose()` so disposing the anchor also detaches its marker (the
    framework `dispose()` only unregisters the frame-loop tick — see
    [gps-anchor](../../GpsPlusSlamJs_AppFramework/src/visualization/gps-anchor.ts.md)).
    This makes `anchor.dispose()` a complete teardown for every caller
    (placement retry, `failStart` boot rollback, `beforeunload`). Its optional
    `{ hideUntilAligned }` flag (used by the `?show=` cache-hit) keeps the marker
    hidden until the first non-null alignment arrives, then reveals it at its
    computed pose — so a `skipBootstrap` reload never flashes the marker at the
    AR origin before it jumps to its real spot (Q4). The reveal subscription is
    torn down on first reveal and on `dispose()`.
- **Invariants & assumptions:**
  - Selectors are run via the `sel()` helper which casts the store state per
    selector (only the read slices exist at runtime — same pattern as the
    MinimalExample).
  - `createGpsAnchor` self-registers its frame update, so the anchor ticks on
    the AR render loop automatically.
  - `lastGps` always carries a finite altitude (defaults to `0`) so the anchor
    seed is a well-formed `LatLongAlt`.
  - **Cache-miss bootstrap source is the marker's own world pose**
    (`getCurrentGpsPoint` → `worldNueToGps(marker.getWorldPosition(), zero)`),
    matching the MinimalExample — the marker is positioned at the reticle hit
    point, so the anchor commits to the point the user aimed at, not the device.
    This works only because `enableArWorldGroupAlignment` makes the marker's
    world position GPS-world NUE. The persisted `?show=` is the **committed
    bootstrap median** (via `onBootstrapComplete`), so the shared link equals
    the anchor's committed reference by construction and stays correct across
    re-bootstraps. (Cache-hit uses `skipBootstrap`, so its `getCurrentGpsPoint`
    is never sampled and the URL GPS is the decoded one.)
- **Tests:** glue is verified manually via `pnpm dev` on an AR device. The
  decision logic it composes is unit-tested in the sibling modules
  ([setup-state-machine](setup-state-machine.ts.md),
  [placement-decision](placement-decision.ts.md),
  [url-anchor-state](url-anchor-state.ts.md),
  [guidance-view](guidance-view.ts.md), [placement-view](placement-view.ts.md),
  [capability](capability.ts.md), [marker](marker.ts.md)). The reticle loop
  ([reticle-hit-test](reticle-hit-test.ts.md)) is device-only glue. The
  placement glue — including the reticle gate (place when a surface is present,
  hint when not) and the failure cleanup that prevents leaked / overlapping
  markers — is covered end-to-end by the Tier 1 Playwright suite
  (`playwright-tests/placement-flow.spec.js`).
