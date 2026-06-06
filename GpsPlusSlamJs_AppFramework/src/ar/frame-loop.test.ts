import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearFrameUpdates,
  registerFrameUpdate,
  runFrameUpdates,
  type FrameUpdate,
} from './frame-loop.js';

/**
 * Why this test file matters:
 * The frame-loop registry is the single mechanism through which periodic
 * components (alignment-lerper, camera-follower, future GpsAnchor steady-
 * state loop) plug into the WebXR session's `onXRFrame`. The contract
 * documented in `2026-05-13-ecs-migration-plan.md` says:
 *
 *  - `registerFrameUpdate` is idempotent (Set dedup).
 *  - Unregister actually removes the callback.
 *  - `runFrameUpdates` snapshots the set so register/unregister during a
 *    tick is deferred to the next tick (deterministic).
 *  - `clearFrameUpdates` drops everything (called from
 *    `resetWebXRState()` so a fresh session starts clean).
 */

afterEach(() => {
  clearFrameUpdates();
});

describe('registerFrameUpdate / runFrameUpdates', () => {
  it('invokes every registered callback exactly once per tick with the given dt and elapsed', () => {
    const a = vi.fn<FrameUpdate>();
    const b = vi.fn<FrameUpdate>();
    registerFrameUpdate(a);
    registerFrameUpdate(b);

    runFrameUpdates(0.016, 1.234);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(0.016, 1.234);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(0.016, 1.234);
  });

  it('does not invoke an unregistered callback on subsequent ticks', () => {
    const a = vi.fn<FrameUpdate>();
    const unregister = registerFrameUpdate(a);

    runFrameUpdates(0.016, 0.016);
    unregister();
    runFrameUpdates(0.016, 0.032);

    expect(a).toHaveBeenCalledTimes(1);
  });

  it('treats registering the same function twice as a single registration (Set dedup)', () => {
    const a = vi.fn<FrameUpdate>();
    registerFrameUpdate(a);
    registerFrameUpdate(a);

    runFrameUpdates(0.016, 0.016);

    expect(a).toHaveBeenCalledTimes(1);
  });

  it('defers an unregister-during-tick call to the next frame (snapshot semantics)', () => {
    // Critical invariant: handlers must not "shadow" each other by mutating
    // the registry mid-tick. The current frame sees the snapshot taken at
    // entry to runFrameUpdates.
    const b = vi.fn<FrameUpdate>();
    const a: FrameUpdate = () => {
      // a unregisters b mid-tick — b should still run this frame.
      unregisterB();
    };
    registerFrameUpdate(a);
    const unregisterB = registerFrameUpdate(b);

    runFrameUpdates(0.016, 0.016);
    expect(b).toHaveBeenCalledTimes(1);

    // Next frame b is gone.
    runFrameUpdates(0.016, 0.032);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('defers a register-during-tick call to the next frame (snapshot semantics)', () => {
    const newcomer = vi.fn<FrameUpdate>();
    const seeder: FrameUpdate = () => {
      registerFrameUpdate(newcomer);
    };
    registerFrameUpdate(seeder);

    runFrameUpdates(0.016, 0.016);
    expect(newcomer).not.toHaveBeenCalled();

    runFrameUpdates(0.016, 0.032);
    expect(newcomer).toHaveBeenCalledTimes(1);
    expect(newcomer).toHaveBeenCalledWith(0.016, 0.032);
  });

  it('is a no-op when no callbacks are registered', () => {
    expect(() => {
      runFrameUpdates(0.016, 0.016);
    }).not.toThrow();
  });

  it('isolates a throwing callback so the remaining callbacks still run and the loop survives', () => {
    // Why this matters: a single buggy FrameUpdate must not abort the whole
    // frame. runFrameUpdates is called from onXRFrame *before* the scene
    // render, so a propagating throw would kill rendering for the frame.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const boom: FrameUpdate = () => {
      throw new Error('callback blew up');
    };
    const after = vi.fn<FrameUpdate>();
    registerFrameUpdate(boom);
    registerFrameUpdate(after);

    expect(() => {
      runFrameUpdates(0.016, 0.016);
    }).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(0.016, 0.016);
    expect(consoleError).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });
});

describe('clearFrameUpdates', () => {
  it('drops every registration so subsequent ticks invoke nothing', () => {
    const a = vi.fn<FrameUpdate>();
    const b = vi.fn<FrameUpdate>();
    registerFrameUpdate(a);
    registerFrameUpdate(b);

    clearFrameUpdates();
    runFrameUpdates(0.016, 0.016);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
