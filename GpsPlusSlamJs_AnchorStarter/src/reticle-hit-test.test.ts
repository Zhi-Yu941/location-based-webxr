import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifecycle/teardown regression tests for the hit-test reticle glue.
 *
 * The per-frame *rendering* (parenting under `arWorldGroup`, reading
 * `frame.getHitTestResults`) is device-only and stays manually verified — but
 * the surrounding XR *lifecycle* is pure, testable logic that a refactor can
 * easily break, and that previously had no automated guard:
 *
 *   1. The `session` `"end"` listener must be registered EXACTLY ONCE. The
 *      request-retry path resets `hitTestSourceRequested` on a transient
 *      failure, so if the listener lived in that block it would stack a
 *      duplicate on every failed `requestHitTestSource` (the bug this fixes).
 *   2. `dispose()` must tear down the live XR state: cancel the running
 *      `XRHitTestSource` (so it does not keep ticking after teardown) and
 *      remove the `"end"` listener via the stored handler.
 *   3. The dispose-during-in-flight-request race must not leak: a source that
 *      resolves after `dispose()` must be cancelled, never adopted.
 *
 * The two framework barrels are mocked (the same approach as `seams.test.ts`)
 * because the real `visualization` barrel transitively loads Leaflet/three and
 * touches `window` at import time, crashing the default node env. Mocking keeps
 * this a fast, deterministic node unit test focused purely on the lifecycle.
 */

const h = vi.hoisted(() => ({
  capturedFrameCb: null as ((ctx: unknown) => void) | null,
  unregisterSpy: vi.fn(),
  updateReticleSpy: vi.fn(),
  reticle: { visible: false, getWorldPosition: vi.fn((out: unknown) => out) },
}));

vi.mock("gps-plus-slam-app-framework/ar/xr-frame-loop", () => ({
  registerXrFrameUpdate: (fn: (ctx: unknown) => void) => {
    h.capturedFrameCb = fn;
    return h.unregisterSpy;
  },
}));

vi.mock("gps-plus-slam-app-framework/visualization", () => ({
  createReticleMesh: () => h.reticle,
  updateReticle: (...args: unknown[]) => {
    h.updateReticleSpy(...args);
  },
}));

const { startReticleHitTest } = await import("./reticle-hit-test.js");

