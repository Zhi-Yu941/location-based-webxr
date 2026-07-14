/**
 * Disposer registry for AR-session-scoped resources.
 *
 * main.ts creates ~19 resources per AR session (visualizers, store
 * subscriptions, frame-loop handles). Before this registry existed their
 * teardown intent was hand-written in up to four places per resource and
 * the enter/reset symmetry drifted repeatedly. The contract now: whoever
 * CREATES a session resource registers its teardown here, once, at the
 * creation site; entering AR again and `resetMainState` both simply
 * `dispose()` the scope.
 *
 * Semantics (pinned by ar-session-scope.test.ts + the property test):
 * - `dispose()` runs disposers in reverse registration order (per wiring
 *   block, subscriptions unwind before the visualizers they feed).
 * - Each disposer runs exactly once; `dispose()` clears the registry, so
 *   the same scope instance is reused across sessions.
 * - A throwing disposer is reported via `warn` and never strands the rest.
 * - Disposers registered DURING `dispose()` (e.g. by a teardown side
 *   effect) belong to the NEXT session and run on the next `dispose()`.
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('ArSessionScope');

type Warn = (message: string, error?: unknown) => void;

export interface ArSessionScope {
  /** Register a teardown for a resource created at the call site. */
  add(name: string, disposer: () => void): void;
  /**
   * The shared shape of main.ts's gated wiring blocks: skip when not
   * enabled; run the factory; a factory throw is logged as a warning and
   * swallowed (the session continues without that block); a function
   * returned by the factory is registered as the block's disposer.
   */
  wire(
    name: string,
    enabled: boolean,
    factory: () => (() => void) | void
  ): void;
  /** Tear down everything registered since the last dispose. */
  dispose(): void;
}

export function createArSessionScope(
  warn: Warn = (message, error) => log.warn(message, error)
): ArSessionScope {
  let disposers: Array<{ name: string; dispose: () => void }> = [];

  return {
    add(name, dispose) {
      disposers.push({ name, dispose });
    },

    wire(name, enabled, factory) {
      if (!enabled) return;
      try {
        const dispose = factory();
        if (typeof dispose === 'function') {
          disposers.push({ name, dispose });
        }
      } catch (err) {
        warn(`${name} wiring skipped; recording continues without it`, err);
      }
    },

    dispose() {
      // Snapshot + clear FIRST so teardown side effects that register new
      // disposers land in the next session's registry, not the running one.
      const toRun = disposers;
      disposers = [];
      for (let i = toRun.length - 1; i >= 0; i--) {
        const entry = toRun[i];
        if (!entry) continue;
        try {
          entry.dispose();
        } catch (err) {
          warn(`${entry.name} teardown failed; continuing with the rest`, err);
        }
      }
    },
  };
}
