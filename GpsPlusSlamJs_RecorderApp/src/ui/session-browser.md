# session-browser.ts

## Purpose

Pure functions for enumerating scenarios and session recordings from a `FileSystemDirectoryHandle`. Supports both Replay Mode (browsing existing sessions) and Recording Mode (populating the scenario dropdown from a selected folder).

## Public API

| Export                             | Signature                                                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionEntry`                     | `interface`                                                                      | `{ filename, fileHandle, date, h3Cells? }`. `h3Cells` is the per-tour H3 coverage index read from `session.json` during discovery (res-11 cells the GPS path crossed); `undefined` for legacy recordings predating the field — those are backfilled by `recording-index.ts`.                                                                                                                                                                                                                                     |
| `ZipMetadataDiscoveryResult`       | `interface`                                                                      | `{ scenarioSessions: Map<string, SessionEntry[]>, scenarioNames: string[] }`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `UNKNOWN_SCENARIO`                 | `const string`                                                                   | Fallback scenario name `"(Unknown)"` for zips without `session.json` or without `scenarioName`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `parseDateFromSessionFilename`     | `(filename: string) => Date \| null`                                             | Parses UTC date from filenames like `recording-YYYY-MM-DD_HH-MM-SSutc.zip` or `ScenarioName-session-YYYY-MM-DD_HH-MM-SSutc.zip`. Returns `null` for non-matching or invalid dates. Since 2026-07-05 a **re-export** from `storage/session-zip-naming.ts` (shared with the ref-point indexing pass; storage may not import from ui). Same for `DEFAULT_SCENARIO` and the scenario-name resolver `resolveScenarioNameFromMetadata` (the latter is not re-exported — import it from `session-zip-naming` directly). |
| `listScenariosFromFolder`          | `(rootHandle: FileSystemDirectoryHandle) => Promise<string[]>`                   | Enumerates top-level directories as scenario names. Returns sorted, directory-only names.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `extractScenarioNamesFromZips`     | `(rootHandle: FileSystemDirectoryHandle) => Promise<string[]>`                   | Scans top-level ZIP files for scenario-prefixed filenames (`{Name}-session-{timestamp}utc.zip`). Returns deduplicated, sorted scenario names. Ignores timestamp-only ZIPs (`recording-...` or bare `YYYY-...`).                                                                                                                                                                                                                                                                                                  |
| `METADATA_SCAN_CONCURRENCY`        | `const number`                                                                   | Max concurrent zip reads during `discoverScenariosFromZipMetadata` (default: 4). Limits peak I/O and memory.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `discoverScenariosFromZipMetadata` | `(rootHandle: FileSystemDirectoryHandle) => Promise<ZipMetadataDiscoveryResult>` | Opens each root-level `.zip`, reads `session.json` metadata via `BlobReader` (no full-file buffering), groups by `scenarioName`. Uses concurrency limiting (`METADATA_SCAN_CONCURRENCY`). Uses `UNKNOWN_SCENARIO` as fallback.                                                                                                                                                                                                                                                                                   |
| `listSessionZipsInScenario`        | `(scenarioHandle: FileSystemDirectoryHandle) => Promise<SessionEntry[]>`         | Lists `.zip` files inside a scenario directory, sorted by filename. Parses dates from filenames where possible.                                                                                                                                                                                                                                                                                                                                                                                                  |

## Invariants & Assumptions

- All returned arrays are **sorted alphabetically** (scenarios by name, sessions by filename).
- `listScenariosFromFolder` returns only directories, never files.
- `listSessionZipsInScenario` returns only `.zip` files, never directories.
- `extractScenarioNamesFromZips` never returns duplicates. It only matches the `{Name}-session-{timestamp}utc.zip` pattern; `recording-{timestamp}utc.zip` and bare timestamp filenames are intentionally excluded.
- The `SCENARIO_PREFIX_PATTERN` splits on `-session-` (the last occurrence before the timestamp), so multi-word hyphenated scenario names like `Paris-Eiffeltower` are preserved correctly.
- `discoverScenariosFromZipMetadata` reads zip files in parallel for performance. It gracefully skips corrupted/unreadable zips. Zips without `session.json` or without a `scenarioName` field are grouped under `UNKNOWN_SCENARIO` (`"(Unknown)"`).
- `discoverScenariosFromZipMetadata` uses `loadSessionMetadataFromBlob()` from `zip-reader.ts` with `BlobReader` — reads only the zip central directory and `session.json` entry, not the entire file. Concurrency is capped at `METADATA_SCAN_CONCURRENCY` (4) via `mapWithConcurrencyLimit` from `utils/concurrency.ts`.
- `discoverScenariosFromZipMetadata` attaches `h3Cells` to each `SessionEntry` from the `session.json` `h3Cells` field, parsed defensively (`parseH3Cells`: only an array whose entries are _all_ valid H3 cell ids is accepted; if any entry is a non-string **or** a string that does not decode to a real cell (via `h3-js` `isValidCell`) the whole array is rejected as untrustworthy — all-or-nothing, not silently filtered; a missing/non-array/partially-malformed field yields `undefined`). An empty array is preserved (means "no GPS coverage"), distinct from `undefined` (legacy or corrupt — needs GPS backfill). Validating the ids (not just their type) is necessary because an invalid id fails silently downstream — `cellToLatLng('garbage')` does not throw (it mis-frames the map) and `clusterCellsByZoom` drops invalid cells — so the parse boundary is the only place the corruption surfaces. Consumed by `recording-index.ts` to build the map browser's coverage index.

## Expected Folder Structure

```
<RootFolder>/
├── Scenario A/               ← found by listScenariosFromFolder
│   ├── refPoints/
│   ├── recording-2026-01-27_14-30-11utc.zip
│   └── ScenarioA-session-2026-02-06_03-52-13utc.zip
├── Scenario B/               ← found by listScenariosFromFolder
│   └── recording-2026-02-10_09-00-00utc.zip
├── Tokyo-session-2026-03-01_10-00-00utc.zip   ← found by extractScenarioNamesFromZips → "Tokyo"
├── 2026-02-20_09-00-00utc.zip                 ← found by discoverScenariosFromZipMetadata → reads session.json
└── old-recording.zip                          ← no session.json → grouped as "(Unknown)"
```

## Examples

```typescript
import {
  listScenariosFromFolder,
  discoverScenariosFromZipMetadata,
} from './session-browser';

