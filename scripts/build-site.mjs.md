# `scripts/build-site.mjs` — combined multi-app deploy build

## Purpose

Builds the three public surfaces of the `gps.csutil.com` deployment into one
output directory (`dist-site/`) that Cloudflare serves as static assets:

- `dist-site/index.html` — the landing page (copied from `GpsPlusSlamJs_Landing/`).
- `dist-site/recorder/` — `GpsPlusSlamJs_RecorderApp`, built with `base=/recorder/`.
- `dist-site/starter/` — `GpsPlusSlamJs_AnchorStarter`, built with `base=/starter/`.

Invoked via the root script `pnpm run build:site`. This is the command the
Cloudflare Git integration runs (replacing the former `build:recorder`). See
[2026-06-01-0424-multi-app-subpath-deployment-plan.md](../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-0424-multi-app-subpath-deployment-plan.md).

## Public API

CLI only: `node scripts/build-site.mjs` (no arguments). Exits non-zero if any
sub-build fails or any post-build assertion fails.

## Behaviour / steps

1. Wipe and recreate `dist-site/`.
2. Build the framework once (`pnpm run build:framework`).
3. Typecheck + `vite build` the recorder with `--base=/recorder/ --outDir
   <dist-site/recorder> --emptyOutDir`, then assert no bare root-absolute URLs.
4. Typecheck + `vite build` the starter with `--base=/starter/ --outDir
   <dist-site/starter> --emptyOutDir`, then assert no bare root-absolute URLs.
5. Copy the landing page to `dist-site/index.html`.
6. Assert the combined tree contains the required files.

`base` and `outDir` are passed as **CLI flags**, so the committed app vite
configs stay at their `/` + `dist` defaults — local `vite dev` and the USB
debugging workflow are unchanged.

## Invariants & assumptions

- **Each app writes into its own subdir** (`recorder/`, `starter/`), so
  `--emptyOutDir` only clears that app's folder; the builds cannot wipe each
  other.
- **`assertNoBareAbsoluteUrls`** is the executable guard for plan Steps 1-3: it
  fails the build if any built `href`/`src` points at a bare `/...` path that is
  not under the app's base. Vite rewrites root-absolute URLs inside processed
  `index.html`, but **not** `<a href>` cross-page links — this is exactly how
  the recorder's `ar-hittest-test.html` link was caught and switched to a
  base-relative `href="ar-hittest-test.html"`. External (`http(s)://`),
  protocol-relative (`//`), and `data:` URLs are ignored.
- **`dist-site/` is gitignored** and only produced in CI / locally on demand.
- Runs identically on Windows/Linux/CI (pure Node, no shell-specific logic; a
  shell is only used to resolve `pnpm`/`pnpm.cmd` on Windows).

## Examples

```bash
cd location-based-webxr
pnpm run build:site
# Serve and click through landing -> /starter/ -> /recorder/:
npx serve dist-site   # or any static server
```

## Tests

No standalone unit test — the script *is* the verification harness for the
deployment. Its `assertNoBareAbsoluteUrls` and `assertSiteTree` checks run on
every `build:site` invocation (and therefore on every Cloudflare deploy),
failing fast on regressions. The storage-isolation invariant of the deployed
apps is covered separately by `anchor-storage.test.ts` and
`recording-options.test.ts` (plan Step 6).
