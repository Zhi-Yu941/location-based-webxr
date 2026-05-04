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

function createTestStore(options: PersistenceMiddlewareOptions) {
  return configureStore({
    reducer: {
      recording: testRecorderSlice.reducer,
      gpsData: testGpsDataSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }).concat(createPersistenceMiddleware(options)),
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
        }).concat(createPersistenceMiddleware({ storageBackend: mockBackend })),
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
});
