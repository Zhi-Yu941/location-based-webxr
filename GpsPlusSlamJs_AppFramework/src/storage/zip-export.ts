/**
 * ZIP Export Module
 *
 * Exports OPFS session data as ZIP files for download.
 * Uses @zip.js/zip.js library for streaming ZIP creation and reading.
 *
 * The ZIP uses "store" mode (no compression) because:
 * 1. Images are already compressed (JPEG)
 * 2. Faster packaging
 * 3. Simpler implementation
 *
 * @zip.js/zip.js was chosen over fflate because:
 * - Supports streaming reads and writes (needed for periodic sync to external file)
 * - Can append to existing ZIP files via prependZip
 * - Actively maintained with good TypeScript support
 * - Built-in Web Worker support for non-blocking compression
 */

import { BlobWriter, ZipWriter, BlobReader } from '@zip.js/zip.js';
import { createLogger } from '../utils/logger';

const log = createLogger('ZipExport');

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a ZIP export operation.
 * Provides the blob and metadata for share + summary display.
 *
 * @see 2026-02-06 User Feedback Issue #2 (Share) and Issue #3 (ZIP Stats)
 */
export interface ZipExportResult {
  /** The ZIP blob ready for download or sharing */
  readonly blob: Blob;
  /** Number of files packaged in the ZIP */
  readonly fileCount: number;
}

/**
 * Helper passed to a {@link ZipExportContributor.contribute} callback for
 * appending blobs to the ZIP under a stable, contributor-owned subdirectory.
 *
 * The framework prepends the contributor's `subdir` to the supplied
 * `relativePath` automatically, so contributors only think in terms of paths
 * relative to their own subdir (e.g. `'42.json'`, not `'refPoints/42.json'`).
 */
export type ZipContributorAddFile = (
  relativePath: string,
  blob: Blob
) => Promise<void>;

/**
 * Extension contributor that lets a consumer (typically the recorder)
 * append app-specific files to a session ZIP without forking the
 * framework's ZIP writer.
 *
 * Each contributor declares a top-level subdirectory it owns inside the
 * ZIP (e.g. the recorder uses `refPoints/`). The framework calls
 * {@link contribute} after writing all framework-owned sections.
 *
 * Contributors must:
 *  - Only write files under their declared `subdir` (the framework enforces
 *    this by routing every `addFile` call through the prefix).
 *  - Tolerate an empty source (e.g. a session with no ref points) by
 *    returning `0` instead of throwing.
 *
 * @see 2026-05-03-appframework-vs-recorderapp-boundary-analysis.md — Iter 2.
 */
export interface ZipExportContributor {
  /** Top-level subdirectory inside the ZIP (no leading or trailing `/`). */
  readonly subdir: string;
  /**
   * Append files for this contributor. Implementations call `addFile`
   * once per file with a path relative to {@link subdir}.
   *
   * @returns Number of files added so the framework's `fileCount` total
   *   stays accurate for download summaries.
   */
  contribute(addFile: ZipContributorAddFile): Promise<number>;
}

/**
 * Options for {@link exportSessionAsZip}.
 */
export interface ExportSessionAsZipOptions {
  /**
   * Optional list of {@link ZipExportContributor}s. Each is invoked after
   * framework-owned sections have been written. Order is preserved in the
   * resulting ZIP central directory but has no semantic effect.
   */
  readonly contributors?: readonly ZipExportContributor[];
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the OPFS scenarios directory handle.
 * Re-acquires from navigator.storage to avoid holding stale references.
 * Creates on demand so it works even when initOpfsStorage only creates sessions/.
 */
async function getScenariosHandle(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  const gpsRecorderDir = await opfsRoot.getDirectoryHandle('gps-recorder');
  return gpsRecorderDir.getDirectoryHandle('scenarios', { create: true });
}

/**
 * Get the OPFS sessions directory handle (flat layout).
 */
async function getSessionsHandle(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  const gpsRecorderDir = await opfsRoot.getDirectoryHandle('gps-recorder');
  return gpsRecorderDir.getDirectoryHandle('sessions');
}

/**
 * Stream all files from a directory recursively into a ZipWriter.
 * Files are read one at a time and immediately added to the ZIP,
 * keeping memory usage proportional to a single file (not the total).
 *
 * @returns Number of files added
 */
async function streamDirectoryToZip(
  dirHandle: FileSystemDirectoryHandle,
  zipWriter: ZipWriter<Blob>,
  basePath: string = ''
): Promise<number> {
  let count = 0;

  for await (const entry of dirHandle.values()) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      const fileHandle = await dirHandle.getFileHandle(entry.name);
      const file = await fileHandle.getFile();
      await zipWriter.add(relativePath, new BlobReader(file));
      count++;
    } else if (entry.kind === 'directory') {
      const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
      count += await streamDirectoryToZip(
        subDirHandle,
        zipWriter,
        relativePath
      );
    }
  }

  return count;
}

// Per-session ref-point ZIP filtering moved to the recorder app in Iter 3 of
// the AppFramework / RecorderApp boundary cleanup. Recorder consumers now
// register a `ZipExportContributor` via `exportSessionAsZip({ contributors })`.
// See gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md

// ============================================================================
// Public API
// ============================================================================

/**
 * Export a session from OPFS as a ZIP blob.
 *
 * The ZIP structure mirrors the OPFS session structure:
 * - session.json (at root)
 * - actions/000001.json, actions/000002.json, ...
 * - frames/frame-000001.jpg, frames/frame-000002.jpg, ...
 * - refPoints/{h3}.json (only observations from this session, scenario layout only)
 *
 * Uses "store" mode (compression level 0) for fast packaging.
 *
 * Supports both flat and scenario-based layouts:
 * - `exportSessionAsZip(sessionName)` — flat layout (sessions/)
 * - `exportSessionAsZip(scenarioName, sessionName)` — scenario layout (scenarios/{name}/)
 *
 * @returns ZIP export result with blob and file count
 * @throws Error if session not found
 */
