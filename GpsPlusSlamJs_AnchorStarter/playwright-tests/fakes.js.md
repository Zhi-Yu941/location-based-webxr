# `fakes.js` — Tier 1 e2e seam fakes & control surface

## Purpose

Install deterministic fakes over the app's DEV-only test seam
(`window.__anchorStarterSeams`) plus a control surface
(`window.__anchorStarterTest`) so Playwright can drive the full application
flow (boot → guidance → soft-gated placement → `?show=` round-trip →
copy-link) without real WebXR or GPS. See the plan
[`2026-06-01-anchor-starter-e2e-test-plan.md`](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-anchor-starter-e2e-test-plan.md)
§5–§6 and the seam itself in [`../src/seams.ts`](../src/seams.ts) /
[`../src/seams.ts.md`](../src/seams.ts.md).

## Public API

- `installAnchorStarterFakes(page, options?)` — installs the seam + control
  surface via `page.addInitScript`. MUST run **before** `page.goto('/')`.
  - `options.trackingReport` — initial `TrackingQualityReport` the faked
    `selectTrackingQuality` returns (defaults to an `ok`/ready report). Read
    lazily on every render, so `phase` is fully controllable.
  - `options.failClipboard` — override `navigator.clipboard.writeText` to
    reject, exercising the copy-link failure path.
  - `options.failOrientationPermission` — make the faked
    `requestDeviceOrientationPermission` reject, exercising the post-`initAR`
    boot rollback (`failStart`) path. Also mutable via the control surface.
- `bootAnchorStarter(page)` — `goto('/')`, click Start, wait until the
  guidance + placement panels are visible.
- `pushGpsFix(page, fix)` — drive one GPS fix through the stashed watch
  callback (`fix = { lat, lon, altitude?, accuracy? }`).

## Control surface (`window.__anchorStarterTest`)

- `gpsCallback` — the callback stashed by the faked `startGpsWatch`.
- `markerCalls` — array of `MarkerOptions` captured on each
  `createAnchorMarker` call (used to assert the cache-hit decode).
- `worldGroupChildren` — markers currently attached to the faked AR world
  group. `spawnAnchor` adds a marker before creating the `GpsAnchor` and must
  remove it again on any failure; specs assert this stays empty after a failed
  placement (no orphaned mesh left to overlap a retry).
- `trackingReport` — mutable; mutate to change the onboarding phase mid-test.
- `trackingStoreWired` / `trackingCallbacksWired` — booleans set by the faked
  `initAR` from the `callbacks.tracking` group it receives (store present /
  `onRestarted` is a function). A spec asserts both became `true` during boot:
  since the framework's setter fold the store + restart callback arrive
  TOGETHER in that group, and dropping it silently pins the onboarding
  guidance to "AR tracking lost" (regression guard).
- `failCreateAnchor` — set true to make the faked `createGpsAnchor` throw
  (placement-failure revert path).
- `failOrientationPermission` — mutable; when true the faked
  `requestDeviceOrientationPermission` rejects, triggering the `failStart`
  boot-rollback path.
- `endARSessionCalls` — counter incremented on each `endARSession` call;
  lets a spec assert the rollback path tears down the framework session.
- `pushGps(fix)` — invoke the stashed GPS callback with a well-formed
  `GpsPosition`.

## Invariants & assumptions

- The fakes are **duck-typed**: because `createGpsAnchor`/`createAnchorMarker`
  are faked, the fake AR world-group, camera (`{}`) and marker (`{}`) need no
  real THREE objects. The world group implements `add`/`remove` over the shared
  `worldGroupChildren` array (by object identity) so specs can assert markers
  are removed on a failed placement.
- `startGpsWatch`'s callback is stashed, not invoked — the spec pushes fixes on
  demand. The app's real GPS coordinator early-returns (no AR pose) but
  `main.ts` still records `lastGps`, which is all soft-gated placement needs.
- Only active under `pnpm dev` (DEV=true, VITEST unset); the seam is statically
  stripped from production builds.

## Tests

Consumed by [`placement-flow.spec.js`](placement-flow.spec.js) and
[`share-link.spec.js`](share-link.spec.js). Run via `pnpm run test:e2e`
(never `npx playwright` directly).
