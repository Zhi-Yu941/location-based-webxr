/**
 * Tests for the bundled community license-key default in `createSlamAppStore`.
 *
 * Why this test matters: the AppFramework owns the `COMMUNITY_LICENSE_KEY` so
 * every example app gets a valid license without wiring. The library must
 * never run without a valid key. These tests guard the contract that:
 *   1. Calling `createSlamAppStore()` with no licenseKey succeeds (default key
 *      validates against the embedded production public key).
 *   2. Passing `licenseKey: ''` throws — empty strings are not an opt-out.
 *   3. Passing an invalid licenseKey throws.
 *
 * Migrated from `state/store.license-key.test.ts` in Iter 1 of the
 * AppFramework / RecorderApp boundary migration.
 */

import { describe, it, expect } from 'vitest';
import { createSlamAppStore } from './create-slam-app-store';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';
import { NullStorageBackend } from '../storage/null-storage-backend';

describe('createSlamAppStore — community license key default', () => {
  it('uses COMMUNITY_LICENSE_KEY by default and validates successfully', () => {
    expect(COMMUNITY_LICENSE_KEY).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(() =>
      createSlamAppStore({ storageBackend: new NullStorageBackend() })
    ).not.toThrow();
  });

  it('throws on an empty licenseKey (no opt-out)', () => {
    expect(() =>
      createSlamAppStore({
        storageBackend: new NullStorageBackend(),
        licenseKey: '',
      })
    ).toThrow();
  });

  it('throws on an invalid override licenseKey', () => {
    expect(() =>
      createSlamAppStore({
        storageBackend: new NullStorageBackend(),
        licenseKey: 'not-a-valid-key',
      })
    ).toThrow();
  });
});
