# `GpsPlusSlamJs_Landing/index.html` — root landing page

## Purpose

The static landing page served at the **root** (`/`) of `gps.csutil.com`. It
gives a one-paragraph pitch of the GPS+SLAM location-based-WebXR framework and
routes visitors to the deployed apps that share the origin, each labelled
by name:

- **"Anchor Starter Demo"** → `/starter/` (the `GpsPlusSlamJs_AnchorStarter` app).
- **"Minimal Example"** → `/minimal/` (the `GpsPlusSlamJs_MinimalExample` app).
- **"QR-Tracking Demo"** → `/qr-demo/` (the `GpsPlusSlamJs_QrTrackingDemo` app).
- **"Recorder"** → `/recorder/` (the `GpsPlusSlamJs_RecorderApp`).

It is the third surface of the multi-app subpath deployment described in
[2026-06-01-multi-app-subpath-deployment-plan.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-multi-app-subpath-deployment-plan.md)
(Step 4).

## Public API

None — it is a single self-contained HTML document. All CSS is inlined; there
is **no build step, no JavaScript, and no dependencies**. The build-site
orchestration (`scripts/build-site.mjs`, Step 5) copies this file verbatim to
`dist-site/index.html`.

## Invariants & assumptions

- **Absolute subpath links.** The buttons link to `/starter/`, `/minimal/`,
  `/qr-demo/`, and `/recorder/` (root-absolute, with trailing slash). These are
  deployment URLs on the shared origin, not Vite-processed paths, so they are
  written literally and are **not** rewritten by any base-path logic.
- **Zero dependencies / no bundler.** Keeping the page pure static HTML+CSS is a
  deliberate decision (plan Q3) so the framework pitch is trivial to keep up to
  date and loads instantly.
- **Trailing slashes matter.** Linking to `/starter/` (not `/starter`) makes the
  static-asset server serve the nested `index.html` directly without relying on
  a redirect (see plan Step 5/Q2).

## Examples

Open the file directly in a browser to preview; the buttons will 404 locally
unless the sibling apps are also served under `/starter/`, `/minimal/`, and
`/recorder/`.
End-to-end it is exercised by serving the combined `dist-site/` output and
clicking through landing → starter → recorder (plan Step 5 verification).

## Tests

No unit test — it is static markup with no logic. Its links are covered by the
build-site tree assertion (the `index.html` file must exist at the `dist-site`
root) and by the manual click-through smoke check in plan Steps 5 and 7.
