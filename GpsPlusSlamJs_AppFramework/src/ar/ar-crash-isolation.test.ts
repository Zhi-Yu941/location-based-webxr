import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AR_CRASH_ISOLATION,
  validateArCrashIsolationOptions,
} from './ar-crash-isolation';

describe('validateArCrashIsolationOptions', () => {
  // Why this test matters: the sidecar documents the validator as the
  // boundary for UNTRUSTED input (persisted localStorage / external callers)
  // that "never throws" — yet destructuring a null/undefined container used
  // to throw a TypeError (PR #185 review). A JS consumer forwarding
  // `stored.arCrashIsolation` from a persisted blob that lacks the key hits
  // exactly this. The container itself must be normalized like the fields.
  it('returns full defaults for a null or undefined container (never throws)', () => {
    expect(validateArCrashIsolationOptions(undefined)).toEqual(
      DEFAULT_AR_CRASH_ISOLATION
    );
    expect(validateArCrashIsolationOptions(null)).toEqual(
      DEFAULT_AR_CRASH_ISOLATION
    );
    expect(validateArCrashIsolationOptions()).toEqual(
      DEFAULT_AR_CRASH_ISOLATION
    );
  });

  // Why this test matters: pins the documented per-field contract directly
  // (previously only covered indirectly via initAR and the recorder catalog):
  // real booleans pass through, anything else falls back to the default.
  it('keeps real booleans and falls back per corrupt field', () => {
    expect(
      validateArCrashIsolationOptions({
        enableCss3dRenderer: false,
        enableDomOverlay: 'yes' as unknown as boolean,
      })
    ).toEqual({
      ...DEFAULT_AR_CRASH_ISOLATION,
      enableCss3dRenderer: false,
    });
  });

  // Why this test matters: a corrupt persisted blob can hold ANY JSON value
  // where the options object is expected (string/number/array). Property
  // access on those primitives is safe in JS, so they must normalize to full
  // defaults rather than crash session negotiation.
  it('returns full defaults for non-object containers', () => {
    for (const corrupt of ['corrupt', 42, true, []] as const) {
      expect(
        validateArCrashIsolationOptions(
          corrupt as unknown as Record<string, never>
        )
      ).toEqual(DEFAULT_AR_CRASH_ISOLATION);
    }
  });
});
