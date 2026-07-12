# GpsPlusSlamJs_Landing

The root landing page of <https://gps.csutil.com>: a three.js + anime.js
scroll-story that explains the GPS+SLAM location-based-WebXR framework to
non-technical decision makers, and routes builders to the live demo apps
(`/starter/`, `/minimal/`, `/qr-demo/`, `/recorder/`).

Requirements, story beats, and all product decisions live in the plan doc:
`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-12-2046-landing-page-3d-scroll-redesign-plan.md`.

## Development

```bash
pnpm install        # from the repo root
pnpm dev            # from this directory — serves on http://localhost:5182
pnpm test           # test:core (format/lint/lint:css/check:all/typecheck/unit) + e2e
pnpm run test:e2e   # Playwright smoke suite only
```

Single test file: `pnpm run test:unit src/scroll-story.test.ts`. Never call
`vitest` or `playwright` directly.

## Architecture

- `index.html` — all chapter copy as real DOM text (SEO / accessibility /
  no-WebGL floor). Inline CSS with dual light/dark custom-property palettes;
  a tiny inline script applies the persisted theme before first paint.
- `src/chapters.ts` — single source of truth for chapter ids/order.
- `src/` modules (each with a `*.md` sidecar) implement the scroll state
  machine, theme controller, capability tiers, and the three.js scene +
  anime.js timelines.

The production build is orchestrated by `scripts/build-site.mjs` (repo
root), which builds this app at base `/` into `dist-site/` alongside the
demo apps.
