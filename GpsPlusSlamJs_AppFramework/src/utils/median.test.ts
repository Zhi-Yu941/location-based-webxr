import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { interpolatingMedian, lowerMedian } from './median.js';

// Why this suite matters: these helpers replaced six private copies with two
// silently different semantics (quality-review A-2). The exact odd/even/empty
// behaviours below are what the six former call sites relied on — a drift
// here would shift QR sizing, tracking-quality scoring, anchor averaging and
// pose aggregation at once.
describe('interpolatingMedian', () => {
  it('returns the middle value for odd-length input', () => {
    expect(interpolatingMedian([3, 1, 2])).toBe(2);
  });

  it('returns the mean of the two middle values for even-length input', () => {
    expect(interpolatingMedian([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns the sole value for a single-element input', () => {
    expect(interpolatingMedian([7])).toBe(7);
  });

  it('returns 0 for empty input (tracking-quality "no samples yet" neutral)', () => {
    expect(interpolatingMedian([])).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    interpolatingMedian(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('is permutation-invariant and bounded by [min, max]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (values) => {
          const m = interpolatingMedian(values);
          const shuffled = [...values].reverse();
          expect(interpolatingMedian(shuffled)).toBe(m);
          expect(m).toBeGreaterThanOrEqual(Math.min(...values));
          expect(m).toBeLessThanOrEqual(Math.max(...values));
        }
      )
    );
  });
});

describe('lowerMedian', () => {
  it('returns the middle value for odd-length input', () => {
    expect(lowerMedian([3, 1, 2])).toBe(2);
  });

  it('returns the LOWER of the two middle values for even-length input', () => {
    expect(lowerMedian([4, 1, 3, 2])).toBe(2);
  });

  it('returns the sole value for a single-element input', () => {
    expect(lowerMedian([7])).toBe(7);
  });

  it('returns NaN for empty input (defensive; callers guarantee non-empty)', () => {
    expect(Number.isNaN(lowerMedian([]))).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    lowerMedian(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('always returns an actually-observed element (never fabricates)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 50,
        }),
        (values) => {
          expect(values).toContain(lowerMedian(values));
        }
      )
    );
  });
});
