# StorageBackend Interface

## Purpose

Abstraction over action/frame/metadata persistence. Decouples the recorder store from the concrete OPFS implementation (Finding F2).

## Public API

```typescript
export interface StorageBackend {
  writeAction(action: unknown, index: number): Promise<void>;
  writeFrame(blob: Blob, index: number): Promise<void>;
  writeSessionMetadata(metadata: SessionMetadata): Promise<void>;
}
```

All methods return `Promise<void>` and are expected to throw/reject on failure. The store's persistence middleware catches errors and routes them through `onWriteFailure`.

## Implementations

| Class                | Module                    | Use case           |
| -------------------- | ------------------------- | ------------------ |
| `OpfsStorageBackend` | `opfs-storage-backend.ts` | Production (OPFS)  |
| `NullStorageBackend` | `null-storage-backend.ts` | Tests, replay mode |

## Invariants & Assumptions

- `index` is 1-based (matches OPFS storage convention: `000001.json`).
- `writeAction` receives the full Redux action object (serializable).
- Implementations must not swallow errors — let them propagate to the store's error handling.
- `SessionMetadata` type comes from `opfs-storage.ts`.

## Examples

```typescript
import { NullStorageBackend } from './null-storage-backend';
import { createSlamAppStore } from '../state/create-slam-app-store';

// Replay mode — no persistence
const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});
```

## Tests

- `storage-backend.test.ts` — interface compliance, delegation, error propagation for both implementations.
