# OPFS Storage Module

## Purpose

Provides persistent storage using the Origin Private File System (OPFS) API. This replaces `showDirectoryPicker` to achieve cross-platform compatibility (Desktop Chrome, Android Chrome, iOS Safari).

## Why OPFS?

The File System Access API (`showDirectoryPicker`) has a critical limitation on Android Chrome: even with `mode: 'readwrite'`, `createWritable()` fails with `NoModificationAllowedError`. OPFS works consistently across all platforms.

## Public API

### Initialization

```typescript
import { initOpfsStorage } from './opfs-storage';

// Must be called before any other operations
await initOpfsStorage();
```

**Note:** `odomCoordVersion` in session metadata was expanded to support values `2 | 3 | 4 | 5` reflecting the evolution from NUE-baked actions (era 2), to raw-WebXR positions (era 3), to raw-WebXR + RawGpsPoint (era 4), to state-side quaternion conversion (era 5). Optional `build` and sanitized `pageUrl` (origin + pathname only) fields were added for debugging — older ZIPs without them remain valid.

### Session Management

```typescript
import {
  createSession,
  writeAction,
  writeFrame,
  writeSessionMetadata,
} from './opfs-storage';

// Create a new recording session
const { scenarioName, sessionName } = await createSession(
  'my-scenario',
  new Date()
);

// Write actions during recording
await writeAction({ type: 'test/action', payload: {} }, 1);

// Write frames during recording
await writeFrame(imageBlob, 1);

// Write metadata when session ends
await writeSessionMetadata({
  version: 1,
  startedAt: '2026-01-26T10:00:00Z',
  endedAt: '2026-01-26T10:30:00Z',
  scenarioName: 'my-scenario',
  actionCount: 42,
  frameCount: 21,
  userAgent: navigator.userAgent,
});
```

### Listing

```typescript
import { listScenarios, listSessions } from './opfs-storage';

// List all scenarios
const scenarios = await listScenarios(); // ['scenario-a', 'scenario-b']

// List sessions in a scenario
const sessions = await listSessions('scenario-a'); // ['recording-2026-01-26_10-00-00utc']
```

### Storage Quota

```typescript
import { checkStorageQuota } from './opfs-storage';

// Prefer calling initOpfsStorage() first for reliable results.
// If Storage Manager API is unavailable, returns { available: 0, used: 0 }.
const { available, used } = await checkStorageQuota();
```

## Directory Structure

```
/gps-plus-slam/
  └── scenarios/
      ├── {scenario-name}/
      │   ├── recording-YYYY-MM-DD_HH-MM-SSutc/
      │   │   ├── session.json
      │   │   ├── actions/
      │   │   │   ├── 000001.json
      │   │   │   └── ...
      │   │   └── frames/
      │   │       ├── frame-000001.jpg
      │   │       └── ...
      │   └── ...
      └── ...
```

## Invariants

1. `initOpfsStorage()` must be called before any other operations
2. `createSession()` must be called before `writeAction()`/`writeFrame()`
3. Action indices are 1-based and zero-padded to 6 digits (000001.json)
4. Frame filenames follow the pattern `frame-{index}.jpg`
5. Session folders are named `recording-{ISO-timestamp}utc`
6. All write operations use `safeWriteToFile()` helper which guarantees `FileSystemWritableFileStream` cleanup. On write/close errors, it captures the original error, attempts `writable.abort()` in a separate try/catch (so abort failures cannot mask the original error), and then rethrows the original error.

## Error Modes

| Error                     | Cause                             | Recovery                        |
| ------------------------- | --------------------------------- | ------------------------------- |
| "OPFS not supported"      | Browser lacks OPFS API            | Use newer browser               |
| "Storage not initialized" | Called write before init          | Call `initOpfsStorage()` first  |
| "No active session"       | Called write before createSession | Call `createSession()` first    |
| QuotaExceededError        | Storage full                      | Delete old recordings or export |

### Soft Reset (Issue 4)

- `resetSessionHandles(): void` — Clears session-level handles (`currentScenarioHandle`, `currentSessionHandle`, `actionsHandle`, `framesHandle`) while preserving directory-level handles (`opfsRoot`, `gpsPlusSlamDir`, `scenariosDir`). Called by `file-system.ts:resetForNewSession()` as part of the soft-reset flow.

Write failures (e.g., disk full, quota exceeded) will propagate the error to the caller after safely aborting the writable stream to release file locks.

## Tests

- Unit tests: `opfs-storage.test.ts`
- All tests use `MockOPFSDirectoryHandle` from `browser-mocks.ts`
- Resource cleanup tests verify `writable.abort()` is called on write errors
