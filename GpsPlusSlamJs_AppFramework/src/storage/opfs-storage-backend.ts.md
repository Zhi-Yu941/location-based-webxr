# OpfsStorageBackend

## Purpose

Production implementation of `StorageBackend` that delegates to the existing `file-system.ts` facade (which uses OPFS internally).

## Public API

```typescript
export class OpfsStorageBackend implements StorageBackend {
  writeAction(action: unknown, index: number): Promise<void>;
  writeFrame(blob: Blob, index: number): Promise<void>;
  writeSessionMetadata(metadata: SessionMetadata): Promise<void>;
}
```

Each method delegates to the corresponding function in `file-system.ts`:

- `writeAction` → `fsWriteAction`
- `writeFrame` → `fsWriteFrame`
- `writeSessionMetadata` → `fsWriteSessionMetadata`

## Invariants & Assumptions

- Requires OPFS session to be initialized via `startStorageSession()` before `writeAction`/`writeFrame` calls (same as direct usage).
- Errors propagate to caller — not caught internally.
- This is the **default** backend when no `storageBackend` option is passed to `createSlamAppStore()`.

## Examples

```typescript
import { OpfsStorageBackend } from './opfs-storage-backend';
import { createSlamAppStore } from '../state/create-slam-app-store';

// Production usage (this is also the default when omitted)
const store = createSlamAppStore({
  storageBackend: new OpfsStorageBackend(),
});
```

## Tests

- `storage-backend.test.ts` — 5 tests covering interface compliance, delegation to file-system functions, and error propagation.
