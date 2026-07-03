/**
 * Tests for the Stats.js performance overlay wrapper (2026-07-03 long-session
 * fps plan, Step 0).
 *
 * Why these tests matter: the overlay is the measurement instrument for the
 * long-session fps investigation — if it silently mounts wrong (missing
 * panels, blocked HUD taps, leaked DOM nodes across AR sessions) the
 * attribution walk produces garbage. All tests inject a fake Stats factory
 * because the real `three/addons` Stats constructs a `<canvas>` 2D context,
 * which jsdom does not provide.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStatsOverlay, type StatsInstance } from './stats-overlay';

function makeFakeStats(): StatsInstance & {
  shown: number[];
  update: ReturnType<typeof vi.fn<() => void>>;
} {
  const dom = document.createElement('div');
  // Mirror the real Stats.js inline style the overlay must override to lay
  // panels out in a row instead of stacking them at the viewport corner.
  dom.style.position = 'fixed';
  const shown: number[] = [];
  return {
    dom,
    shown,
    showPanel: (id: number) => {
      shown.push(id);
    },
    update: vi.fn<() => void>(),
  };
}

describe('createStatsOverlay', () => {
  let parent: HTMLElement;
  let instances: ReturnType<typeof makeFakeStats>[];
  let factory: () => StatsInstance;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    instances = [];
    factory = () => {
      const fake = makeFakeStats();
      instances.push(fake);
      return fake;
    };
  });

  it('mounts FPS + MS + MB panels side-by-side when memory stats are supported', () => {
    const overlay = createStatsOverlay(parent, {
      statsFactory: factory,
      memorySupported: true,
    });
    expect(overlay.panelCount).toBe(3);
    expect(instances).toHaveLength(3);
    // One Stats instance per panel, each pinned to its panel id (0=FPS,
    // 1=MS, 2=MB) — the all-visible-at-once decision from the 2026-07-03
    // interview (tap-to-cycle is unusable mid-walk in AR).
    expect(instances.map((s) => s.shown)).toEqual([[0], [1], [2]]);
    expect(parent.contains(overlay.dom)).toBe(true);
    for (const s of instances) {
      expect(overlay.dom.contains(s.dom)).toBe(true);
      // Real Stats.js pins itself `position:fixed` at the viewport corner —
      // the overlay must neutralize that so the flex row can lay panels out.
      expect(s.dom.style.position).toBe('relative');
    }
  });

  it('omits the MB panel when performance.memory is unavailable', () => {
    const overlay = createStatsOverlay(parent, {
      statsFactory: factory,
      memorySupported: false,
    });
    expect(overlay.panelCount).toBe(2);
    expect(instances.map((s) => s.shown)).toEqual([[0], [1]]);
  });

  it('does not intercept taps meant for the HUD (pointer-events none)', () => {
    // In immersive AR the overlay shares the dom-overlay layer with the HUD;
    // panels are read-only displays, so they must never swallow touches.
    const overlay = createStatsOverlay(parent, {
      statsFactory: factory,
      memorySupported: true,
    });
    expect(overlay.dom.style.pointerEvents).toBe('none');
  });

  it('forwards update() to every panel instance', () => {
    const overlay = createStatsOverlay(parent, {
      statsFactory: factory,
      memorySupported: true,
    });
    overlay.update();
    overlay.update();
    for (const s of instances) {
      expect(s.update).toHaveBeenCalledTimes(2);
    }
  });

  it('dispose() removes the DOM node and makes update() a no-op; both are idempotent', () => {
    // A leaked overlay node across Enter-AR cycles would stack duplicate
    // panels — the same leak class as the frame-tile visualizer teardown.
    const overlay = createStatsOverlay(parent, {
      statsFactory: factory,
      memorySupported: true,
    });
    overlay.dispose();
    expect(parent.contains(overlay.dom)).toBe(false);
    overlay.update();
    for (const s of instances) {
      expect(s.update).not.toHaveBeenCalled();
    }
    expect(() => overlay.dispose()).not.toThrow();
  });

  it('a throwing panel update does not break the other panels or the caller', () => {
    // update() runs inside the XR frame callback — a Stats hiccup must never
    // kill the render loop (defensive rule: isolate per-panel failures).
    const overlay = createStatsOverlay(parent, {
      statsFactory: factory,
      memorySupported: true,
    });
    instances[0]!.update.mockImplementation(() => {
      throw new Error('panel exploded');
    });
    expect(() => overlay.update()).not.toThrow();
    expect(instances[1]!.update).toHaveBeenCalledTimes(1);
    expect(instances[2]!.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a detached/invalid parent', () => {
    expect(() =>
      createStatsOverlay(null as unknown as HTMLElement, {
        statsFactory: factory,
      })
    ).toThrow(TypeError);
  });
});
