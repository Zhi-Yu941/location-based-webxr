// @ts-check
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Build a vitest argv with pnpm's literal `--` separator removed.
 *
 * Every workspace package's `test:unit` routes through this wrapper because
 * `pnpm run test:unit -- <file>` makes pnpm forward a **literal** `--` token,
 * and vitest (CAC) routes everything after a bare `--` into `argv['--']` (raw
 * passthrough) instead of treating the following path as a positional file
 * filter — so the documented single-file invocation silently ran the ENTIRE
 * unit suite. Each package passes its own canonical vitest args first (e.g.
 * `run --coverage --config config/vitest.config.ts`) and pnpm appends the
 * developer's args after them; stripping the bare `--` makes both
 * `pnpm run test:unit <file>` and `pnpm run test:unit -- <file>` scope
 * correctly. With no developer args the package's full suite runs on purpose —
 * that is the invocation each package's `test`/`test:core` gate uses, so this
 * wrapper must never refuse an unfiltered run.
 *
 * Scoped runs of a `--coverage` package additionally get GLOBAL coverage
 * thresholds neutralized (zero-overrides inserted right after `--coverage`,
 * so a developer's own later threshold flag still wins): covering ~one file
 * can never meet a whole-suite threshold, so without this a green scoped run
 * exits 1 — the same single-file-TDD failure the core library's stage runner
 * solves with identical overrides. Unfiltered gate runs keep thresholds
 * enforced. NOTE: base args in package.json must use `--flag=value` form
 * (e.g. `--config=config/vitest.config.ts`) — a space-separated flag value
 * would be indistinguishable from a positional file filter.
 *
 * @param {string[]} rawArgs args after the script name (process.argv.slice(2))
 * @returns {string[]} argv to hand to the `vitest` binary
 */
export function buildScopedVitestArgs(rawArgs) {
  // Drop only the bare `--` separator; real flags (`--reporter=dot`, …) and
  // file paths pass through untouched, in order.
  const args = rawArgs.filter((arg) => arg !== '--');
  // args[0] is the vitest command word (`run`); any later non-flag arg is a
  // positional file filter (base args use --flag=value form, see above).
  const hasFileFilter = args.some((arg, i) => i > 0 && !arg.startsWith('-'));
  const coverageIdx = args.indexOf('--coverage');
  if (hasFileFilter && coverageIdx !== -1) {
    args.splice(
      coverageIdx + 1,
      0,
      '--coverage.thresholds.statements=0',
      '--coverage.thresholds.branches=0',
      '--coverage.thresholds.functions=0',
      '--coverage.thresholds.lines=0'
    );
  }
  return args;
}

// Execute only when run directly (node scripts/run-vitest-scoped.mjs), not
// when imported by the repo-config test. pathToFileURL keeps this correct on
// Windows (drive-letter + backslash paths) where a naive compare would fail.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // shell: true so the package-local `vitest` .CMD shim resolves on Windows;
  // pnpm puts the invoking package's node_modules/.bin on PATH, so the child
  // uses that package's vitest and (cwd-relative) config.
  const child = spawnSync('vitest', buildScopedVitestArgs(process.argv.slice(2)), {
    stdio: 'inherit',
    shell: true,
  });
  process.exit(child.status ?? 1);
}
