# file-system.ts

## Purpose

Wraps OPFS (Origin Private File System) to persist Redux actions and captured frames to browser storage. This module maintains a backwards-compatible API but now delegates to the `opfs-storage` module for actual storage operations.

**Migration Note:** Previously used the File System Access API (`showDirectoryPicker`), but this had a critical limitation on Android Chrome where `createWritable()` fails with `NoModificationAllowedError`. OPFS works consistently across Desktop Chrome, Android Chrome, and iOS Safari.

## Public API

| Export                              | Type                            | Description                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initStorage()`                     | `async () => string[]`          | Initialize OPFS storage, return scenario names                                                                                                                                                                                       |
| `startSession(scenarioName, isNew)` | `async () => paths`             | Create/open scenario and session folders                                                                                                                                                                                             |
| `writeAction(action, index)`        | `async () => void`              | Write action JSON to OPFS                                                                                                                                                                                                            |
| `writeFrame(blob, index)`           | `async () => void`              | Write frame image to OPFS                                                                                                                                                                                                            |
| `writeSessionMetadata(metadata)`    | `async () => void`              | Write session metadata (session.json) to OPFS. Contains timing, counts, and user agent.                                                                                                                                              |
| `SessionMetadata`                   | type (re-exported)              | Schema for session.json — see `opfs-storage.ts`                                                                                                                                                                                      |
| `loadScenarioRefPoints(name)`       | `async () => RefPointRecord[]`  | Load prior reference points                                                                                                                                                                                                          |
| `setCurrentScenario(name)`          | `async () => handle \| null`    | Set current scenario without starting session                                                                                                                                                                                        |
| `getCurrentScenarioHandle()`        | `() => handle \| null`          | Get current scenario's directory handle                                                                                                                                                                                              |
| `verifyWriteAccess(dirHandle)`      | `async () => WriteAccessResult` | Legacy: Probe write capability (no longer used internally)                                                                                                                                                                           |
| `resetForNewSession()`              | `() => void`                    | Clears session-level state (`_currentScenarioName`, `_currentSessionName`) and delegates to `opfs-storage.resetSessionHandles()`. Preserves `storageInitialized` flag so `initStorage()` is not required again. (Issue 4 soft reset) |
| `WriteAccessResult`                 | interface                       | Result of write verification: `{ success: boolean, error?: string }`                                                                                                                                                                 |
| `RefPointRecord`                    | interface                       | Reference point from prior session                                                                                                                                                                                                   |

## Folder Structure (OPFS)

```
/gps-plus-slam/
  scenarios/
    <scenario-name>/
      recording-2025-02-28_14-30-11utc/
        actions/
          000001.json
          000002.json
          ...
        frames/
          frame-000001.jpg
          frame-000002.jpg
          ...
        session.json
```

## Invariants & Assumptions

- OPFS is available (`navigator.storage.getDirectory`)
- Chrome 86+, Safari 15.2+, Firefox 111+
- Actions are JSON-serializable
- Frames are Blob (JPEG compressed)
- 1-based indexing for action/frame files

## Error Handling

- Throws if OPFS not supported
- Throws if `writeAction`/`writeFrame` called without active session
- Caller responsible for catching and displaying errors

## Examples

```typescript
import { initStorage, startSession, writeAction } from './storage/file-system';

// Typical flow
const scenarios = await initStorage(); // User picks folder, write verified
await startSession('MyScenario', true);
await writeAction({ type: 'test', payload: {} }, 0);

// Manual write verification (for testing)
const result = await verifyWriteAccess(dirHandle);
if (!result.success) {
  console.error('Folder is read-only:', result.error);
}
```

## Tests

- Unit tests in `file-system.test.ts` using mock FileSystemDirectoryHandle
- `verifyWriteAccess()` tested with 4 scenarios: success, createWritable fail, getFileHandle fail, cleanup fail
- E2E smoke tests verify page loads without API errors
