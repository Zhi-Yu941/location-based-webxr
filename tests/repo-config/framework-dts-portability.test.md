# `framework-dts-portability.test.js`

- Purpose: repo-meta guard that `GpsPlusSlamJs_AppFramework` declares `redux` as a **direct** dependency and that its built `dist/` contains no bundled `redux-<hash>.d.ts` chunk.
- Why: the framework's public API types reference redux types (`Reducer`, `Action`) via `@reduxjs/toolkit`. Without a direct `redux` dependency, tsdown's d.ts bundling inlines redux's types into a private dist chunk that the package `exports` map does not expose. Downstream projects compiling with `composite`/`declaration` (QrTrackingDemo) then hit TS2883 — inferred types of framework calls become unnameable. The core library declares `redux`/`redux-thunk` directly for the same reason.
- Invariants & assumptions:
  - Manifest check always runs; the dist-chunk check is skipped when `dist/` is absent (repo-config tests must not require a prior build).
  - If `@reduxjs/toolkit` is ever dropped from the framework, this test should be revisited (the direct `redux` dep may become unnecessary).
- Tests: run via `pnpm run test:repo-config` in the `location-based-webxr` root.
- History: found 2026-07-11 during the simplify loop when the local `link:` override surfaced the latent TS2883; see `gps-plus-slam` repo `GpsPlusSlamJs_Docs/docs/2026-07-11-simplify-loop-findings.md`.
