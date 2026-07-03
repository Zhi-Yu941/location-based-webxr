/**
 * Stats.js performance overlay — FPS / frame-ms / MB panels rendered
 * side-by-side for the long-session fps investigation (Step 0 of
 * `GpsPlusSlamJs_Docs/docs/2026-07-03-long-session-fps-and-voxel-grid-scaling-plan.md`).
 *
 * mrdoob's Stats.js (bundled with three as `three/addons/libs/stats.module.js`,
 * no extra dependency) shows ONE panel at a time and cycles on tap — unusable
 * mid-walk in AR, so this wrapper mounts one Stats instance per panel and lays
 * them out in a row (2026-07-03 interview decision). The MB panel needs the
 * Chrome-only `performance.memory`; it is omitted where unsupported.
 *
 * The overlay is a read-only instrument: `pointer-events: none` so it never
 * swallows touches meant for the HUD it shares the AR dom-overlay layer with.
 * Callers own the per-frame cadence — call `update()` once per rendered frame
 * (live: the XR frame callback in `main.ts`; replay: a rAF loop in
 * `replay-mode.ts`) — and must `dispose()` on session teardown so panels never
 * stack across Enter-AR cycles.
 *
 * The Stats constructor is injectable because the real one builds a `<canvas>`
 * 2D context, which jsdom lacks — tests inject fakes.
 */

import Stats from 'three/addons/libs/stats.module.js';

/** The subset of the Stats.js API this overlay drives (test-fakeable). */
export interface StatsInstance {
  readonly dom: HTMLElement;
  showPanel(id: number): void;
  update(): void;
}

export interface StatsOverlayOptions {
  /** Injected Stats constructor for tests. Default: real `three/addons` Stats. */
  readonly statsFactory?: () => StatsInstance;
  /**
   * Whether the MB panel's `performance.memory` source exists. Default:
   * probed from the live `performance` object (Chrome-only API).
   */
  readonly memorySupported?: boolean;
}

export interface StatsOverlayHandle {
  /** The mounted container element (removed again by `dispose`). */
  readonly dom: HTMLElement;
  /** Number of panels mounted (3, or 2 without `performance.memory`). */
  readonly panelCount: number;
  /** Advance all panels one frame. No-op after `dispose`. */
  update(): void;
  /** Remove the overlay from the DOM. Idempotent. */
  dispose(): void;
}

/** Panel ids in Stats.js: 0 = FPS, 1 = frame ms, 2 = MB (Chrome only). */
const ALL_PANELS = [0, 1, 2] as const;

function defaultMemorySupported(): boolean {
  return (
    typeof performance !== 'undefined' &&
    'memory' in (performance as unknown as Record<string, unknown>)
  );
}

/**
 * Mount the stats panels into `parent` and return the drive handle.
 *
 * @param parent - host element; in live AR this must be (inside) the WebXR
 *   dom-overlay root, or the panels cannot composite over the camera view.
 * @throws TypeError when `parent` is not a DOM element (fail fast — a silent
 *   no-op overlay would corrupt the fps measurements it exists for).
 */
export function createStatsOverlay(
  parent: HTMLElement,
  options: StatsOverlayOptions = {}
): StatsOverlayHandle {
  if (!parent || typeof parent.appendChild !== 'function') {
    throw new TypeError('createStatsOverlay: parent must be a DOM element');
  }
  const statsFactory = options.statsFactory ?? (() => new Stats());
  const memorySupported = options.memorySupported ?? defaultMemorySupported();
  const panels = memorySupported ? ALL_PANELS : ALL_PANELS.slice(0, 2);

  const container = document.createElement('div');
  container.className = 'stats-overlay';
  // Top-right corner: the recorder HUD owns the top-left of the shared
  // dom-overlay layer. Read-only instrument — never intercept touches.
  container.style.cssText =
    'position:fixed;top:0;right:0;z-index:90;display:flex;pointer-events:none;';

  const instances: StatsInstance[] = [];
  for (const id of panels) {
    const stats = statsFactory();
    stats.showPanel(id);
    // Stats.js pins itself `position:fixed` at the viewport corner; neutralize
    // so the flex row lays the panels out side-by-side.
    stats.dom.style.position = 'relative';
    container.appendChild(stats.dom);
    instances.push(stats);
  }
  parent.appendChild(container);

  let disposed = false;
  return {
    dom: container,
    panelCount: instances.length,
    update(): void {
      if (disposed) return;
      for (const stats of instances) {
        // Isolate per-panel failures: update() runs inside the XR frame
        // callback and must never take the render loop down with it.
        try {
          stats.update();
        } catch {
          // Swallow — a broken panel simply stops advancing.
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      container.remove();
    },
  };
}
