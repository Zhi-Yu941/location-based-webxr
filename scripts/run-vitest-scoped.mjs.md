# run-vitest-scoped.mjs

## Purpose

Shared workspace wrapper around the `vitest` CLI that every package's
`test:unit` script routes through. It exists to fix one footgun:
`pnpm run test:unit -- <file>` forwards a **literal** `--` token, which vitest
(CAC) treats as the start of raw passthrough args (`argv['--']`) rather than a
positional file filter — so the documented single-file invocation silently ran
the package's ENTIRE unit suite. The wrapper strips the bare `--` and hands
everything else to vitest unchanged, so both `pnpm run test:unit <file>` and
`pnpm run test:unit -- <file>` scope to the named file(s) in every package.

## Public API

- `buildScopedVitestArgs(rawArgs: string[]): string[]` — pure arg builder.
  Removes bare `--` tokens; preserves everything else (flags, paths) in order.
  When the result contains a positional file filter AND `--coverage`, four
  `--coverage.thresholds.*=0` overrides are inserted directly after
  `--coverage` (a scoped run covering ~one file can never meet whole-suite
  thresholds; inserting them early means a developer's own later threshold
  flag wins). Never throws.
- CLI entry (when executed directly): spawns `vitest` with the built argv
  (`stdio: inherit`; `shell: true` so the invoking package's
  `node_modules/.bin` shim resolves on Windows) and exits with the child's
  status (`1` if the child produced none).

## Invariants & assumptions

- **Generic by design:** the wrapper hardcodes NO vitest args. Each package's
  `test:unit` line passes its own canonical invocation first (e.g.
  `node ../scripts/run-vitest-scoped.mjs run --coverage
  --config=config/vitest.config.ts`), and pnpm appends developer args after
  it.
- **Base args MUST use `--flag=value` form** (`--config=…`, never
  `--config …`): a space-separated flag value is indistinguishable from a
  positional file filter, which would make every run look scoped.
- **A no-arg (unfiltered) run must pass through unchanged** — it is the
  full-suite invocation each package's `test`/`test:core` gate uses. Do not
  add a refuse-on-empty guard; coverage thresholds stay enforced there.
- Runs with the invoking package's cwd, so package-relative config paths and
  the package-local vitest binary are used.
- Importing the module (as the repo-config test does) must not spawn anything
  (`pathToFileURL` main-module check, Windows-safe).

## Examples

```bash
# from any package directory (e.g. GpsPlusSlamJs_RecorderApp):
pnpm run test:unit                     # full unit suite (the test gate)
pnpm run test:unit src/debug-log.test.ts     # one file
pnpm run test:unit -- src/debug-log.test.ts  # same (documented form)
```

## Tests

- `tests/repo-config/run-vitest-scoped.test.js` — pins the arg building: bare
  `--` stripped (filter survives), no-separator form untouched, no-arg run
  passes through (no refusal), real flags preserved. Runs via the root
  `pnpm run test:repo-config` (part of the root `pnpm test` chain).
