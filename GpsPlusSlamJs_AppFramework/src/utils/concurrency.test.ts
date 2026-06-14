/**
 * Tests for concurrency utilities.
 *
 * Why these tests matter: The mapWithConcurrencyLimit utility controls how many
 * async operations run simultaneously. This is critical for memory-efficient
 * scanning of many large zip files (discoverScenariosFromZipMetadata) — without
 * a concurrency cap, Promise.all on 50 large zips would load all of them into
 * memory at once, potentially crashing the browser tab.
 */

import { describe, it, expect } from 'vitest';
import {
  mapWithConcurrencyLimit,
  forEachWithConcurrencyLimit,
} from './concurrency';

describe('mapWithConcurrencyLimit', () => {
  it('maps all items and returns results in order', async () => {
    // Why: Basic contract — results must be in the same order as input items,
    // regardless of which tasks finish first.
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrencyLimit(items, 2, (x) =>
      Promise.resolve(x * 10)
    );

    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('returns empty array for empty input', async () => {
    // Why: Edge case — no items means no work, no errors.
    const results = await mapWithConcurrencyLimit([], 3, (x: number) =>
      Promise.resolve(x)
    );
    expect(results).toEqual([]);
  });

  it('works when concurrency limit exceeds item count', async () => {
    // Why: Concurrency limit larger than the array should behave like Promise.all
    // (all items run at once).
    const items = [1, 2];
    const results = await mapWithConcurrencyLimit(items, 100, (x) =>
      Promise.resolve(x + 1)
    );
    expect(results).toEqual([2, 3]);
  });

  it('limits concurrent executions to the specified count', async () => {
    // Why: This is the core behavior — at no point should more than `limit`
    // tasks be running simultaneously.
    let activeTasks = 0;
    let peakConcurrency = 0;
    const concurrencyLimit = 2;

    const items = [1, 2, 3, 4, 5, 6];

    await mapWithConcurrencyLimit(items, concurrencyLimit, async (item) => {
      activeTasks++;
      peakConcurrency = Math.max(peakConcurrency, activeTasks);
      // Simulate async work with a small delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeTasks--;
      return item;
    });

    expect(peakConcurrency).toBeLessThanOrEqual(concurrencyLimit);
    // Also verify work actually ran concurrently (not sequentially one-by-one)
    expect(peakConcurrency).toBe(concurrencyLimit);
  });

  it('propagates errors from the mapper function', async () => {
    // Why: If one task fails, the entire operation should fail with that error.
    // This matches Promise.all semantics — fail fast.
    const items = [1, 2, 3];

    await expect(
      mapWithConcurrencyLimit(items, 2, (x) => {
        if (x === 2) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve(x);
      })
    ).rejects.toThrow('boom');
  });

  it('stops pulling new items once a mapper fails (fail-fast)', async () => {
    // Why: the docs promise fail-fast, but Promise.all only makes the *caller*
    // see the first rejection — the sibling worker loops keep pulling new items
    // and running the mapper in the background, wasting I/O after the operation
    // has already been reported as failed. With a shared failure flag, surviving
    // workers stop pulling once any worker has thrown.
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const processed: number[] = [];

    const promise = mapWithConcurrencyLimit(items, 2, async (x, i) => {
      processed.push(x);
      if (i === 0) {
        throw new Error('boom');
      }
      // Slow enough that, without fail-fast, the surviving worker would loop
      // back and drain the rest of the queue after the failure is observed.
      await new Promise((r) => setTimeout(r, 10));
      return x;
    });

    await expect(promise).rejects.toThrow('boom');

    // Let any background loops settle; with the bug they drain all 8 items.
    await new Promise((r) => setTimeout(r, 100));

    expect(processed.length).toBeLessThan(items.length);
  });

  it('handles concurrency limit of 1 (sequential execution)', async () => {
    // Why: Limit=1 means tasks run one at a time. This is the most restrictive
    // setting and should still produce correct, ordered results.
    const executionOrder: number[] = [];
    const items = [3, 1, 2];

    const results = await mapWithConcurrencyLimit(items, 1, async (x) => {
      executionOrder.push(x);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x * 2;
    });

    expect(results).toEqual([6, 2, 4]);
    expect(executionOrder).toEqual([3, 1, 2]); // Sequential = input order
  });

  it('throws RangeError when limit is 0', async () => {
    // Why: limit=0 would cause zero workers to start, silently returning an
    // array of undefined values — violating the Promise.all contract. The
    // function must reject invalid limits early with a clear error.
    await expect(
      mapWithConcurrencyLimit([1, 2], 0, (x) => Promise.resolve(x))
    ).rejects.toThrow(RangeError);
  });

  it('throws RangeError when limit is negative', async () => {
    // Why: Negative limits are nonsensical and would also produce zero workers.
    // Guard against accidental misuse (e.g., off-by-one calculations).
    await expect(
      mapWithConcurrencyLimit([1, 2], -1, (x) => Promise.resolve(x))
    ).rejects.toThrow(RangeError);
  });

  it('includes the invalid value in the RangeError message', async () => {
    // Why: A descriptive error message helps callers quickly identify
    // the root cause without needing to step through the code.
    await expect(
      mapWithConcurrencyLimit([1], 0, (x) => Promise.resolve(x))
    ).rejects.toThrow('Concurrency limit must be >= 1, got 0');
  });
});

describe('forEachWithConcurrencyLimit', () => {
  // Why these tests matter: unlike mapWithConcurrencyLimit (which resolves the
  // whole array before returning), forEachWithConcurrencyLimit invokes its
  // worker per item as the pool pulls it. The map-centric browser's progressive
  // index (`streamRecordingIndex`) needs this "emit as each settles" shape plus
  // an AbortSignal so closing the browser stops pulling new work mid-stream.

  it('invokes the worker exactly once per item', async () => {
    // Why: streaming must place every recording exactly once — no drops, no
    // duplicates — even though completion order is not guaranteed.
    const items = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    await forEachWithConcurrencyLimit(items, 2, (x) => {
      seen.push(x);
      return Promise.resolve();
    });
    expect([...seen].sort((a, b) => a - b)).toEqual(items);
  });

  it('is a no-op for empty input', async () => {
    let calls = 0;
    await forEachWithConcurrencyLimit([], 3, () => {
      calls++;
      return Promise.resolve();
    });
    expect(calls).toBe(0);
  });

  it('caps the number of concurrently active workers', async () => {
    // Why: legacy backfill reads every GPS action file; an uncapped fan-out over
    // 70 zips would thrash browser I/O. The cap is the whole point.
    let active = 0;
    let peak = 0;
    await forEachWithConcurrencyLimit([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
    expect(peak).toBe(2);
  });

  it('stops pulling new items once the signal is aborted', async () => {
    // Why: closing the browser (or opening another folder) must abort the
    // in-flight stream so it stops reading zips into a destroyed map. In-flight
    // workers may finish, but no NEW items are pulled after the abort.
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const controller = new AbortController();
    const processed: number[] = [];
    await forEachWithConcurrencyLimit(
      items,
      2,
      async (x) => {
        processed.push(x);
        await new Promise((r) => setTimeout(r, 10));
        // Abort partway through: after the first batch, no further items start.
        if (processed.length === 2) {
          controller.abort();
        }
      },
      controller.signal
    );
    // Only the first concurrent batch (2 workers) ran; the rest were never pulled.
    expect(processed.length).toBeLessThan(items.length);
    expect(processed.length).toBeLessThanOrEqual(4);
  });

  it('does not start any work when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await forEachWithConcurrencyLimit(
      [1, 2, 3],
      2,
      () => {
        calls++;
        return Promise.resolve();
      },
      controller.signal
    );
    expect(calls).toBe(0);
  });

  it('stops pulling new items once a worker fails (fail-fast)', async () => {
    // Why: streaming workers are side-effecting (they emit recordings into a
    // consumer). Once one worker throws and the caller observes the rejection,
    // the surviving workers must stop pulling new items — otherwise they keep
    // emitting into a consumer that is already tearing down. This mirrors the
    // abort path ("stop pulling new items") for the internal-failure case.
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const processed: number[] = [];

    const promise = forEachWithConcurrencyLimit(items, 2, async (x, i) => {
      processed.push(x);
      if (i === 0) {
        throw new Error('boom');
      }
      await new Promise((r) => setTimeout(r, 10));
    });

    await expect(promise).rejects.toThrow('boom');

    // Let any background loops settle; with the bug they drain all 8 items.
    await new Promise((r) => setTimeout(r, 100));

    expect(processed.length).toBeLessThan(items.length);
  });

  it('throws RangeError when limit is below 1', async () => {
    await expect(
      forEachWithConcurrencyLimit([1, 2], 0, () => Promise.resolve())
    ).rejects.toThrow(RangeError);
  });
});
