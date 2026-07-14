/**
 * Tests for ar-session-scope — the disposer registry that owns teardown of
 * AR-session-scoped resources in main.ts.
 *
 * Why these tests matter: main.ts used to hand-maintain every resource's
 * teardown in up to four places (declaration, dispose-first guard,
 * creation, resetMainState), and the enter/reset symmetry drifted more
 * than once (see the 2026-07-11 lifecycle-scope plan doc). The registry
 * makes teardown a single registration at the creation site — these tests
 * pin the semantics main.ts relies on: reverse-order disposal, one-shot
 * disposers, error isolation, and wire()'s gate/warn/auto-register shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { createArSessionScope } from './ar-session-scope';

describe('createArSessionScope', () => {
  describe('add + dispose', () => {
    it('runs disposers in reverse registration order', () => {
      const scope = createArSessionScope(vi.fn());
      const order: string[] = [];
      scope.add('a', () => order.push('a'));
      scope.add('b', () => order.push('b'));
      scope.add('c', () => order.push('c'));
      scope.dispose();
      expect(order).toEqual(['c', 'b', 'a']);
    });

    it('runs each disposer exactly once — a second dispose is a no-op', () => {
      const scope = createArSessionScope(vi.fn());
      const disposer = vi.fn();
      scope.add('x', disposer);
      scope.dispose();
      scope.dispose();
      expect(disposer).toHaveBeenCalledTimes(1);
    });

    it('a throwing disposer does not strand the remaining ones and is reported via warn', () => {
      const warn = vi.fn();
      const scope = createArSessionScope(warn);
      const order: string[] = [];
      scope.add('a', () => order.push('a'));
      scope.add('boom', () => {
        throw new Error('boom');
      });
      scope.add('c', () => order.push('c'));
      scope.dispose();
      expect(order).toEqual(['c', 'a']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('boom');
    });

    it('a disposer registered DURING dispose() lands in the fresh registry (next session), not the running one', () => {
      const scope = createArSessionScope(vi.fn());
      const late = vi.fn();
      scope.add('outer', () => {
        scope.add('late', late);
      });
      scope.dispose();
      expect(late).not.toHaveBeenCalled();
      scope.dispose();
      expect(late).toHaveBeenCalledTimes(1);
    });
  });

  describe('wire', () => {
    it('skips the factory entirely when not enabled', () => {
      const scope = createArSessionScope(vi.fn());
      const factory = vi.fn();
      scope.wire('frame tiles', false, factory);
      expect(factory).not.toHaveBeenCalled();
    });

    it('runs the factory when enabled and auto-registers a returned disposer', () => {
      const scope = createArSessionScope(vi.fn());
      const disposer = vi.fn();
      scope.wire('frame tiles', true, () => disposer);
      expect(disposer).not.toHaveBeenCalled();
      scope.dispose();
      expect(disposer).toHaveBeenCalledTimes(1);
    });

    it('tolerates a factory that returns nothing', () => {
      const scope = createArSessionScope(vi.fn());
      scope.wire('compass cubes', true, () => undefined);
      expect(() => scope.dispose()).not.toThrow();
    });

    it('a throwing factory warns with the block name and does not propagate (recording continues)', () => {
      const warn = vi.fn();
      const scope = createArSessionScope(warn);
      expect(() =>
        scope.wire('occupancy grid', true, () => {
          throw new Error('no WebGL');
        })
      ).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('occupancy grid');
      expect(warn.mock.calls[0]?.[0]).toContain('skipped');
    });

    it('a throwing factory registers no disposer', () => {
      const warn = vi.fn();
      const scope = createArSessionScope(warn);
      scope.wire('occupancy grid', true, () => {
        throw new Error('no WebGL');
      });
      const after = vi.fn();
      scope.add('after', after);
      scope.dispose();
      expect(after).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('interleaves with add() in one reverse order', () => {
      const scope = createArSessionScope(vi.fn());
      const order: string[] = [];
      scope.add('a', () => order.push('a'));
      scope.wire('b', true, () => () => order.push('b'));
      scope.add('c', () => order.push('c'));
      scope.dispose();
      expect(order).toEqual(['c', 'b', 'a']);
    });
  });
});
