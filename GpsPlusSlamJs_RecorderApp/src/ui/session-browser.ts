/**
 * Session Browser Module
 *
 * Provides pure functions for enumerating scenarios and session recordings
 * from a FileSystemDirectoryHandle. Used by the Replay Mode UX (Iteration 5
 * of 2026-02-19-replay-mode.md) to let desktop users browse and select
 * previously recorded sessions for replay.
 *
 * Also supports metadata-based discovery: reading session.json from inside
 * root-level zip files to determine the scenario name (Issue 1, 2026-03-01).
 *
 * The expected folder structure:
 *   <RootFolder>/
 *   ├── Scenario A/
 *   │   ├── refPoints/
 *   │   ├── recording-2026-01-27_14-30-11utc.zip
 *   │   └── ScenarioA-session-2026-02-06_03-52-13utc.zip
 *   └── Scenario B/
 *       └── recording-2026-02-10_09-00-00utc.zip
 *
 * @see docs/2026-02-19-replay-mode.md Issue 6
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A session recording entry found within a scenario folder.
 */
export interface SessionEntry {
  /** Original zip filename (e.g., "recording-2026-02-19_10-15-00utc.zip") */
  filename: string;
  /** File handle for reading zip bytes */
  fileHandle: FileSystemFileHandle;
  /** Parsed UTC date from filename, or null if filename doesn't match pattern */
  date: Date | null;
}

/**
 * A map from scenario name to its session entries.
 * Used in replay mode to group recordings by scenario.
 */
export type ScenarioSessionMap = Map<string, SessionEntry[]>;

// ---------------------------------------------------------------------------
// Filename date pattern
// ---------------------------------------------------------------------------

/**
 * Regex matching the timestamp portion of session zip filenames.
 *
 * Matches both formats:
 * - "recording-YYYY-MM-DD_HH-MM-SSutc.zip"
 * - "ScenarioName-session-YYYY-MM-DD_HH-MM-SSutc.zip"
 *
 * Captures: year, month, day, hours, minutes, seconds
 */
const SESSION_DATE_PATTERN =
  /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})utc\.zip$/;

/**
 * Regex matching scenario-prefixed session zip filenames.
 *
 * Captures the scenario name before "-session-":
 * - "Paris-session-2026-01-30_14-30-45utc.zip" → "Paris"
 * - "Paris-Eiffeltower-session-2026-02-06_03-52-13utc.zip" → "Paris-Eiffeltower"
 *
 * Does NOT match timestamp-only filenames like "2026-02-19_10-15-00utc.zip"
 * or "recording-2026-01-27_14-30-11utc.zip".
 */
const SCENARIO_PREFIX_PATTERN =
  /^(.+)-session-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/;

import { loadSessionMetadataFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { mapWithConcurrencyLimit } from 'gps-plus-slam-app-framework/utils/concurrency';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a UTC date from a session zip filename.
 *
 * Supports both standard recording filenames and scenario-prefixed filenames:
 * - "recording-2026-02-19_10-15-00utc.zip"
 * - "Paris-session-2026-01-30_14-30-45utc.zip"
 *
 * @param filename - The zip filename to parse
 * @returns Parsed Date in UTC, or null if filename doesn't match the expected pattern
 */
export function parseDateFromSessionFilename(filename: string): Date | null {
  const match = SESSION_DATE_PATTERN.exec(filename);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  // Construct ISO 8601 string for unambiguous UTC parsing
  const iso = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
  const date = new Date(iso);

  // Validate the date is real (e.g., not Feb 30)
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Enumerate scenario names (top-level directories) from a folder handle.
 *
 * Filters to directory entries only and returns names sorted alphabetically.
 *
 * @param rootHandle - FileSystemDirectoryHandle from showDirectoryPicker()
 * @returns Array of scenario folder names, sorted alphabetically
 */
export async function listScenariosFromFolder(
  rootHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const scenarios: string[] = [];

  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === 'directory') {
      scenarios.push(name);
    }
  }

  return scenarios.sort();
}

/**
 * Extract unique scenario names from top-level ZIP filenames in a folder.
 *
 * Parses scenario-prefixed filenames (e.g., "Paris-session-2026-01-30_14-30-45utc.zip")
 * and extracts the scenario name ("Paris"). Timestamp-only ZIPs (e.g.,
 * "recording-...utc.zip" or "2026-...utc.zip") are ignored since they carry
 * no scenario information.
 *
 * Returns deduplicated, alphabetically sorted scenario names.
 *
 * @param rootHandle - FileSystemDirectoryHandle from showDirectoryPicker()
 * @returns Array of unique scenario names extracted from ZIP filenames, sorted alphabetically
 */
export async function extractScenarioNamesFromZips(
  rootHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const scenarioSet = new Set<string>();

  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.zip')) {
      continue;
    }

    const match = SCENARIO_PREFIX_PATTERN.exec(name);
    if (match) {
      scenarioSet.add(match[1]!);
    }
  }

  return [...scenarioSet].sort();
}

// ---------------------------------------------------------------------------
// Zip metadata discovery (Issue 1 — 2026-03-01 user feedback)
// ---------------------------------------------------------------------------

/**
 * Result of discovering scenarios from root-level zip file metadata.
 * Each zip is opened and its session.json is read to determine the scenario name.
 */
interface ZipMetadataDiscoveryResult {
  /** Scenario names → session entries (with file handles for reading zip bytes) */
  scenarioSessions: ScenarioSessionMap;
  /** All unique scenario names found, sorted alphabetically */
  scenarioNames: string[];
}

