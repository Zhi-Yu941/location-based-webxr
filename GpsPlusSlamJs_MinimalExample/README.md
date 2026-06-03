# gps-plus-slam minimal example

The smallest end-to-end consumer of
[`gps-plus-slam-app-framework`](../GpsPlusSlamJs_AppFramework/) — a single-file
Vite app that boots `createSlamAppStore()`, then enters a **GPS + AR hit-test**
session: an app-rendered "Enable GPS AR" button starts an immersive-ar session
and a reticle tracks real-world surfaces under the screen centre.

It is a structural port of the stock three.js `webxr_ar_hittest` example
(button → AR session → reticle → tap-to-place), adapted for the GPS-aligned
framework. The full design rationale lives in the plan doc
[2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md).

## The two framework deltas (what a porting developer must not get wrong)

1. **App-rendered button.** Unlike three.js' `ARButton` (which injects its own
   DOM), the framework exposes the permission / enter-AR *sequence* as a
   headless controller (`createEnableGpsArController`). The app renders and
   styles its **own** `<button>` over the controller's observable state.
2. **Parenting.** Placed AR content (here, the reticle) is added under
   `getArWorldGroup()` (AR-local space), **not** the GPS-aligned scene root
   (`getScene()`). This is the single most important line to get right.

## What you'll see (the contrast demo)

The example is a teaching ladder that ends in a deliberate side-by-side
comparison. Once AR is running and the first GPS fix has arrived, **tap** to
place two markers at the same real-world spot:

- an **orange cube** parented to the GPS-aligned `scene` root with **no drift
  compensation** — the _intentional floater_. As SLAM tracking and GPS disagree
  over time it visibly slides away from where you placed it.
- a **green sphere** anchored with `createGpsAnchor` under `arWorldGroup`. It
  holds the tapped pose while it samples GPS (default bootstrap), then makes a
  single lazy correction to the GPS median **while off-screen**
  (`snap-when-offscreen`) — so it stays put from the user's point of view.

Taps before the first GPS fix are ignored with a brief "waiting for GPS…" hint,
so both markers always start from the same known global pose.

## Why this exists

1. **Onboarding scaffold.** The full
   [recorder app](../GpsPlusSlamJs_RecorderApp/) is too big to read as
   a "hello world". This example is intentionally minimal so the AR wiring is
   obvious. For the next step up — a readable AR + GPS + persistence demo — see
   the [`GpsPlusSlamJs_AnchorStarter`](../GpsPlusSlamJs_AnchorStarter/) starter
   (minimal → **starter** → full).
2. **Anonymous-install proof.** The package declares only
   `gps-plus-slam-app-framework: workspace:*` for the sibling package — a clean
   `pnpm install` at the public-repo root that successfully resolves the
   framework.

## Run it

```bash
# from the public repo root
pnpm install
pnpm --filter gps-plus-slam-minimal-example dev
```

Then open the printed URL **on an AR-capable device** (e.g. an Android phone
with WebXR / immersive-ar). On unsupported devices the button stays disabled
with an explanatory label.

## Layout

- [index.html](index.html) — bare entry: status panel, AR container
  (`#ar-root`) and the "Enable GPS AR" button.
- [src/main.ts](src/main.ts) — WebXR glue: button wiring over the controller,
  hit-test source + reticle loop (verified manually on-device).
- [src/reticle.ts](src/reticle.ts) — pure reticle view-model (unit-tested in
  [src/reticle.test.ts](src/reticle.test.ts)).
- [src/placement.ts](src/placement.ts) — pure tap-to-place view-model: the GPS
  gate + the deliberate scene-root floater (unit-tested in
  [src/placement.test.ts](src/placement.test.ts)).
- [src/co-spawn.ts](src/co-spawn.ts) — pure contrast co-spawn: places the
  floater cube and a `createGpsAnchor` marker at the same world pose under
  different parents (unit-tested in [src/co-spawn.test.ts](src/co-spawn.test.ts)).
- [src/status.ts](src/status.ts) — pure formatter for the status text
  (unit-tested in [src/status.test.ts](src/status.test.ts)).
- [src/boot.test.ts](src/boot.test.ts) — headless smoke test that the framework
  imports resolve and `createSlamAppStore({ NullStorageBackend })` boots
  (keeps CI AR-hardware-free).
