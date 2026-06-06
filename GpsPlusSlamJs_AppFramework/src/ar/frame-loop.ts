/**
 * Per-frame callback registry. The WebXR session owns the single
 * `renderer.setAnimationLoop(...)` hook for the page; components that need
 * a per-frame tick register here and the session's `onXRFrame` invokes
 * `runFrameUpdates(dt, elapsed)` once per frame.
 *
 * Plain functions, not a class: there is exactly one frame loop per session
 * and singletons-of-singletons add no value. See
 * `2026-05-13-ecs-migration-plan.md` for the design rationale and the
 * rules new `FrameUpdate` bodies must follow (pure function of `dt` plus
 * selectors; no direct Redux dispatch from inside a tick).
 */

import { createLogger } from '../utils/logger';

const log = createLogger('FrameLoop');

export type FrameUpdate = (dt: number, elapsed: number) => void;

const updates = new Set<FrameUpdate>();

/**
 * Register a per-frame callback. Returns an unregister function.
 *
 * Registration is idempotent — calling with the same `fn` twice is a no-op
 * (it remains a single entry in the underlying `Set`).
 */
export function registerFrameUpdate(fn: FrameUpdate): () => void {
  updates.add(fn);
  return () => {
    updates.delete(fn);
  };
}

/**
 * Invoke all registered callbacks. Called by the WebXR session's
 * `onXRFrame` once per frame with the XR-derived `dt` (seconds since the
 * previous frame; 0 on the first frame after a reset) and `elapsed`
 * (seconds since the session started).
 *
 * The set is snapshotted before iterating so that
 * `registerFrameUpdate` / unregister calls made by a handler during the
 * same frame are deferred to the next tick. Iterating the live `Set`
 * would otherwise skip a not-yet-visited entry that an earlier handler
 * unregistered — a hard-to-debug source of non-determinism.
 *
 * Each callback is invoked in its own `try/catch` so a throwing handler is
 * isolated: it cannot abort the remaining callbacks nor propagate up through
 * `onXRFrame` and kill the scene render for the whole frame. Failures are
 * logged and the loop continues — mirrored by `runXrFrameUpdates`.
 */
export function runFrameUpdates(dt: number, elapsed: number): void {
  const snapshot = Array.from(updates);
  for (const fn of snapshot) {
    try {
      fn(dt, elapsed);
    } catch (error) {
      log.error('A registered FrameUpdate threw; continuing the loop', error);
    }
  }
}

/**
 * Clear all registrations. Called from `resetWebXRState()` so a fresh
 * session starts with an empty registry (any callbacks from the previous
 * session are dropped along with their owning components).
 */
export function clearFrameUpdates(): void {
  updates.clear();
}