/**
 * Canonical scenario name used for recordings with no explicit scenario.
 * Both missing metadata and explicit "Default Scenario" in session.json
 * map to this value (UX feedback 2026-03-23 Issue 2).
 */
export const DEFAULT_SCENARIO = 'Default Scenario';

/**
 * Maximum number of zip files to read concurrently during metadata discovery.
 * Limits peak I/O and memory when scanning folders with many recordings.
 * Each concurrent read uses BlobReader (only central directory + session.json),
 * so memory per zip is small, but we still cap it to avoid overwhelming the
 * browser's I/O subsystem.
 */
const METADATA_SCAN_CONCURRENCY = 4;

/**
 * Discover scenarios by reading session.json metadata from root-level zip files.
 *
 * For each `.zip` file in the root directory:
 * 1. Gets a File handle (Blob) — does NOT load the full file into memory
 * 2. Calls `loadSessionMetadataFromBlob()` which uses BlobReader to read
 *    only the zip central directory and the session.json entry
 * 3. Groups the zip by its `scenarioName` metadata field (or UNKNOWN_SCENARIO if absent)
 *
 * Memory efficiency: Uses BlobReader (not arrayBuffer) and limits concurrency
 * to METADATA_SCAN_CONCURRENCY to avoid excessive memory consumption when
 * scanning folders with many large recording zips.
 *
 * This is more accurate than filename-based discovery (`extractScenarioNamesFromZips`)
 * because it uses the actual metadata the recording app wrote, handling timestamp-only
 * filenames like `2026-03-01_09-08-48utc.zip` that carry no scenario information.
 *
 * @param rootHandle - FileSystemDirectoryHandle from showDirectoryPicker()
 * @returns Discovery result with scenario→sessions map and sorted scenario names
 */
export async function discoverScenariosFromZipMetadata(
  rootHandle: FileSystemDirectoryHandle
): Promise<ZipMetadataDiscoveryResult> {
  const scenarioSessions: ScenarioSessionMap = new Map();

  // Collect all zip file handles first
  const zipHandles: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === 'file' && name.endsWith('.zip')) {
      zipHandles.push({ name, handle: handle as FileSystemFileHandle });
    }
  }

  // Read metadata from each zip with concurrency limit.
  // Uses BlobReader (via loadSessionMetadataFromBlob) so only the zip
  // central directory and session.json entry are read — not the full file.
  const metadataResults = await mapWithConcurrencyLimit(
    zipHandles,
    METADATA_SCAN_CONCURRENCY,
    async ({ name, handle }) => {
      try {
        const file = await handle.getFile();
        const metadata = await loadSessionMetadataFromBlob(file);
        return { name, handle, metadata };
      } catch {
        // Skip zips that can't be read (corrupted, too large, etc.)
        return { name, handle, metadata: null };
      }
    }
  );

  // Group by scenarioName from metadata.
  // The framework now stores the recorder's scenario name in the opaque
  // `contextTag` field (post-Iter 0 of the AppFramework/RecorderApp boundary
  // migration). Older zips used a dedicated `scenarioName` field — fall back
  // to it for backwards compatibility with previously-exported recordings.
  for (const { name, handle, metadata } of metadataResults) {
    // Merge missing metadata and "Default Scenario" into the same canonical
    // group (UX feedback 2026-03-23 Issue 2).
    let scenarioName: string;
    const legacyScenarioName = (metadata as { scenarioName?: unknown } | null)
      ?.scenarioName;
    const tag =
      typeof metadata?.contextTag === 'string' && metadata.contextTag.length > 0
        ? metadata.contextTag
        : typeof legacyScenarioName === 'string' &&
            legacyScenarioName.length > 0
          ? legacyScenarioName
          : null;
    if (tag !== null && tag !== DEFAULT_SCENARIO) {
      scenarioName = tag;
    } else {
      scenarioName = DEFAULT_SCENARIO;
    }

    const entry: SessionEntry = {
      filename: name,
      fileHandle: handle,
      date: parseDateFromSessionFilename(name),
    };

    const existing = scenarioSessions.get(scenarioName);
    if (existing) {
      existing.push(entry);
    } else {
      scenarioSessions.set(scenarioName, [entry]);
    }
  }

  // Sort sessions within each scenario by filename (reverse order — most recent first)
  for (const sessions of scenarioSessions.values()) {
    sessions.sort((a, b) => b.filename.localeCompare(a.filename));
  }

  const scenarioNames = [...scenarioSessions.keys()].sort();
  return { scenarioSessions, scenarioNames };
}

/**
 * Enumerate session zip files within a scenario directory.
 *
 * Filters to files ending in `.zip`, parses dates from filenames, and
 * returns entries sorted by filename (chronological for standard naming).
 *
 * @param scenarioHandle - FileSystemDirectoryHandle for the scenario folder
 * @returns Array of SessionEntry objects sorted by filename
 */
export async function listSessionZipsInScenario(
  scenarioHandle: FileSystemDirectoryHandle
): Promise<SessionEntry[]> {
  const sessions: SessionEntry[] = [];

  for await (const [name, handle] of scenarioHandle.entries()) {
    if (handle.kind === 'file' && name.endsWith('.zip')) {
      sessions.push({
        filename: name,
        fileHandle: handle as FileSystemFileHandle,
        date: parseDateFromSessionFilename(name),
      });
    }
  }

  return sessions.sort((a, b) => b.filename.localeCompare(a.filename));
}
