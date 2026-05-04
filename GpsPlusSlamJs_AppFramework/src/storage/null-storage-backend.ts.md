# NullStorageBackend

## Purpose

No-op implementation of `StorageBackend` for use in tests, replay mode, and any context where persistence is not desired.

## Public API

```typescript
export class NullStorageBackend implements StorageBackend {
  writeAction(action: unknown, index: number): Promise<void>;
  writeFrame(blob: Blob, index: number): Promise<void>;
  writeSessionMetadata(metadata: SessionMetadata): Promise<void>;
}
```

All methods resolve immediately with `undefined`. No state is accumulated.

## Invariants & Assumptions

- Stateless — safe to call hundreds of times during replay without memory leaks.
- Never throws — always resolves successfully.

## Examples

```typescript
import { NullStorageBackend } from './null-storage-backend';
import { createSlamAppStore } from '../state/create-slam-app-store';

const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});
// Dispatch actions freely — nothing is written to disk
```

## Tests

- `storage-backend.test.ts` — 5 tests covering interface compliance, all three methods, and repeated calling.
