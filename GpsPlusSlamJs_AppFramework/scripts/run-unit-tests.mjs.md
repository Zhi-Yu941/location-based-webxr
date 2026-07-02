# run-unit-tests.mjs

## Purpose

Thin wrapper around `vitest run` for the `test:unit` npm script. It exists to
fix one footgun: `pnpm run test:unit -- <file>` forwards a **literal** `--`
token, which vitest (CAC) treats as the start of raw passthrough args
(`argv['--']`) rather than a positional file filter — so the requested
single-file run silently executed the ENTIRE unit suite. The wrapper strips
the bare `--` and hands everything else to vitest unchanged, so both
`pnpm run test:unit <file>` and `pnpm run test:unit -- <file>` scope to the
named file(s).

## Public API

- `buildUnitTestRun(rawArgs: string[]): { vitestArgs: string[] }` — pure
  arg-builder. Filters out bare `--` tokens, then prefixes the fixed vitest
  invocation (`run --coverage --config config/vitest.config.ts`). Never
  throws; an empty `rawArgs` yields the full-suite invocation.
- CLI entry (when executed directly): spawns `vitest` with the built argv
  (`stdio: inherit`, `shell: true` for Windows `.CMD` shim resolution) and
  exits with the child's status (`1` if the child produced none).

## Invariants & assumptions

- **A no-arg run is the full unit suite and must stay allowed** — it is the
  invocation `test:core` (and therefore `pnpm test`) uses. Do not add a
  refuse-on-empty guard here; the full suite is fast enough to be the gate.
- Only the **bare** `--` token is stripped; real flags (`--reporter=dot`,
  `--update`, …) and file paths pass through untouched, in order.
- The fixed prefix must stay in sync with what `test:unit` previously inlined
  (`run --coverage --config config/vitest.config.ts`); the regression test
  pins it.
- The direct-execution check uses `pathToFileURL` so it works with Windows
  drive-letter/backslash paths; importing the module (as the test does) must
  not spawn anything.

## Examples

```bash
pnpm run test:unit                                        # full suite (test:core gate)
pnpm run test:unit src/ar/occupancy-mesher.smooth.test.ts # one file
pnpm run test:unit -- src/ar/occupancy-mesher.smooth.test.ts # same (the old documented form)
```

## Tests

- `scripts/run-unit-tests.test.mjs` — pins the arg-building logic: bare `--`
  stripped (filter survives), same scoping without `--`, no-arg → exactly the
  fixed full-suite prefix (no refusal), real flags preserved. Runs as part of
  the normal unit suite (the vitest config includes `scripts/**/*.test.mjs`).
