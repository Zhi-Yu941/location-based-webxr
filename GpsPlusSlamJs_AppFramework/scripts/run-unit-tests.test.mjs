// Tests for scripts/run-unit-tests.mjs.
//
// Why this file matters: `pnpm run test:unit -- <file>` used to run the ENTIRE
// unit suite (~40 s, all test files) because pnpm forwards a literal `--`
// token and vitest (CAC) routes everything after a bare `--` into argv['--']
// (raw passthrough) instead of treating the path as a positional file filter.
// The wrapper strips the bare `--` so the documented single-file invocation
// actually scopes. These tests pin that arg-building logic so the footgun
// cannot silently return.

import { describe, expect, it } from 'vitest';

import { buildUnitTestRun } from './run-unit-tests.mjs';

const FIXED_PREFIX = [
  'run',
  '--coverage',
  '--config',
  'config/vitest.config.ts',
];

describe('buildUnitTestRun — single-file scoping', () => {
  it('strips the literal "--" pnpm forwards, so the file filter survives', () => {
    // The exact footgun: pnpm appends a bare "--" before the user args.
    const { vitestArgs } = buildUnitTestRun([
      '--',
      'src/ar/occupancy-mesher.smooth.test.ts',
    ]);
    expect(vitestArgs).not.toContain('--');
    expect(vitestArgs).toContain('src/ar/occupancy-mesher.smooth.test.ts');
    expect(vitestArgs.slice(0, FIXED_PREFIX.length)).toEqual(FIXED_PREFIX);
  });

  it('scopes the same way without the "--" separator', () => {
    const { vitestArgs } = buildUnitTestRun([
      'src/ar/occupancy-mesher.smooth.test.ts',
    ]);
    expect(vitestArgs).toContain('src/ar/occupancy-mesher.smooth.test.ts');
    expect(vitestArgs.slice(0, FIXED_PREFIX.length)).toEqual(FIXED_PREFIX);
  });

  it('with no args runs the full suite (the test:core invocation) — no refusal', () => {
    // Unlike the Investigation-corpus guard, a no-arg run here is the normal
    // full unit gate used by `pnpm test` / `test:core`, so it must pass
    // through unchanged rather than error out.
    const { vitestArgs } = buildUnitTestRun([]);
    expect(vitestArgs).toEqual(FIXED_PREFIX);
  });

  it('preserves real flags (only the BARE "--" token is stripped)', () => {
    const { vitestArgs } = buildUnitTestRun([
      '--',
      'src/ar/bresenham3d.test.ts',
      '--reporter=dot',
    ]);
    expect(vitestArgs).toContain('src/ar/bresenham3d.test.ts');
    expect(vitestArgs).toContain('--reporter=dot');
    expect(vitestArgs).not.toContain('--');
  });
});