/** Flush all pending microtasks (the request chain awaits twice). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeSession {
  requestReferenceSpace: ReturnType<typeof vi.fn>;
  requestHitTestSource: ReturnType<typeof vi.fn> | undefined;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

/** Build a minimal `XRSession` fake exposing only what the glue calls. */
function makeSession(
  requestHitTestSource?: ReturnType<typeof vi.fn>,
): FakeSession {
  return {
    requestReferenceSpace: vi.fn(() => Promise.resolve({})),
    requestHitTestSource,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

/** Invoke the captured per-frame callback with a fake XR context. */
function tick(
  session: FakeSession,
  frame: { getHitTestResults: ReturnType<typeof vi.fn> },
): void {
  const referenceSpace = {};
  h.capturedFrameCb?.({ frame, referenceSpace, session });
}

/** Count how many listeners of a given type were added/removed. */
function listenerCalls(
  spy: ReturnType<typeof vi.fn>,
  type: string,
): unknown[][] {
  return spy.mock.calls.filter((call) => call[0] === type);
}

/** Start the controller, casting the fake group to the expected param type. */
function start(arWorldGroup: { add: () => void; remove: () => void }) {
  return startReticleHitTest({
    // The glue only calls `.add` / `.remove`; the cast avoids constructing a
    // real three.js Object3D (and pulling three into this node unit test).
    arWorldGroup: arWorldGroup as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.capturedFrameCb = null;
  h.reticle = {
    visible: false,
    getWorldPosition: vi.fn((out: unknown) => out),
  };
});

describe("startReticleHitTest — XR lifecycle", () => {
  it("registers the session 'end' listener exactly once across request retries", async () => {
    // The core regression: a transient `requestHitTestSource` failure resets
    // `hitTestSourceRequested`, so the next frame retries the request. The
    // "end" listener must NOT be re-added on that retry.
    const requestHitTestSource = vi.fn(() =>
      Promise.reject(new Error("transient")),
    );
    const session = makeSession(requestHitTestSource);
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    start(arWorldGroup);

    tick(session, frame); // frame 1: request starts, "end" registered
    await flush(); // request rejects -> hitTestSourceRequested reset
    tick(session, frame); // frame 2: retries the request
    await flush();

    expect(listenerCalls(session.addEventListener, "end")).toHaveLength(1);
    // The retry actually happened (proves the reset path is exercised), so the
    // single-listener result is not just "it only ran once".
    expect(requestHitTestSource).toHaveBeenCalledTimes(2);
  });

  it("dispose() cancels the live hit-test source and removes the 'end' listener", async () => {
    const cancel = vi.fn();
    const source = { cancel };
    const requestHitTestSource = vi.fn(() => Promise.resolve(source));
    const session = makeSession(requestHitTestSource);
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    const handle = start(arWorldGroup);

    tick(session, frame);
    await flush(); // source adopted

    handle.dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.unregisterSpy).toHaveBeenCalledTimes(1);
    expect(arWorldGroup.remove).toHaveBeenCalledWith(h.reticle);

    const added = listenerCalls(session.addEventListener, "end");
    const removed = listenerCalls(session.removeEventListener, "end");
    expect(removed).toHaveLength(1);
    // The exact same handler instance must be removed that was added, otherwise
    // `removeEventListener` is a no-op and the listener leaks.
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
  });

  it("dispose() is idempotent — a second call does not cancel or unregister twice", async () => {
    const cancel = vi.fn();
    const requestHitTestSource = vi.fn(() => Promise.resolve({ cancel }));
    const session = makeSession(requestHitTestSource);
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    const handle = start(arWorldGroup);
    tick(session, frame);
    await flush();

    handle.dispose();
    handle.dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.unregisterSpy).toHaveBeenCalledTimes(1);
    expect(arWorldGroup.remove).toHaveBeenCalledTimes(1);
  });

  it("cancels a source that resolves after dispose() (no dangling source)", async () => {
    // Race: dispose() runs while `requestHitTestSource` is still in flight. The
    // resolved source must be cancelled instead of being assigned post-teardown.
    const cancel = vi.fn();
    const source = { cancel };
    let resolveSource!: () => void;
    const requestHitTestSource = vi.fn(
      () =>
        new Promise<typeof source>((resolve) => {
          resolveSource = () => {
            resolve(source);
          };
        }),
    );
    const session = makeSession(requestHitTestSource);
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    const handle = start(arWorldGroup);
    tick(session, frame);
    await flush(); // request now pending on `resolveSource`

    handle.dispose();
    resolveSource();
    await flush();

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("startReticleHitTest — reticle driving", () => {
  it("drives the reticle with the hit pose matrix when a surface is found", async () => {
    const matrix = Array.from({ length: 16 }, (_, i) => i);
    const hit = { getPose: vi.fn(() => ({ transform: { matrix } })) };
    const source = { cancel: vi.fn() };
    const session = makeSession(vi.fn(() => Promise.resolve(source)));
    const frame = { getHitTestResults: vi.fn(() => [hit]) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    start(arWorldGroup);
    tick(session, frame);
    await flush(); // adopt the source
    h.updateReticleSpy.mockClear();
    tick(session, frame); // now a source is live

    expect(h.updateReticleSpy).toHaveBeenLastCalledWith(h.reticle, matrix);
  });

  it("hides the reticle (null) when the source is live but no surface is hit", async () => {
    const source = { cancel: vi.fn() };
    const session = makeSession(vi.fn(() => Promise.resolve(source)));
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    start(arWorldGroup);
    tick(session, frame);
    await flush();
    h.updateReticleSpy.mockClear();
    tick(session, frame);

    expect(h.updateReticleSpy).toHaveBeenLastCalledWith(h.reticle, null);
  });

  it("keeps the reticle hidden on runtimes without requestHitTestSource", async () => {
    // Older WebXR builds: `requestHitTestSource` is undefined -> source stays
    // null -> reticle hidden every frame, and nothing throws.
    const session = makeSession(undefined);
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    const handle = start(arWorldGroup);
    tick(session, frame);
    await flush();
    h.updateReticleSpy.mockClear();
    tick(session, frame);

    expect(h.updateReticleSpy).toHaveBeenLastCalledWith(h.reticle, null);
    expect(frame.getHitTestResults).not.toHaveBeenCalled();
    expect(() => handle.dispose()).not.toThrow();
  });

  it("exposes the reticle's visibility and world position to the placement glue", () => {
    const session = makeSession(vi.fn());
    const frame = { getHitTestResults: vi.fn(() => []) };
    const arWorldGroup = { add: vi.fn(), remove: vi.fn() };

    const handle = start(arWorldGroup);

    h.reticle.visible = true;
    expect(handle.isVisible()).toBe(true);
    h.reticle.visible = false;
    expect(handle.isVisible()).toBe(false);

    const out = {};
    handle.getWorldPosition(out as never);
    expect(h.reticle.getWorldPosition).toHaveBeenCalledWith(out);

    // `frame` is referenced only to keep the fake's shape consistent with the
    // other cases; this test never ticks a frame.
    void frame;
    void session;
  });
});
