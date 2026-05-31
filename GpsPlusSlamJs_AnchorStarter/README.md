# GPS-Plus-SLAM — Persistent Anchor Starter

A **meaningful minimal** example for the
[`gps-plus-slam-app-framework`](../GpsPlusSlamJs_AppFramework/README.md): the
smallest readable app that demonstrates the framework's actual value
proposition — a **GPS-anchored object that is visibly stable and persists
across a page reload**.

It is the middle rung of the example ladder:

- **trivial:** [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/README.md)
  — resolve-and-run proof (no AR, no GPS, no persistence).
- **starter (this app):** one persistent GPS anchor, AR + GPS + onboarding
  coaching + `localStorage` persistence.
- **full:** [`GpsPlusSlamJs_RecorderApp`](../GpsPlusSlamJs_RecorderApp/README.md)
  — the complete product (routing, scenarios, ref-points, replay, recording).

## User story

1. Go outside with an AR-capable phone. The app coaches you to **move around**
   until alignment is good enough (a "N% ready" meter).
2. Place a **GPS anchor** (a marker) in the real world. Its coordinates are
   saved to `localStorage`.
3. **Reload the page.** Move around again to re-localise; the saved marker
   reappears at the exact same physical spot — proving cross-session
   persistence.

## Run it

```bash
cd GpsPlusSlamJs_AnchorStarter
pnpm install
pnpm dev          # Vite dev server on http://localhost:5181
```

Open the URL on an **AR-capable phone** (e.g. Chrome on Android with ARCore),
outdoors. On a device without WebXR/GPS the app shows an honest
capability-gated message instead of crashing (decision E1).

```bash
pnpm test         # typecheck + unit tests
```

## How it is structured

The app deliberately separates **framework wiring (don't touch)** from **your
content (replace)**:

- **Pure, unit-tested logic** (copyable building blocks):
  - [`setup-state-machine.ts`](src/setup-state-machine.ts.md) — the
    pedagogical core: an explicit FSM for the sequential setup
    (cache-miss → place/save; cache-hit → relocalise/show).
  - [`anchor-storage.ts`](src/anchor-storage.ts.md) — inline `localStorage`
    persistence (round-trip + validate-and-clamp; bad JSON → "no cached
    anchor", never throws).
  - [`guidance-view.ts`](src/guidance-view.ts.md) /
    [`placement-view.ts`](src/placement-view.ts.md) — pure view-models that
    map the framework metric + FSM to render-ready strings (the async-UX
    in-progress → final contract is tested here).
  - [`capability.ts`](src/capability.ts.md) — the E1 decision + message.
- **Glue:** [`main.ts`](src/main.ts.md) — composes the seams with `initAR`,
  `createGpsPositionHandler`, `createGpsAnchor`, GPS/orientation watches.
- **Your content here:** [`marker.ts`](src/marker.ts.md) — the **single**
  place to edit. Swap `createAnchorMarker()` for your own `THREE.Object3D`
  and the persistence + anchoring keep working unchanged.

## Design decisions

This app implements the decisions recorded in the planning doc
[`2026-05-31-student-onboarding-anchor-example-user-feedback.md`](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-student-onboarding-anchor-example-user-feedback.md):

- **D2 — inline persistence:** `localStorage` lives in this app, not the
  framework (kept maximally copyable).
- **D3 — reusable guidance seam:** the coaching metric uses the framework's
  `computeOnboardingGuidance`, so wording/thresholds stay consistent with the
  recorder HUD.
- **D4 — soft gate:** "Place anchor" is always enabled; the guidance meter and
  banner copy nudge waiting for good tracking.
- **D5 — E1 capability gate:** a clear "open on an AR phone outdoors" message
  on unsupported devices; no simulation fallback (yet).