const folderHandle = await showDirectoryPicker({ mode: 'read' });

// Recording mode: discover from subdirectories + ZIP filename prefixes
import { extractScenarioNamesFromZips } from './session-browser';
const [dirScenarios, zipScenarios] = await Promise.all([
  listScenariosFromFolder(folderHandle),
  extractScenarioNamesFromZips(folderHandle),
]);
const recAllScenarios = [...new Set([...dirScenarios, ...zipScenarios])].sort();

// Replay mode: discover from subdirectories + ZIP session.json metadata
const [replayDirScenarios, zipDiscovery] = await Promise.all([
  listScenariosFromFolder(folderHandle),
  discoverScenariosFromZipMetadata(folderHandle),
]);
const replayAllScenarios = [
  ...new Set([...replayDirScenarios, ...zipDiscovery.scenarioNames]),
].sort();
// zipDiscovery.scenarioSessions is a Map<string, SessionEntry[]> to cache
```

## Tests

- **Unit tests:** `session-browser.test.ts` — 39 tests covering all public functions including `discoverScenariosFromZipMetadata` (10 tests with real zip round-trips, including memory-efficiency verification via arrayBuffer spy) + 3 integration tests exercising the full discovery pipeline on realistic folder structures.
- **Property-based tests:** `session-browser.property.test.ts` — 11 tests verifying sort order, deduplication, no false positives from timestamp-only filenames, and file/directory filtering invariants across randomized inputs.
- **Bug exploration tests:** `replay-zip-discovery.test.ts` — 12 tests documenting the 2026-03-01 user feedback bugs and verifying the fix.
