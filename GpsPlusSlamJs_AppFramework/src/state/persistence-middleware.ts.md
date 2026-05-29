# persistence-middleware.ts

## Purpose

Redux middleware factory that persists qualifying actions to a `StorageBackend` during active recording sessions. Replaces the inline persistence logic previously embedded in the manual dispatch wrapper (§4 — `configureStore` migration).

## Public API

| Export                          | Kind     | Description                                                       |
| ------------------------------- | -------- | ----------------------------------------------------------------- |
| `PersistenceMiddlewareOptions`  | Type     | Options: `storageBackend` (required), `onWriteFailure` (optional) |
| `createPersistenceMiddleware()` | Function | Factory returning a Redux `Middleware`                            |

## Persistence Rules

1. **Recording gate:** Persists when `state.recording.isRecording` is `true` after the reducer runs. Also persists `endSession` when the pre-reducer state was recording (captures `wasRecording` before `next(action)`).
2. **Prefix whitelist:** `gpsData/*`, `refPoints/*`, and `recording/*` actions are persisted.
3. **Exclusion:** `recording/recordWriteFailure` is excluded to prevent recursive persistence.
4. **Non-persisted prefixes:** `routing/*`, `gpsElements/*`, `arElements/*`, and any other action types are not persisted.
5. **Stop semantics:** `endSession` itself IS persisted (detected via `wasRecording` check). After `endSession`, `isRecording` is `false`, so no further actions are persisted.

## Invariants & Assumptions

- **Per-instance action index** (Bug 10 fix): each middleware instance maintains its own `actionIndex` counter starting at 0. Pre-increment yields 1-based indices (`000001.json`, `000002.json`, …). This prevents cross-store index bleed.
- **Index reset on startSession:** `actionIndex` is reset to 0 when `recording/startSession` is dispatched, ensuring each session starts at index 1.
- **Write queue with concurrency limit:** `storageBackend.writeAction()` calls are enqueued in a `WriteQueue` with a maximum of 3 concurrent writes. This prevents unbounded memory growth when storage is slow (e.g., OPFS locked by another tab or GC pauses on mobile). Failures are caught and handled via `recordWriteFailure` dispatch + `onWriteFailure` callback.
- **Error normalization:** non-`Error` rejections (e.g., `Promise.reject('string')`) are wrapped in `new Error(String(err))` before processing.
- **No recursion:** `recordWriteFailure` is excluded from the persistence whitelist, so dispatching it from the error handler cannot trigger another write.

## Examples

```typescript
import { createPersistenceMiddleware } from './persistence-middleware';
import { OpfsStorageBackend } from '../storage/opfs-storage-backend';

const middleware = createPersistenceMiddleware({
  storageBackend: new OpfsStorageBackend(),
  onWriteFailure: (err) => showToast(`Write failed: ${err.message}`),
});

// Used in configureStore:
configureStore({
  reducer: {
    /* ... */
  },
  middleware: (getDefault) => getDefault().concat(middleware),
});
```

## Tests

- `persistence-middleware.test.ts` — 16 tests covering:
  - No persistence when not recording
  - `startSession` persistence (recording gate checked after reduce)
  - `gpsData/*`, `refPoints/*`, and `recording/*` persistence
  - `recordWriteFailure` exclusion
  - `routing/*` exclusion
  - Stop-after-endSession semantics
  - 1-based indexing
  - Per-instance index isolation
  - `onWriteFailure` callback invocation
  - `recordWriteFailure` dispatch on storage error
  - Non-Error rejection normalization
  - Action passthrough (middleware doesn't block dispatch)
  - Concurrent write limit when storage is slow (backpressure)
  - Multi-session actionIndex reset (new sessions start at index 1)
  - `endSession` persistence (not dropped by isRecording=false gate)

## Related

- [store.ts](store.ts.md) — factory that wires this middleware into `configureStore`
- [recording-slice.ts](recording-slice.ts.md) — provides `recordWriteFailure` action creator
- [storage-backend.ts](../storage/storage-backend.ts.md) — `StorageBackend` interface
