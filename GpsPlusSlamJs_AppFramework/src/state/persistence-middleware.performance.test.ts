/**
 * Performance guard for persistence middleware synchronous overhead.
 *
 * Why this test matters: The persistence middleware runs on EVERY Redux
 * dispatch during recording. Its synchronous path (action type checks,
 * recording state checks, index increment, WriteQueue enqueue) must not
 * add perceptible latency to the dispatch cycle, and — critically — it
 * must stay O(1) per dispatch. The actual async OPFS writes are
 * non-blocking and not measured here.
 *
 * How it asserts that (and why it is NOT a wall-clock budget):
 *
 * The previous version compared a single per-dispatch wall-clock sample
 * against a hard 0.1 ms threshold. That is inherently flaky — the same
 * code is "correct" at 0.099 ms and "broken" at 0.101 ms purely from
 * scheduler noise, GC, and whatever else the full suite runs concurrently
 * (see GpsPlusSlamJs_Docs/docs/2026-06-15-0922-flaky-persistence-perf-test-followup.md).
 *
 * Instead we assert the *algorithmic invariant* the test actually cares
 * about: per-dispatch cost does not grow with the number of dispatches in
 * a burst. We measure the median per-dispatch time for a small burst and a
 * much larger burst (20×) and assert the ratio stays below a generous
 * factor. O(1) work yields a ratio near 1; an accidental O(n) regression
 * in the hot path (e.g. scanning the growing WriteQueue on each enqueue)
 * would balloon the large-burst figure and trip the assertion. Because both
 * figures scale together with machine speed, the ratio is robust to load.
 *
 * A very generous absolute ceiling (far above observed ~0.01 ms) is kept
 * only as a backstop against a catastrophic regression, not as the primary
 * signal.
 */

import { describe, expect, test, vi } from 'vitest';
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { StorageBackend } from '../storage/storage-backend';
import { createPersistenceMiddleware } from './persistence-middleware';

// ---------------------------------------------------------------------------
// Minimal slices (mirror the test helper pattern from persistence-middleware.test.ts)
// ---------------------------------------------------------------------------

const testRecorderSlice = createSlice({
  name: 'recorder',
  initialState: { isRecording: false, failedWriteCount: 0 },
  reducers: {
    startSession(state) {
      state.isRecording = true;
      state.failedWriteCount = 0;
    },
    endSession(state) {
      state.isRecording = false;
    },
    recordWriteFailure(state) {
      state.failedWriteCount += 1;
    },
  },
});

const testGpsDataSlice = createSlice({
  name: 'gpsData',
  initialState: null as { lat: number; lon: number } | null,
  reducers: {
    setZeroPos(_state, action: PayloadAction<{ lat: number; lon: number }>) {
      return action.payload;
    },
  },
});

// ---------------------------------------------------------------------------
// Store factory + measurement helpers
// ---------------------------------------------------------------------------

/**
 * Build a store wired with the persistence middleware over an instant-resolving
 * mock backend, so only the middleware's own synchronous code is measured.
 * When `recording` is true the middleware enters its hot path (enqueue per
 * dispatch); otherwise it early-exits.
 */
function makeStore(recording: boolean) {
  const mockBackend: StorageBackend = {
    createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
    listSessions: vi.fn().mockResolvedValue([]),
    writeAction: vi.fn().mockResolvedValue(undefined),
    writeFrame: vi.fn().mockResolvedValue(undefined),
    writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
  };

  const store = configureStore({
    reducer: {
      recorder: testRecorderSlice.reducer,
      gpsData: testGpsDataSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }).concat(
        createPersistenceMiddleware({
          storageBackend: mockBackend,
          persistedPrefixes: ['gpsData', 'recording'],
        })
      ),
  });

  if (recording) {
    store.dispatch(testRecorderSlice.actions.startSession());
  }
  return store;
}

const SAMPLE_ACTION = testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 });

/**
 * Measure the average synchronous overhead per dispatch over a single burst.
 * A fresh store is used per call so the WriteQueue does not carry state across
 * measurements (microtasks that drain the queue cannot run inside this
 * synchronous loop, so reusing a store would let the queue grow unbounded
 * across passes and pollute the comparison).
 */
