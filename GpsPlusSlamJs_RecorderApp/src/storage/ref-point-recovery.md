# ref-point-recovery.ts

## Purpose

Extracts full `RefPointDefinition` objects from ZIP files in a folder and merges observations by ref point ID. This is the **OPFS recovery** module — when browser data is cleared, it reconstructs the scenario-level ref point state from session ZIPs.

Unlike `ref-point-importer.ts` (which returns simplified `ImportedRefPoint` with only lat/lon), this module preserves complete observation data (AR poses, GPS, timestamps) needed for 3D display and OPFS restoration.

## Public API

### `recoverRefPointDefinitionsFromZips(folderHandle: FileSystemDirectoryHandle): Promise<RefPointRecoveryResult>`

Scans all ZIP files in the folder, extracts `refPoints/*.json` entries as full `RefPointDefinition`, and merges observations for the same ref point ID across ZIPs.

**Input:** Read-only folder handle from `showDirectoryPicker`.

**Output:**

```typescript
interface RefPointRecoveryResult {
  definitions: RefPointDefinition[]; // Merged, deduplicated definitions
  zipFilesScanned: number;
  errors: string[]; // Non-fatal errors (malformed JSON, corrupt ZIPs)
}
```

**Error handling:**

- Corrupt ZIPs: logged as warning, skipped, error recorded in `errors[]`
- Malformed JSON: logged, skipped, error recorded
- Missing `refPoints/` folder in a ZIP: silently returns 0 for that ZIP
- Folder scan failure: returns partial results accumulated so far

## Invariants & Assumptions

- Ref point IDs are unique per H3 cell. Merging is by exact ID match (not H3 gridDisk proximity like the importer — recovery assumes the same cell ID is the same ref point).
- Observations are deduplicated by `sessionId + timestamp` composite key.
- When merging names: first-encountered name wins (consistent with `saveRefPointObservation` first-name-wins behavior).
- When merging `createdAt`: earliest value wins.
- Output is sorted by `createdAt` for deterministic ordering.
- Empty `observations[]` is schema-valid and preserved (maintains ref point identity/name).

## Examples

```typescript
import { recoverRefPointDefinitionsFromZips } from './ref-point-recovery';

const readFolder = getReadFolderHandle(); // from showDirectoryPicker
const result = await recoverRefPointDefinitionsFromZips(readFolder);

// Write recovered definitions to OPFS
for (const def of result.definitions) {
  await writeRefPointDefinition(scenarioHandle, def);
}
```

## Tests

- `ref-point-recovery.test.ts` — 11 unit tests covering:
  - Empty folder, single ZIP, multi-ZIP merge, deduplication
  - Error handling (malformed JSON, corrupt ZIPs)
  - Edge cases (empty observations, sort order, non-ZIP files)
