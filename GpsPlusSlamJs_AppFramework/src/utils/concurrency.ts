/**
 * Concurrency Utilities
 *
 * Provides helpers for limiting the number of concurrent async operations.
 * Used to prevent excessive memory consumption when scanning many files
 * in parallel (e.g., reading zip metadata during scenario discovery).
 */

/**
 * Map over an array with a concurrency limit on the async mapper function.
 *
 * Behaves like `Promise.all(items.map(fn))` but limits how many mapper
 * invocations run simultaneously. Results are returned in the same order
 * as the input items.
 *
 * @param items - Array of items to process
 * @param limit - Maximum number of concurrent mapper invocations
 * @param mapper - Async function to apply to each item
 * @returns Array of results in the same order as input items
 * @throws Re-throws the first error from any mapper invocation (fail-fast)
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (limit < 1) {
    throw new RangeError(`Concurrency limit must be >= 1, got ${limit}`);
  }

  const results: R[] = new Array<R>(items.length);

  if (items.length === 0) {
    return results;
  }

  // Use a pool of workers that pull from a shared index counter
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      // Safe: read + increment is synchronous (no yield between while-check and capture),
      // so no two workers can grab the same index.
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  };

  // Start `limit` workers (or fewer if items.length < limit)
  const workerCount = Math.min(limit, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Run an async worker over each item with a concurrency cap, invoking the worker
 * per item as the pool pulls it (rather than collecting results into an array).
 *
 * Unlike {@link mapWithConcurrencyLimit}, this returns no values — the worker is
 * expected to produce its side effect (e.g. emit a streaming callback) itself.
 * This is the shape progressive consumers need: each item is handled and can be
 * reported as soon as it settles, instead of waiting for the whole batch.
 *
 * Completion order is **not** guaranteed (it depends on which worker finishes
 * first). Each item's worker is invoked exactly once unless the run is aborted.
 *
 * When an `AbortSignal` is supplied, workers stop pulling **new** items as soon
 * as the signal is aborted (checked before each pull). Items already in flight
 * run to completion — the File System Access reads underneath cannot be torn
 * mid-read — but no further items are started, so a destroyed consumer stops
 * accumulating work. If the signal is already aborted, no work starts at all.
 *
 * @param items - Items to process
 * @param limit - Maximum number of concurrent worker invocations (`>= 1`)
 * @param worker - Async side-effecting function applied to each item
 * @param signal - Optional abort signal that halts pulling new items
 * @throws RangeError if `limit < 1`
 * @throws Re-throws the first error from any worker invocation (fail-fast)
 */
export async function forEachWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (limit < 1) {
    throw new RangeError(`Concurrency limit must be >= 1, got ${limit}`);
  }

  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;

  const pump = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        return;
      }
      // Safe: read + increment is synchronous (no yield between the guard and
      // the capture), so no two workers can grab the same index.
      const currentIndex = nextIndex++;
      await worker(items[currentIndex]!, currentIndex);
    }
  };

  const workerCount = Math.min(limit, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(pump());
  }

  await Promise.all(workers);
}
