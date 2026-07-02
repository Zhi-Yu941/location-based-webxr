// Repo-meta test: pins the shared scripts/run-vitest-scoped.mjs arg builder
// that every workspace package's `test:unit` routes through.
//
// Why this test matters: `pnpm run test:unit -- <file>` makes pnpm forward a
// **literal** `--` token, and vitest (CAC) routes everything after a bare `--`
// into argv['--'] (raw passthrough) instead of treating the path as a
// positional file filter. The documented single-file invocation therefore
// silently ran each package's ENTIRE unit suite (verified 2026-07-02 in
// AppFramework 139 files, RecorderApp 87, AnchorStarter 11, QrTrackingDemo 7,
// MinimalExample 5). The shared wrapper strips the bare `--` so both
// `pnpm run test:unit <file>` and `pnpm run test:unit -- <file>` scope
// correctly in every package; these tests keep that stripping logic from
// silently regressing. A no-arg run must pass through unchanged — it is the
// full-suite invocation every package's `test`/`test:core` gate uses.

import { describe, it, expect } from 'vitest';

import { buildScopedVitestArgs } from '../../scripts/run-vitest-scoped.mjs';

const ZERO_THRESHOLDS = [
  '--coverage.thresholds.statements=0',
  '--coverage.thresholds.branches=0',
  '--coverage.thresholds.functions=0',
  '--coverage.thresholds.lines=0',
];

describe('buildScopedVitestArgs — pnpm "--" stripping', () => {
  it('strips the literal "--" pnpm forwards, so the file filter survives', () => {
    // Package base args come first (from the package.json script line, flags
    // in --flag=value form), then pnpm appends the developer's args after a
    // literal `--`.
    expect(
      buildScopedVitestArgs(['run', '--', 'src/boot.test.ts'])
    ).toEqual(['run', 'src/boot.test.ts']);
  });

  it('passes the no-separator form through unchanged (order preserved)', () => {
    expect(buildScopedVitestArgs(['run', 'src/boot.test.ts'])).toEqual([
      'run',
      'src/boot.test.ts',
    ]);
  });

  it('with no developer args yields the package base invocation (full suite, no refusal)', () => {
    expect(buildScopedVitestArgs(['run'])).toEqual(['run']);
  });

  it('preserves real flags — only the BARE "--" token is stripped', () => {
    expect(
      buildScopedVitestArgs(['run', '--', 'src/x.test.ts', '--reporter=dot'])
    ).toEqual(['run', 'src/x.test.ts', '--reporter=dot']);
  });
});

describe('buildScopedVitestArgs — coverage-threshold neutralization on scoped runs', () => {
  // Why this matters: with the file filter actually working, a scoped run of
  // a --coverage package covers ~one file, so GLOBAL coverage thresholds
  // (e.g. the RecorderApp's 87–88 %) fail the run at 0 % despite green tests
  // — the exact single-file-TDD failure the core library solved with
  // zero-threshold overrides on filtered runs. Full-suite (unfiltered) runs
  // must keep their thresholds enforced.
  it('zeroes thresholds when a file filter is present AND --coverage is used', () => {
    const args = buildScopedVitestArgs([
      'run',
      '--coverage',
      '--config=config/vitest.config.ts',
      '--',
      'src/debug-log.test.ts',
    ]);
    // Overrides are inserted right after --coverage, so a developer's own
    // later --coverage.thresholds.* flag still wins (CAC last-one-wins).
    expect(args).toEqual([
      'run',
      '--coverage',
      ...ZERO_THRESHOLDS,
      '--config=config/vitest.config.ts',
      'src/debug-log.test.ts',
    ]);
  });

  it('keeps thresholds enforced on the unfiltered full-suite gate run', () => {
    const args = buildScopedVitestArgs([
      'run',
      '--coverage',
      '--config=config/vitest.config.ts',
    ]);
    expect(args).toEqual([
      'run',
      '--coverage',
      '--config=config/vitest.config.ts',
    ]);
  });

  it('adds nothing for scoped runs of packages without --coverage', () => {
    expect(buildScopedVitestArgs(['run', '--', 'src/boot.test.ts'])).toEqual([
      'run',
      'src/boot.test.ts',
    ]);
  });
});
