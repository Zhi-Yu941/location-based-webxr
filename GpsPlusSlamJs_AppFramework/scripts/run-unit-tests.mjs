// @ts-check
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Build the vitest argv for a unit-test run, fixing the pnpm `--` footgun:
 * `pnpm run test:unit -- <file>` makes pnpm forward a **literal** `--` token
 * into the command, and vitest (CAC) routes everything after a bare `--` into
 * `argv['--']` (raw passthrough) instead of treating the following path as a
 * positional file filter — so the filter was silently dropped and the FULL
 * unit suite ran regardless of the requested file. Stripping the bare `--`
 * here makes both `pnpm run test:unit <file>` and `pnpm run test:unit --
 * <file>` scope correctly. With no positional filter the full suite runs on
 * purpose — that is the `test:core` gate's invocation, so unlike a
 * corpus-guard runner this wrapper must NOT refuse a no-arg run.
 *
 * @param {string[]} rawArgs args after the script name (process.argv.slice(2))
 * @returns {{ vitestArgs: string[] }}
 */
export function buildUnitTestRun(rawArgs) {
  // Drop the bare `--` separator pnpm forwards verbatim; keep real flags like
  // `--reporter=dot` (they are not equal to the bare token).
  const args = rawArgs.filter((arg) => arg !== '--');
  return {
    vitestArgs: [
      'run',
      '--coverage',
      '--config',
      'config/vitest.config.ts',
      ...args,
    ],
  };
}

// Execute only when run directly (node scripts/run-unit-tests.mjs), not when
// imported by its test. pathToFileURL keeps this correct on Windows
// (drive-letter + backslash paths) where a naive string compare would fail.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { vitestArgs } = buildUnitTestRun(process.argv.slice(2));
  const child = spawnSync('vitest', vitestArgs, {
    stdio: 'inherit',
    shell: true,
  });
  process.exit(child.status ?? 1);
}
