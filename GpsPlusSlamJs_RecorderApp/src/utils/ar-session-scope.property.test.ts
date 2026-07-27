/**
 * Property tests for ar-session-scope.
 *
 * Why this test matters: main.ts registers ~19 disposers per AR session in
 * an order that encodes real teardown dependencies (subscriptions unwind
 * before the visualizers they feed). The registry's guarantee — every
 * disposer runs exactly once, in exact reverse registration order, even
 * when an arbitrary subset throws — must hold for ANY registration
 * sequence, not just the hand-picked unit-test cases.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { createArSessionScope } from './ar-session-scope';

describe('ar-session-scope properties', () => {
  it('every disposer runs exactly once, in exact reverse order, regardless of which ones throw', () => {
    fc.assert(
      fc.property(
        // Each entry: does this disposer throw?
        fc.array(fc.boolean(), { minLength: 0, maxLength: 30 }),
        (throwFlags) => {
          const warn = vi.fn();
          const scope = createArSessionScope(warn);
          const calls: number[] = [];
          throwFlags.forEach((throws, i) => {
            scope.add(`d${i}`, () => {
              calls.push(i);
              if (throws) throw new Error(`d${i} failed`);
            });
          });

          scope.dispose();

          const expectedOrder = throwFlags.map((_, i) => i).reverse();
          expect(calls).toEqual(expectedOrder);
          expect(warn).toHaveBeenCalledTimes(throwFlags.filter(Boolean).length);

          // One-shot: a second dispose must not re-run anything.
          calls.length = 0;
          scope.dispose();
          expect(calls).toEqual([]);
        }
      )
    );
  });
});
