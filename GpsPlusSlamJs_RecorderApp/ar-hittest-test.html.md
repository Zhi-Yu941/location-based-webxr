# `ar-hittest-test.html` — WebXR feature combinator / crash reproducer

## Purpose

Standalone, no-framework WebXR page used to bisect the Android Chrome 147+
`camera-access` renderer crash (`CrRendererMain` SIGSEGV ~1–2 s after entering
AR — crbug.com/507508099, three.js #33404). It lets you toggle individual
WebXR session features and workarounds independently and re-enter AR, so a
device technician can find the minimal combination that crashes (or survives)
on a given Chrome build.

It intentionally **inlines its own copy** of the two production workarounds
rather than importing the framework helper, so each workaround can be toggled
on/off independently on any Chrome build without rebuilding the framework.

## Public surface (UI toggles)

All state persists to `sessionStorage` under key
`webxr-feature-combinator-v1` and survives the reloads that the workaround
toggles trigger.

- **Required feature** (radio): `hit-test` (default) or `local-floor` — chooses
  the single `requiredFeatures` entry for `requestSession`.
- **Optional features** (checkboxes, change → reload not needed, only affects
  next session init):
  - `camera-access`
  - `dom-overlay`
  - `depth-sensing` (cpu-optimized, `luminance-alpha`/`float32`)
- **Per-frame camera usage** (checkbox, render-loop flag, no reload):
  - `camera-texture-read` — when on AND `camera-access` is granted, the
    animation loop calls `renderer.xr.getCameraTexture(view.camera)` every
    frame. That call lazily triggers `XRWebGLBinding.getCameraImage()` inside
    three.js — the exact null-deref surface the production apps exercise and
    the plain reproducer otherwise skips. Requesting `camera-access` alone
    never reads the camera image, which is why a page that only requests the
    feature can survive while the apps crash.
- **Workarounds** (checkboxes, change → page reload, applied from
  `sessionStorage` before three.js is imported):
  - `projection-layer-workaround` ("deletes") — delete
    `XRWebGLBinding.prototype.createProjectionLayer` and
    `XRRenderState.prototype.layers` to force `XRWebGLLayer`.
  - `baselayer-persistence-workaround` — wrap
    `XRSession.prototype.updateRenderState` to persist the last `baseLayer`
    and merge it back as `{ baseLayer: lastBaseLayer, ...init }`.

## Invariants & assumptions

- Workaround toggles MUST be applied before `three` is imported; they are read
  from `sessionStorage` in an early `<script type="module">` block, which is
  why toggling them reloads the page.
- `camera-texture-read` is a pure render-loop flag: toggling it takes effect on
  the next animation frame without a reload and without re-requesting the
  session.
- `readCameraTextureForCrashRepro()` logs the camera-grant status **once per
  AR session** (reset in `rebuildArButton`) and caps null-texture logs at 5 to
  avoid flooding the on-screen log.
- `getCameraTexture()` itself is the "read" that materializes the camera image;
  there is no need to bind the texture to a material/quad.
- The page is served by the site build under `/recorder/ar-hittest-test.html`
  (`build-site.mjs` asserts the file exists and contains no bare-absolute
  URLs). Keep asset references relative.

## Example: confirm the per-frame camera read is the crash trigger

Authoritative on-device matrix (from the investigation):

- Chrome `148.0.7778.215`: needs BOTH deletes + baseLayer patch to survive a
  session; with `camera-texture-read` ON it additionally exercises the
  per-frame camera-image path.
- Chrome `150.0.7871.3`: needs deletes ONLY.

Bisection recipe: enable `camera-access` + `camera-texture-read`, then toggle
`depth-sensing` and `dom-overlay` independently to isolate which feature
combination crashes on the target build.

## Tests

No automated tests — this is a manual, on-device reproducer (a real Android
device with the target Chrome build and AR support is required; desktop/CI
cannot enter `immersive-ar`). Verification is the on-device crash/no-crash
observation logged in
`GpsPlusSlamJs_Docs/docs/2026-06-04-0458-camera-access-crash-regression-chrome-148.md`.
