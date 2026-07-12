# `vite.config.ts` — dev-server config

- **Purpose:** Dev server on a distinct port (5182) so the landing runs
  alongside the minimal example (5180) and the anchor starter (5181);
  `host: true` so IPv4 `127.0.0.1` responds on Windows (mirrors the
  sibling apps).
- **Invariants:** no aliases and no base-path logic here — the production
  build's `--base=/ --outDir <dist-site>` flags come from
  `scripts/build-site.mjs` so this committed config stays at the `/` +
  `dist` defaults for local dev.
- **Tests:** none (exercised by `pnpm dev` / `pnpm build`).
