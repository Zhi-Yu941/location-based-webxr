import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearXrFrameUpdates,
  registerXrFrameUpdate,
  runXrFrameUpdates,
  type XrFrameContext,
  type XrFrameUpdate,
} from './xr-frame-loop.js';

/**
 * Why this test file matters:
 * `registerXrFrameUpdate` is the public seam that lets app code run standard
 * WebXR work (hit-test, light estimation, …) as plain three.js while the
 * framework keeps ownership of the single animation loop. The contract
 * (§6.3 H-A2) mirrors the plain `frame-loop` registry — idempotent register,
 * real unregister, snapshot-during-tick — but additionally delivers the live
 * `frame` / `referenceSpace` / `session` as **synchronously-valid arguments**.
 * These tests pin that contract so a regression cannot silently turn the
 * frame-scoped delivery into something stashable or skip a handler.
 */

// Minimal fakes — the registry never inspects the objects, it only forwards
// them, so identity is all we assert.
const fakeCtx = (dt: number, elapsed: number): XrFrameContext => ({
  frame: {} as XRFrame,
  referenceSpace: {} as XRReferenceSpace,
  session: {} as XRSession,
  dt,
  elapsed,
});

afterEach(() => {
  clearXrFrameUpdates();
});

describe('registerXrFrameUpdate / runXrFrameUpdates', () => {
  it('invokes every registered callback once per tick with the live frame context', () => {
    const a = vi.fn<XrFrameUpdate>();
    const b = vi.fn<XrFrameUpdate>();
    registerXrFrameUpdate(a);
    registerXrFrameUpdate(b);

    const ctx = fakeCtx(0.016, 1.234);
    runXrFrameUpdates(ctx);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(ctx);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(ctx);
  });

  it('forwards the exact same context object (frame/referenceSpace/session identity preserved)', () => {
    const frame = {} as XRFrame;
    const referenceSpace = {} as XRReferenceSpace;
    const session = {} as XRSession;
    let seen: XrFrameContext | undefined;
    registerXrFrameUpdate((ctx) => {
      seen = ctx;
    });

    runXrFrameUpdates({ frame, referenceSpace, session, dt: 0.01, elapsed: 2 });

    expect(seen?.frame).toBe(frame);
    expect(seen?.referenceSpace).toBe(referenceSpace);
    expect(seen?.session).toBe(session);
    expect(seen?.dt).toBe(0.01);
    expect(seen?.elapsed).toBe(2);
  });

  it('does not invoke an unregistered callback on subsequent ticks', () => {
    const a = vi.fn<XrFrameUpdate>();
    const unregister = registerXrFrameUpdate(a);

    runXrFrameUpdates(fakeCtx(0.016, 0.016));
    unregister();
    runXrFrameUpdates(fakeCtx(0.016, 0.032));

    expect(a).toHaveBeenCalledTimes(1);
  });

  it('treats registering the same function twice as a single registration (Set dedup)', () => {
    const a = vi.fn<XrFrameUpdate>();
    registerXrFrameUpdate(a);
    registerXrFrameUpdate(a);

    runXrFrameUpdates(fakeCtx(0.016, 0.016));

    expect(a).toHaveBeenCalledTimes(1);
  });

  it('defers a register/unregister during a tick to the next frame (snapshot semantics)', () => {
    const b = vi.fn<XrFrameUpdate>();
    const a: XrFrameUpdate = () => {
      unregisterB();
    };
    registerXrFrameUpdate(a);
    const unregisterB = registerXrFrameUpdate(b);

    runXrFrameUpdates(fakeCtx(0.016, 0.016));
    expect(b).toHaveBeenCalledTimes(1);

    runXrFrameUpdates(fakeCtx(0.016, 0.032));
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no callbacks are registered', () => {
    expect(() => {
      runXrFrameUpdates(fakeCtx(0.016, 0.016));
    }).not.toThrow();
  });

  it('isolates a throwing callback so the remaining callbacks still run and the loop survives', () => {
    // Why this matters: this is the public app seam, so a buggy app-registered
    // callback that throws every frame must not abort the rest of the
    // callbacks nor propagate up through onXRFrame and stop the scene render.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const boom: XrFrameUpdate = () => {
      throw new Error('callback blew up');
    };
    const after = vi.fn<XrFrameUpdate>();
    registerXrFrameUpdate(boom);
    registerXrFrameUpdate(after);

    const ctx = fakeCtx(0.016, 0.016);
    expect(() => {
      runXrFrameUpdates(ctx);
    }).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(ctx);
    expect(consoleError).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });
});

describe('clearXrFrameUpdates', () => {
  it('drops every registration so subsequent ticks invoke nothing', () => {
    const a = vi.fn<XrFrameUpdate>();
    registerXrFrameUpdate(a);

    clearXrFrameUpdates();
    runXrFrameUpdates(fakeCtx(0.016, 0.016));

    expect(a).not.toHaveBeenCalled();
  });
});
