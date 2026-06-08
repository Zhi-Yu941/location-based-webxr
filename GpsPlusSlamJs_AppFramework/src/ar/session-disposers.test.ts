/**
 * Tests for the session-scoped disposer registry.
 *
 * Why this matters: `resetWebXRState()` clears the per-frame registry on
 * teardown, but session-scoped resources that are NOT per-frame ticks — most
 * notably the store subscription opened by `enableArWorldGroupAlignment` — had
 * no teardown hook and leaked across sessions. This registry is that hook: a
 * resource registers its dispose here and the teardown chokepoint flushes it
 * exactly once. The contract below (run-once, clear-on-run, deregister,
 * isolation) is what `enableArWorldGroupAlignment` relies on to be safe without
 * any per-app bookkeeping. See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-08-arworldgroup-alignment-session-scoped-disposal.md.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerSessionDisposer,
  runSessionDisposers,
  clearSessionDisposers,
} from './session-disposers.js';

afterEach(() => {
  clearSessionDisposers();
});

describe('session-disposers', () => {
  it('runs each registered disposer once on flush', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerSessionDisposer(a);
    registerSessionDisposer(b);

    runSessionDisposers();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('clears the registry as it runs, so a second flush is a no-op', () => {
    const a = vi.fn();
    registerSessionDisposer(a);

    runSessionDisposers();
    runSessionDisposers();

    // A double-flush (e.g. endARSession path then a stray teardown) must not
    // re-run a disposer that already tore its resource down.
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('deregister() removes a disposer before any flush', () => {
    const a = vi.fn();
    const deregister = registerSessionDisposer(a);

    deregister();
    runSessionDisposers();

    expect(a).not.toHaveBeenCalled();
  });

  it('isolates a throwing disposer so the others still run', () => {
    const before = vi.fn();
    const after = vi.fn();
    registerSessionDisposer(before);
    registerSessionDisposer(() => {
      throw new Error('boom');
    });
    registerSessionDisposer(after);

    expect(() => runSessionDisposers()).not.toThrow();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('clearSessionDisposers() drops registrations without running them', () => {
    const a = vi.fn();
    registerSessionDisposer(a);

    clearSessionDisposers();
    runSessionDisposers();

    expect(a).not.toHaveBeenCalled();
  });
});
