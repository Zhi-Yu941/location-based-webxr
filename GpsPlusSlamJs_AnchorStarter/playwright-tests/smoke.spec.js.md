# `smoke.spec.js` — Tier 0 smoke & capability gate

- **Purpose:** End-to-end proof of the things only a real browser can verify
  for a desktop visitor to the persistent-anchor starter — the **E1 capability
  gate** and the static boot UI. No seam/mock required (Tier 0 of
  [2026-06-01-anchor-starter-e2e-test-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-anchor-starter-e2e-test-plan.md)).
- **Cases:**
  - **loads without unexpected console errors** — navigates to `/`, asserts a
    `< 400` status and the start screen becomes visible, and fails on any
    console/page error that is **not** WebXR/GPS-related (those are expected on
    desktop and filtered by `isExpectedCapabilityNoise`).
  - **renders the start screen and intro copy** — `start-screen` visible, the
    "Persistent GPS anchor" heading, and the `start-button` are present.
  - **keeps the live guidance and placement panels hidden on boot** — `guidance`
    and `placement` stay hidden until the user starts AR.
  - **fires the E1 capability gate when WebXR is unavailable** — because
    Playwright Chromium has no `navigator.xr`, `isFullySupported` is false, so
    the `start-button` is **disabled** and the `capability-message` is shown and
    names the missing **WebXR** capability plus the "AR-capable phone" guidance.
- **Invariants & assumptions:**
  - The capability gate depends only on WebXR being absent; geolocation state is
    irrelevant because `isFullySupported` requires **both** (see
    [capability.ts.md](../src/capability.ts.md)).
  - Selectors use the existing `data-testid` attributes already present in
    [index.html](../index.html) — no markup changes were needed.
  - Waiting uses `locator.waitFor`/`expect` only — no `waitForTimeout` (repo
    rule).
- **Run:** `pnpm run test:e2e`.