export async function exportSessionAsZip(
  scenarioNameOrSessionName: string,
  sessionName?: string,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  let sessionHandle: FileSystemDirectoryHandle;
  let scenarioHandle: FileSystemDirectoryHandle | null = null;

  if (sessionName) {
    // Scenario-based layout: scenarios/{scenarioName}/{sessionName}
    const scenarioName = scenarioNameOrSessionName;
    log.info(`Exporting session: ${scenarioName}/${sessionName}`);

    const scenariosDir = await getScenariosHandle();
    try {
      scenarioHandle = await scenariosDir.getDirectoryHandle(scenarioName);
    } catch {
      throw new Error(`Scenario "${scenarioName}" not found in OPFS storage`);
    }

    try {
      sessionHandle = await scenarioHandle.getDirectoryHandle(sessionName);
    } catch {
      throw new Error(
        `Session "${sessionName}" not found in scenario "${scenarioName}"`
      );
    }
  } else {
    // Flat layout: sessions/{sessionName}
    log.info(`Exporting session: ${scenarioNameOrSessionName}`);

    const sessionsDir = await getSessionsHandle();
    try {
      sessionHandle = await sessionsDir.getDirectoryHandle(
        scenarioNameOrSessionName
      );
    } catch {
      throw new Error(
        `Session "${scenarioNameOrSessionName}" not found in OPFS storage`
      );
    }
  }

  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  let fileCount = await streamDirectoryToZip(sessionHandle, zipWriter);

  // Caller-supplied extension contributors. Each owns a single top-level
  // subdir; the framework prepends that subdir to every file path so the
  // contributor cannot accidentally write outside its own namespace.
  const contributors = options?.contributors ?? [];
  const seenSubdirs = new Set<string>();
  for (const contributor of contributors) {
    const subdir = contributor.subdir;
    if (!subdir || subdir.includes('/') || subdir.startsWith('.')) {
      throw new Error(
        `ZipExportContributor.subdir must be a non-empty single path segment, got: ${JSON.stringify(
          subdir
        )}`
      );
    }
    if (seenSubdirs.has(subdir)) {
      throw new Error(
        `Duplicate ZipExportContributor.subdir registered: ${subdir}`
      );
    }
    seenSubdirs.add(subdir);

    const addFile: ZipContributorAddFile = async (relativePath, blob) => {
      if (relativePath.startsWith('/')) {
        throw new Error(
          `ZipExportContributor relative path must not start with '/' (got ${relativePath})`
        );
      }
      await zipWriter.add(
        `${subdir}/${relativePath}`,
        new BlobReader(blob)
      );
    };
    fileCount += await contributor.contribute(addFile);
  }

  const blob = await zipWriter.close();
  log.info(`ZIP created: ${blob.size} bytes, ${fileCount} files`);

  return { blob, fileCount };
}

/**
 * Sync current OPFS session data to an external file handle.
 *
 * This is used for periodic sync during recording to save data to the user's
 * chosen location (obtained via showSaveFilePicker). The function:
 * 1. Reads all current session data from OPFS
 * 2. Creates a ZIP in memory
 * 3. Writes the ZIP to the external file handle
 *
 * This provides crash safety combined with OPFS - even if the app crashes,
 * the last synced ZIP contains all data up to that point.
 *
 * @param fileHandle - File handle from showSaveFilePicker
 * @param scenarioName - Name of the scenario
 * @param sessionName - Name of the session folder
 * @returns ZIP export result with blob and file count
 * @throws Error if scenario or session not found
 */
export async function syncToExternalZip(
  fileHandle: FileSystemFileHandle,
  scenarioName: string,
  sessionName: string,
  options?: ExportSessionAsZipOptions
): Promise<ZipExportResult> {
  log.info(`Syncing to external ZIP: ${scenarioName}/${sessionName}`);

  // Export session as blob
  const result = await exportSessionAsZip(scenarioName, sessionName, options);

  // Write to external file handle
  const writable = await fileHandle.createWritable();
  await writable.write(result.blob);
  await writable.close();

  log.info(`Synced ${result.blob.size} bytes to external file`);

  return result;
}

/**
 * Trigger a file download in the browser.
 *
 * Uses showSaveFilePicker if available (for better UX on desktop),
 * falls back to <a download> for broader compatibility.
 *
 * @param blob - The blob to download
 * @param filename - Suggested filename
 */
export async function downloadZip(blob: Blob, filename: string): Promise<void> {
  // Try File System Access API first (better UX on desktop)
  if ('showSaveFilePicker' in window && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'ZIP Archive',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      log.info(`Saved via File System Access API: ${filename}`);
      return;
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        // User cancelled - don't fall through
        log.info('User cancelled save dialog');
        return;
      }
      // Fall through to <a download> fallback
      log.warn('showSaveFilePicker failed, using fallback:', error.message);
    }
  }

  // Fallback: <a download> approach
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  log.info(`Download triggered via <a download>: ${filename}`);
}

/**
 * Export and download a session in one step.
 *
 * Convenience function combining exportSessionAsZip and downloadZip.
 *
 * @param scenarioName - Name of the scenario
 * @param sessionName - Name of the session folder
 */
export async function exportAndDownloadSession(
  scenarioName: string,
  sessionName: string
): Promise<void> {
  const { blob } = await exportSessionAsZip(scenarioName, sessionName);
  const filename = `${scenarioName}-${sessionName}.zip`;
  await downloadZip(blob, filename);
}
