/**
 * Redux middleware for action persistence during recording sessions.
 *
 * Replaces the inline persistence logic previously embedded in the manual
 * dispatch wrapper. Actions matching gpsData/* or recording/* (except
 * recording/recordWriteFailure) are written to the StorageBackend when
 * the recording slice is in recording state.
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md Â§4
 */

import type { Middleware, UnknownAction } from '@reduxjs/toolkit';
import type { StorageBackend } from '../storage/storage-backend';
import { recordWriteFailure } from './recording-slice';
import { createLogger } from '../utils/logger';

const log = createLogger('PersistenceMiddleware');

// ---------------------------------------------------------------------------
// Write queue with concurrency limit
// ---------------------------------------------------------------------------

/** Maximum number of concurrent OPFS write operations. */
const MAX_CONCURRENT_WRITES = 3;

/**
 * Simple write queue that limits concurrent OPFS operations.
 * Prevents unbounded memory growth when storage is slow.
 */
class WriteQueue {
  private pendingCount = 0;
  private queue: Array<() => Promise<void>> = [];

  enqueue(writeFn: () => Promise<void>): void {
    this.queue.push(writeFn);
    this.drain();
  }

  private drain(): void {
    while (this.pendingCount < MAX_CONCURRENT_WRITES && this.queue.length > 0) {
      const fn = this.queue.shift()!;
      this.pendingCount++;
      void fn().finally(() => {
        this.pendingCount--;
        this.drain();
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PersistenceMiddlewareOptions {
  /**
   * StorageBackend to use for action persistence.
   */
  storageBackend: StorageBackend;

  /**
   * Callback invoked when a write operation fails during persistence.
   * User Feedback Issue #1 Part B: Used to show toast notifications.
   */
  onWriteFailure?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a Redux middleware that persists qualifying actions to storage
 * during active recording sessions.
 *
 * Persistence rules:
 * - Only persists when `state.recording.isRecording` is true (checked AFTER
 *   the action is reduced, so `startSession` itself is included).
 * - Persists `gpsData/*` and `recording/*` actions.
 * - Excludes `recording/recordWriteFailure` to prevent recursive persistence.
 * - Excludes `routing/*`, `refPoints/*`, and any other non-recording actions.
 * - Uses 1-based indexing for action files (000001.json, 000002.json, â€¦).
 * - Each middleware instance maintains its own action index (Bug 10 fix).
 */
export function createPersistenceMiddleware(
  options: PersistenceMiddlewareOptions
): Middleware {
  const { storageBackend, onWriteFailure } = options;

  // Per-middleware-instance action index (Bug 10: was module-level)
  let actionIndex = 0;
  const writeQueue = new WriteQueue();

  const middleware: Middleware = (store) => (next) => (action: unknown) => {
    const typedAction = action as UnknownAction;
    const actionType =
      typeof typedAction.type === 'string' ? typedAction.type : null;

    // Capture recording state BEFORE reducer runs so we can detect
    // endSession (which sets isRecording=false in the reducer).
    const stateBefore = store.getState() as {
      recording?: { isRecording: boolean };
    };
    const wasRecording = stateBefore.recording?.isRecording ?? false;

    // Let reducers handle the action first
    const result = next(action);

    if (!actionType) {
      return result;
    }

    // Reset action index when a new session starts (Issue 4)
    if (actionType === 'recording/startSession') {
      actionIndex = 0;
    }

    // Check recording state AFTER reducers ran (so startSession is included).
    // Special-case endSession: wasRecording was true before the reducer,
    // but isRecording is now false â€” still needs to be persisted (Issue 5).
    const stateAfter = store.getState() as {
      recording?: { isRecording: boolean };
    };
    const isRecording = stateAfter.recording?.isRecording ?? false;
    const isEndSession = actionType === 'recording/endSession';

    // Persist if actively recording, or if this is the endSession action
    // that just flipped isRecording to false (Issue 5).
    const isInPersistableSession =
      isRecording || (wasRecording && isEndSession);
    if (!isInPersistableSession) {
      return result;
    }

    // Only persist gpsData/ and recording/ actions (excluding recordWriteFailure)
    const shouldPersistAction =
      actionType.startsWith('gpsData/') ||
      (actionType.startsWith('recording/') &&
        actionType !== 'recording/recordWriteFailure');

    if (!shouldPersistAction) {
      return result;
    }

    // Use pre-increment for 1-based indexing (000001.json, 000002.json, etc.)
    const index = ++actionIndex;
    writeQueue.enqueue(async () => {
      try {
        await storageBackend.writeAction(typedAction, index);
      } catch (err) {
        // Normalize rejection to Error (JS allows rejecting with any value)
        const normalized = err instanceof Error ? err : new Error(String(err));
        log.error('Failed to persist action:', normalized);

        // recordWriteFailure is excluded from persistence above,
        // so this dispatch won't cause recursion
        store.dispatch(recordWriteFailure(normalized.message));

        if (onWriteFailure) {
          onWriteFailure(normalized);
        }
      }
    });

    return result;
  };

  return middleware;
}
