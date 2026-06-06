/**
 * Per-frame **XR-access** callback registry — the safe seam that lets app
 * code run standard WebXR work (hit-test, light estimation, depth, the WebXR
 * Anchors API, …) without the framework wrapping each capability.
 *
 * The framework owns the single `renderer.setAnimationLoop(onXRFrame)` hook,
 * and the live `XRFrame` never leaves `onXRFrame`. The plain `FrameUpdate`
 * registry (`frame-loop.ts`) only passes `(dt, elapsed)`, which is enough for
 * pose-free ticks but cannot drive hit-test. This registry additionally hands
 * the callback the live `frame`, `referenceSpace`, and `session`.
 *
 * SAFETY CONTRACT (non-negotiable): `frame` / `referenceSpace` / `session` are
 * valid **only synchronously inside the callback**. The `XRFrame` is
 * use-after-frame-unsafe — storing it and reading it on a later tick throws or
 * crashes. Passing them as arguments (never a stashable `getXrFrame()` getter)
 * makes correct use the easy path and stashing the awkward one. Do NOT retain
 * `ctx` or its fields beyond the callback's synchronous execution.
 *
 * See `2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md`
 * §6.2/§6.3 (option H-A2) for the design rationale.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('XrFrameLoop');

/**
 * Live, frame-scoped WebXR context. Valid only synchronously inside the
 * `XrFrameUpdate` callback it is passed to.
 */
export interface XrFrameContext {
  /** The live `XRFrame` for this animation-frame. Use-after-frame-unsafe. */
  readonly frame: XRFrame;
  /** The session's reference space (e.g. for `frame.getPose` / hit-test results). */
  readonly referenceSpace: XRReferenceSpace;
  /** The active `XRSession` (e.g. to call `requestHitTestSource` once). */
  readonly session: XRSession;
  /** Seconds since the previous frame (0 on the first frame after a reset). */
  readonly dt: number;
  /** Seconds since the session started. */
  readonly elapsed: number;
}

/** A per-frame callback that needs live XR access. See the safety contract. */
export type XrFrameUpdate = (ctx: XrFrameContext) => void;

const updates = new Set<XrFrameUpdate>();

/**
 * Register a per-frame XR-access callback. Returns an unregister function.
 *
 * Registration is idempotent — registering the same `fn` twice is a no-op
 * (it remains a single entry in the underlying `Set`).
 */
export function registerXrFrameUpdate(fn: XrFrameUpdate): () => void {
  updates.add(fn);
  return () => {
    updates.delete(fn);
  };
}

/**
 * Invoke all registered XR-access callbacks. Called by the WebXR session's
 * `onXRFrame` once per frame, only when a live `frame` / `referenceSpace` /
 * `session` are all available.
 *
 * The set is snapshotted before iterating so that
 * `registerXrFrameUpdate` / unregister calls made by a handler during the
 * same frame are deferred to the next tick — mirroring `runFrameUpdates`.
 *
 * Each callback is invoked in its own `try/catch`: this registry is the public
 * app seam, so a bug in one app-registered callback (which throws every frame)
 * must not abort the remaining callbacks nor propagate up through `onXRFrame`
 * and kill the scene render for the whole session. Failures are logged and the
 * loop continues — mirroring `runFrameUpdates`.
 */
export function runXrFrameUpdates(ctx: XrFrameContext): void {
  const snapshot = Array.from(updates);
  for (const fn of snapshot) {
    try {
      fn(ctx);
    } catch (error) {
      log.error('A registered XrFrameUpdate threw; continuing the loop', error);
    }
  }
}

/**
 * Clear all registrations. Called from `resetWebXRState()` so a fresh
 * session starts with an empty registry.
 */
export function clearXrFrameUpdates(): void {
  updates.clear();
}
