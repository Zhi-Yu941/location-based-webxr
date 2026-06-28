/**
 * Tests for persistence middleware.
 *
 * Why these tests matter: The persistence middleware replaces the inline
 * persistence logic previously embedded in the manual dispatch wrapper.
 * These tests verify that action persistence, filtering, error handling,
 * and per-instance action indexing behave identically to the original
 * implementation.
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md §4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { StorageBackend } from '../storage/storage-backend';
import {
  createPersistenceMiddleware,
  slicePrefixOf,
  type PersistenceMiddlewareOptions,
} from './persistence-middleware';

// Minimal recorder-like slice for testing
const testRecorderSlice = createSlice({
  name: 'recording',
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

// Minimal gpsData-like slice for testing
const testGpsDataSlice = createSlice({
  name: 'gpsData',
  initialState: null as { zero: { lat: number; lon: number } } | null,
  reducers: {
    setZeroPos(_state, action: PayloadAction<{ lat: number; lon: number }>) {
      return { zero: action.payload };
    },
  },
});

function createTestStore(
  options: Omit<PersistenceMiddlewareOptions, 'persistedPrefixes'> &
    Partial<Pick<PersistenceMiddlewareOptions, 'persistedPrefixes'>>
) {
  return configureStore({
    reducer: {
      recording: testRecorderSlice.reducer,
      gpsData: testGpsDataSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }).concat(
        createPersistenceMiddleware({
          // Default to the framework's built-in persisted slices; individual
          // tests override to assert the whitelist is data-driven.
          persistedPrefixes: ['gpsData', 'recording'],
          ...options,
        })
      ),
  });
}

describe('Persistence Middleware', () => {
  function createMockBackend() {
    return {
      createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
      listSessions: vi.fn().mockResolvedValue([]),
      writeAction: vi.fn().mockResolvedValue(undefined),
      writeFrame: vi.fn().mockResolvedValue(undefined),
      writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
    } as StorageBackend & {
      createSession: ReturnType<typeof vi.fn>;
      listSessions: ReturnType<typeof vi.fn>;
      writeAction: ReturnType<typeof vi.fn>;
      writeFrame: ReturnType<typeof vi.fn>;
      writeSessionMetadata: ReturnType<typeof vi.fn>;
    };
  }

  let mockBackend: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    mockBackend = createMockBackend();
  });

  // Why: Core behavior — actions should only be persisted during recording.
  it('should NOT persist actions when not recording', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 }));
    expect(mockBackend.writeAction).not.toHaveBeenCalled();
  });

  // Why: The startSession action itself must be persisted even though
  // isRecording was false before the dispatch. After the reducer runs,
  // isRecording is true, including startSession in the persistence scope.
  it('should persist the startSession action itself', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());
    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recording/startSession' }),
      1
    );
  });

  // Why: gpsData/ actions contain sensor data that must be replayed.
  it('should persist gpsData/ actions during recording', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 }));
    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gpsData/setZeroPos' }),
      2
    );
  });

  // Why: refPoints/ actions are the canonical mark log after the
  // 2026-05-27 slice-collapse plan (Step 5.7a-3). The persistence layer
  // must include them so live recordings replay marks correctly.
  //
  // NOTE: the production `refPoints` slice lives in the consuming
  // RecorderApp, which depends on this framework — so this framework-side
  // test cannot import it without inverting the dependency. It therefore
  // asserts on the literal production action-type prefix (`refPoints/`).
  // The end-to-end drift guard that wires the REAL slice and REAL
  // middleware together lives in the recorder
  // (`recorder-store.test.ts` → "should persist refPoints/ mark actions").
  it('should persist refPoints/ actions during recording', () => {
    const refPointsSlice = createSlice({
      name: 'refPoints',
      initialState: { entries: [] as unknown[] },
      reducers: {
        addRefPointEntry(state, action: PayloadAction<unknown>) {
          state.entries.push(action.payload);
        },
      },
    });

    const store = configureStore({
      reducer: {
        recording: testRecorderSlice.reducer,
        gpsData: testGpsDataSlice.reducer,
        refPoints: refPointsSlice.reducer,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
          serializableCheck: false,
          immutableCheck: false,
        }).concat(
          createPersistenceMiddleware({
            storageBackend: mockBackend,
            persistedPrefixes: ['gpsData', 'recording', 'refPoints'],
          })
        ),
    });

    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(
      refPointsSlice.actions.addRefPointEntry({
        id: 'cell-1',
        timestamp: 123,
      })
    );
    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'refPoints/addRefPointEntry' }),
      2
    );
  });

  // Why: recorder/ actions (except recordWriteFailure) are session metadata.
  it('should persist recorder/ actions during recording', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());
    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recording/startSession' }),
      1
    );
  });

  // Why: Recursive persistence prevention — recordWriteFailure dispatched
  // from the error path must NOT trigger another writeAction call.
  it('should NOT persist recordWriteFailure actions', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(testRecorderSlice.actions.recordWriteFailure());
    expect(mockBackend.writeAction).not.toHaveBeenCalled();
  });

  // Why: routing/ actions are UI-level state and not part of the recording.
  it('should NOT persist routing/ actions during recording', () => {
    const routingSlice = createSlice({
      name: 'routing',
      initialState: { currentScreen: 'setup' },
      reducers: {
        navigateTo(state, action: PayloadAction<string>) {
          state.currentScreen = action.payload;
        },
      },
    });

    const store = configureStore({
      reducer: {
        recording: testRecorderSlice.reducer,
        gpsData: testGpsDataSlice.reducer,
        routing: routingSlice.reducer,
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

    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(routingSlice.actions.navigateTo('ar'));
    expect(mockBackend.writeAction).not.toHaveBeenCalled();
  });

  // Why: After stopping recording, subsequent actions must not be persisted.
  it('should stop persisting after endSession', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());
    store.dispatch(testRecorderSlice.actions.endSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 }));
    expect(mockBackend.writeAction).not.toHaveBeenCalled();
  });

  // Why: 1-based indexing matches the OPFS storage directory convention.
  it('should use 1-based indexing for persisted actions', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession()); // index 1
    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 })); // index 2

    expect(mockBackend.writeAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'recording/startSession' }),
      1
    );
    expect(mockBackend.writeAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'gpsData/setZeroPos' }),
      2
    );
  });

  // Why: Bug 10 — each store instance must maintain its own counter.
  it('should use per-middleware-instance action indices', () => {
    const backend1 = createMockBackend();
    const backend2 = createMockBackend();

    const store1 = createTestStore({ storageBackend: backend1 });
    const store2 = createTestStore({ storageBackend: backend2 });

    store1.dispatch(testRecorderSlice.actions.startSession()); // store1: index 1
    store2.dispatch(testRecorderSlice.actions.startSession()); // store2: index 1

    expect(backend1.writeAction).toHaveBeenCalledWith(expect.anything(), 1);
    expect(backend2.writeAction).toHaveBeenCalledWith(expect.anything(), 1);
  });

  // Why: Write failures must be reported to the UI via callback.
  it('should call onWriteFailure when write fails', async () => {
    const onWriteFailure = vi.fn();
    const error = new Error('write failed');
    mockBackend.writeAction.mockRejectedValueOnce(error);

    const store = createTestStore({
      storageBackend: mockBackend,
      onWriteFailure,
    });
    store.dispatch(testRecorderSlice.actions.startSession());

    await vi.waitFor(() => {
      expect(onWriteFailure).toHaveBeenCalledWith(error);
    });
  });

  // Why: Write failures must increment failedWriteCount in state.
  it('should dispatch recordWriteFailure on write error', async () => {
    mockBackend.writeAction.mockRejectedValueOnce(new Error('disk full'));

    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());

    await vi.waitFor(() => {
      expect(store.getState().recording.failedWriteCount).toBe(1);
    });
  });

  // Why: JS allows rejecting with any value; errors must be normalized.
  it('should normalize non-Error rejections', async () => {
    const onWriteFailure = vi.fn();
    mockBackend.writeAction.mockRejectedValueOnce('string error');

    const store = createTestStore({
      storageBackend: mockBackend,
      onWriteFailure,
    });
    store.dispatch(testRecorderSlice.actions.startSession());

    await vi.waitFor(() => {
      expect(onWriteFailure).toHaveBeenCalledTimes(1);
    });

    const receivedError = onWriteFailure.mock.calls[0][0] as Error;
    expect(receivedError).toBeInstanceOf(Error);
    expect(receivedError.message).toBe('string error');
  });

  // Why: The middleware must let all actions through to reducers regardless
  // of persistence logic — it is observational, not blocking.
  it('should always pass actions through to reducers', () => {
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 48, lon: 2 }));
    expect(store.getState().gpsData).toEqual({ zero: { lat: 48, lon: 2 } });
  });

  // Why: Without backpressure, fire-and-forget writeAction calls accumulate
  // unboundedly when storage is slow. On low-end mobile devices, this causes
  // memory pressure. Concurrent writes should be capped.
  it('should limit concurrent writes when storage is slow', async () => {
    let pendingWrites = 0;
    let maxPendingWrites = 0;
    const writePromises: Array<() => void> = [];

    const slowBackend: StorageBackend = {
      createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
      listSessions: vi.fn().mockResolvedValue([]),
      writeAction: vi.fn(async () => {
        pendingWrites++;
        maxPendingWrites = Math.max(maxPendingWrites, pendingWrites);
        await new Promise<void>((resolve) => {
          writePromises.push(resolve);
        });
        pendingWrites--;
      }),
      writeFrame: vi.fn().mockResolvedValue(undefined),
      writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
    };

    const store = createTestStore({ storageBackend: slowBackend });
    store.dispatch(testRecorderSlice.actions.startSession());

    // Dispatch 10 GPS actions rapidly
    for (let i = 0; i < 10; i++) {
      store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: i, lon: i }));
    }

    // Resolve all pending writes
    while (writePromises.length > 0) {
      const resolve = writePromises.shift()!;
      resolve();
      // Let microtasks run so next queued write can start
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    // All 11 actions (1 startSession + 10 gpsData) should eventually be written
    expect(slowBackend.writeAction).toHaveBeenCalledTimes(11);

    // Concurrency should be bounded (not all 11 running simultaneously)
    expect(maxPendingWrites).toBeLessThanOrEqual(5);
  });

  // --- Issue 4: actionIndex must reset between sessions ---

  it('should reset action index when a new session starts', async () => {
    // Why: Without reset, a second session continues numbering from the
    // previous session (e.g. 000006.json), violating the 1-based contract
    // and breaking replay ordering in multi-session recordings.
    const store = createTestStore({ storageBackend: mockBackend });

    // First session: 1 startSession + 1 gpsData + 1 endSession = indices 1, 2, 3
    store.dispatch(testRecorderSlice.actions.startSession());
    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 1, lon: 1 }));
    store.dispatch(testRecorderSlice.actions.endSession());

    // Flush the write queue so pending writes from session 1 complete
    await new Promise<void>((r) => setTimeout(r, 0));

    mockBackend.writeAction.mockClear();

    // Second session: should start at index 1 again
    store.dispatch(testRecorderSlice.actions.startSession());
    store.dispatch(testGpsDataSlice.actions.setZeroPos({ lat: 2, lon: 2 }));

    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recording/startSession' }),
      1
    );
    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gpsData/setZeroPos' }),
      2
    );
  });

  // --- Issue 5: endSession action must be persisted ---

  it('should persist the endSession action even though it sets isRecording=false', () => {
    // Why: endSession sets isRecording=false in the reducer. If the middleware
    // only checks isRecording AFTER the reducer, it sees false and skips
    // persistence. The endSession action is lost from the recording file.
    const store = createTestStore({ storageBackend: mockBackend });
    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(testRecorderSlice.actions.endSession());

    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'recording/endSession' }),
      2 // index 2: startSession was 1
    );
  });

  // --- Derived-prefix contract (architecture review 2026-05-29 §5 P0) ---
  //
  // Why these tests matter: the persistence whitelist used to hard-code the
  // slice prefixes (`gpsData/`, `refPoints/`, `recording/`) as string
  // literals. That let the `refPointsV2/` → `refPoints/` rename silently
  // drop every live mark from the recording stream. The whitelist is now
  // DATA-DRIVEN via `persistedPrefixes`, which the store factory derives
  // from the actual slices' action types (see `slicePrefixOf`). These
  // tests pin that contract so a future rename cannot silently re-break it.

  it('persists actions only for slices listed in persistedPrefixes', () => {
    // A slice whose name is NOT in persistedPrefixes must be dropped even
    // while recording; one that IS listed must be persisted. This proves
    // the whitelist comes from the option, not a baked-in literal.
    const includedSlice = createSlice({
      name: 'gpsData',
      initialState: 0,
      reducers: { bump: (s) => s + 1 },
    });
    const excludedSlice = createSlice({
      name: 'somethingElse',
      initialState: 0,
      reducers: { bump: (s) => s + 1 },
    });

    const store = configureStore({
      reducer: {
        recording: testRecorderSlice.reducer,
        gpsData: includedSlice.reducer,
        somethingElse: excludedSlice.reducer,
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

    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(includedSlice.actions.bump());
    store.dispatch(excludedSlice.actions.bump());

    expect(mockBackend.writeAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'gpsData/bump' }),
      expect.any(Number)
    );
    expect(mockBackend.writeAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'somethingElse/bump' }),
      expect.any(Number)
    );
  });

  it('always excludes recordWriteFailure even when recording is whitelisted', () => {
    const store = createTestStore({
      storageBackend: mockBackend,
      persistedPrefixes: ['gpsData', 'recording'],
    });
    store.dispatch(testRecorderSlice.actions.startSession());
    mockBackend.writeAction.mockClear();

    store.dispatch(testRecorderSlice.actions.recordWriteFailure());
    expect(mockBackend.writeAction).not.toHaveBeenCalled();
  });
});

describe('slicePrefixOf', () => {
  // Why: this helper is the single point that turns a slice-owned action
  // type into the prefix the whitelist matches on. Keeping it correct (and
  // tested) is what lets call sites derive prefixes from real action
  // creators instead of re-typing literals.
  it('extracts the slice name from a namespaced action type', () => {
    expect(slicePrefixOf('gpsData/setZeroPos')).toBe('gpsData');
    expect(slicePrefixOf('refPoints/addRefPointEntry')).toBe('refPoints');
    expect(slicePrefixOf('recording/recordWriteFailure')).toBe('recording');
  });

  it('returns the whole string when there is no slash', () => {
    expect(slicePrefixOf('@@INIT')).toBe('@@INIT');
  });

  it('only splits on the first slash', () => {
    expect(slicePrefixOf('a/b/c')).toBe('a');
  });
});

describe('persistence re-entrancy tripwire', () => {
  // Why these tests matter: a persisted action dispatched re-entrantly (inside
  // another dispatch's `next()`, e.g. from a synchronous `store.subscribe`
  // listener) receives a LOWER replay index than its trigger and is dropped on
  // replay — a SILENT, replay-only failure (the 2026-06-27 field bug). The
  // tripwire turns that into a loud dev-time warning. These tests pin that it
  // (a) fires on the re-entrant case naming the offending action, once;
  // (b) stays silent for normal top-level dispatches; (c) is observational
  // only (does not drop/reorder the recorded writes); and (d) does not
  // false-positive on the middleware's own async `recordWriteFailure` dispatch.
  // See 2026-06-28-subscriber-dispatch-persistence-ordering-review.md.

  const gpsSlice = createSlice({
    name: 'gpsData',
    initialState: null as {
      zero: { lat: number; lon: number };
      flag?: boolean;
    } | null,
    reducers: {
      setZeroPos(_s, a: PayloadAction<{ lat: number; lon: number }>) {
        return { zero: a.payload };
      },
      setFlag(s, a: PayloadAction<boolean>) {
        if (s) s.flag = a.payload;
      },
    },
  });
  const recSlice = createSlice({
    name: 'recording',
    initialState: { isRecording: false, failedWriteCount: 0 },
    reducers: {
      startSession(s) {
        s.isRecording = true;
      },
      endSession(s) {
        s.isRecording = false;
      },
      recordWriteFailure(s) {
        s.failedWriteCount += 1;
      },
    },
  });

  function makeBackend() {
    return {
      createSession: vi.fn().mockResolvedValue({ sessionName: 'test' }),
      listSessions: vi.fn().mockResolvedValue([]),
      writeAction: vi.fn().mockResolvedValue(undefined),
      writeFrame: vi.fn().mockResolvedValue(undefined),
      writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
    } as unknown as StorageBackend & { writeAction: ReturnType<typeof vi.fn> };
  }

  function makeStore(backend: StorageBackend) {
    return configureStore({
      reducer: { recording: recSlice.reducer, gpsData: gpsSlice.reducer },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
          serializableCheck: false,
          immutableCheck: false,
        }).concat(
          createPersistenceMiddleware({
            storageBackend: backend,
            persistedPrefixes: ['gpsData', 'recording'],
          })
        ),
    });
  }

  // Collect the warning lines (joined args) emitted by the tripwire. Typed
  // against the call-args array (not the loosely-typed spy) to stay lint-clean.
  const reentrantWarnings = (
    calls: readonly (readonly unknown[])[]
  ): string[] =>
    calls
      .map((args) =>
        args.filter((a): a is string => typeof a === 'string').join(' ')
      )
      .filter((line) => line.includes('dispatched re-entrantly'));

  it('warns once (naming the action) when a persisted action is dispatched re-entrantly from a subscriber, without dropping the recorded writes', () => {
    const backend = makeBackend();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore(backend);

    // The exact field-bug shape: a subscriber reacts to gpsData appearing by
    // synchronously dispatching a follow-up persisted action (inside the
    // setZeroPos dispatch's next()). Guarded to fire once (no loop).
    let fired = false;
    store.subscribe(() => {
      if (store.getState().gpsData && !fired) {
        fired = true;
        store.dispatch(gpsSlice.actions.setFlag(true));
      }
    });

    store.dispatch(recSlice.actions.startSession());
    store.dispatch(gpsSlice.actions.setZeroPos({ lat: 1, lon: 2 }));

    const warnings = reentrantWarnings(warnSpy.mock.calls);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!).toContain('gpsData/setFlag');

    // Observational only: both actions are still persisted — and with the
    // inverted index the warning is diagnosing (the re-entrant setFlag lands
    // BEFORE the setZeroPos that created the slice).
    const calls = (
      backend.writeAction as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => ({
      type: (c[0] as { type: string }).type,
      index: c[1] as number,
    }));
    const zero = calls.find((c) => c.type === 'gpsData/setZeroPos');
    const flag = calls.find((c) => c.type === 'gpsData/setFlag');
    expect(zero).toBeDefined();
    expect(flag).toBeDefined();
    expect(flag!.index).toBeLessThan(zero!.index);

    warnSpy.mockRestore();
  });

  it('does not warn for normal top-level persisted dispatches', () => {
    const backend = makeBackend();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore(backend);

    store.dispatch(recSlice.actions.startSession());
    store.dispatch(gpsSlice.actions.setZeroPos({ lat: 1, lon: 2 }));
    store.dispatch(gpsSlice.actions.setFlag(true));

    expect(reentrantWarnings(warnSpy.mock.calls)).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('does not false-positive on the async recordWriteFailure dispatch when a write fails', async () => {
    const backend = makeBackend();
    (backend.writeAction as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('disk full')
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore(backend);

    store.dispatch(recSlice.actions.startSession());
    store.dispatch(gpsSlice.actions.setZeroPos({ lat: 1, lon: 2 }));
    // Let the write queue reject and dispatch recordWriteFailure (top-level,
    // in a later macrotask — depth 1 and excluded from persistence).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reentrantWarnings(warnSpy.mock.calls)).toHaveLength(0);
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