function measureAvgPerDispatchMs(
  recording: boolean,
  dispatchCount: number
): number {
  const store = makeStore(recording);
  const start = performance.now();
  for (let i = 0; i < dispatchCount; i += 1) {
    store.dispatch(SAMPLE_ACTION);
  }
  return (performance.now() - start) / dispatchCount;
}

/** Median of several measurement passes — robust to occasional GC/scheduler spikes. */
function medianAvgPerDispatchMs(
  recording: boolean,
  dispatchCount: number,
  passes: number
): number {
  const samples: number[] = [];
  for (let p = 0; p < passes; p += 1) {
    samples.push(measureAvgPerDispatchMs(recording, dispatchCount));
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Small burst — the per-dispatch baseline. */
const SMALL_BURST = 200;

/**
 * Large burst — 20× the small one. If the hot path were O(n) in the number of
 * queued writes, the per-dispatch figure here would grow ~20×; O(1) keeps it
 * flat. The queue grows to LARGE_BURST entries because the instant-resolving
 * backend's drain runs on microtasks that cannot fire inside the synchronous
 * loop — exactly the condition under which an O(n) enqueue would show up.
 */
const LARGE_BURST = SMALL_BURST * 20;

/** Median over several passes to de-noise the comparison. */
const MEASUREMENT_PASSES = 5;

/**
 * Warm-up dispatches (discarded) to let the JIT compile the hot path before we
 * time anything, so the baseline isn't inflated by cold-start cost (which would
 * understate the ratio).
 */
const WARMUP_DISPATCHES = 500;

/**
 * Maximum acceptable large/small per-dispatch ratio. O(1) work yields ~1;
 * we allow up to 4× to absorb the fixed-cost dilution and measurement noise
 * that vary between the two burst sizes. A true O(n) regression would land
 * near 20× and trip this immediately.
 */
const MAX_SCALING_FACTOR = 4;

/**
 * Generous absolute backstop in milliseconds. Observed cost is ~0.01 ms; this
 * ceiling is ~100× that, so it never fires on scheduler noise — only on a
 * catastrophic regression. It is a safety net, not the primary signal.
 */
const ABSOLUTE_CEILING_MS = 1;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persistence middleware synchronous overhead', () => {
  test(
    'per-dispatch overhead during recording stays O(1) as the burst grows',
    { timeout: 15_000 },
    () => {
      // Warm up the hot path (JIT) before timing.
      measureAvgPerDispatchMs(true, WARMUP_DISPATCHES);

      const small = medianAvgPerDispatchMs(
        true,
        SMALL_BURST,
        MEASUREMENT_PASSES
      );
      const large = medianAvgPerDispatchMs(
        true,
        LARGE_BURST,
        MEASUREMENT_PASSES
      );
      const ratio = large / small;

      if (process.env.DEBUG_PERF === '1') {
        console.info(
          `[perf] recording per-dispatch ms — small: ${small.toFixed(6)}, ` +
            `large: ${large.toFixed(6)}, ratio: ${ratio.toFixed(2)}`
        );
      }

      // Primary signal: cost does not scale with burst size (O(1) per dispatch).
      expect(ratio).toBeLessThanOrEqual(MAX_SCALING_FACTOR);
      // Backstop: no catastrophic absolute regression.
      expect(large).toBeLessThanOrEqual(ABSOLUTE_CEILING_MS);
    }
  );

  test(
    'per-dispatch overhead when NOT recording stays O(1) as the burst grows',
    { timeout: 15_000 },
    () => {
      // Warm up the early-exit path (JIT) before timing.
      measureAvgPerDispatchMs(false, WARMUP_DISPATCHES);

      const small = medianAvgPerDispatchMs(
        false,
        SMALL_BURST,
        MEASUREMENT_PASSES
      );
      const large = medianAvgPerDispatchMs(
        false,
        LARGE_BURST,
        MEASUREMENT_PASSES
      );
      const ratio = large / small;

      if (process.env.DEBUG_PERF === '1') {
        console.info(
          `[perf] not-recording per-dispatch ms — small: ${small.toFixed(6)}, ` +
            `large: ${large.toFixed(6)}, ratio: ${ratio.toFixed(2)}`
        );
      }

      // The early-exit path does no enqueue; it must also stay flat.
      expect(ratio).toBeLessThanOrEqual(MAX_SCALING_FACTOR);
      expect(large).toBeLessThanOrEqual(ABSOLUTE_CEILING_MS);
    }
  );
});
