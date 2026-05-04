/**
 * Reference Point Importer Module
 *
 * Extracts reference points from ZIP files in a folder, enabling reuse of
 * ref points from previous recording sessions.
 *
 * This module:
 * 1. Enumerates all *.zip files in a folder
 * 2. Opens each ZIP and looks for refPoints/*.json files
 * 3. Parses and validates each ref point definition
 * 4. Merges and deduplicates ref points by ID
 *
 * Uses @zip.js/zip.js for ZIP reading (same library as zip-export.ts).
 */

import { BlobReader, ZipReader, TextWriter } from '@zip.js/zip.js';
import type { RefPointDefinition } from './ref-point-loader';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { h3RefsMatch, isH3Index } from 'gps-plus-slam-app-framework/ref-points/h3-ref-point';

const log = createLogger('RefPointImporter');

// ============================================================================
// Types
// ============================================================================

/**
 * Simplified reference point for import/suggestion purposes.
 * Contains only the essential data needed for ref point suggestions and display.
 * The `lat`/`lon` are kept for "nearby ref point" proximity suggestions.
 */
export interface ImportedRefPoint {
  /** Unique identifier — H3 hex index since the March 2026 H3 migration */
  readonly id: string;
  /** Human-readable display name entered by the user (e.g., "Bench Corner") */
  readonly name: string;
  /** Latitude from first observation (for future proximity-based suggestions) */
  readonly lat: number;
  /** Longitude from first observation */
  readonly lon: number;
  /** Optional altitude */
  readonly alt?: number;
  /** Source ZIP file name for debugging/tracking */
  readonly sourceZipName: string;
}

/**
 * Result from importing reference points from a folder.
 */
export interface RefPointImportResult {
  /** Whether the import completed (even with some errors) */
  readonly success: boolean;
  /** Merged, deduplicated reference points from all ZIPs */
  readonly refPoints: ImportedRefPoint[];
  /** Number of ZIP files successfully scanned */
  readonly zipFilesScanned: number;
  /** Error messages from failed ZIPs or malformed ref points */
  readonly errors: string[];
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a file name is a ZIP file (case-insensitive).
 */
function isZipFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

/**
 * Check if a ZIP entry path is a ref point JSON file.
 * Expected path: refPoints/{id}.json
 */
function isRefPointEntry(entryPath: string): boolean {
  return (
    entryPath.startsWith('refPoints/') &&
    entryPath.endsWith('.json') &&
    entryPath !== 'refPoints/'
  );
}

/**
 * Type guard to validate parsed JSON matches RefPointDefinition shape.
 * Validates at least one observation exists with required nested properties.
 */
function isValidRefPointDefinition(
  value: unknown
): value is RefPointDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Check required fields
  if (
    typeof obj.id !== 'string' ||
    typeof obj.name !== 'string' ||
    typeof obj.createdAt !== 'number' ||
    !Array.isArray(obj.observations)
  ) {
    return false;
  }

  // Empty observations is technically valid (though unusual)
  if (obj.observations.length === 0) {
    return true;
  }

  // Check first observation has valid structure
  const firstObs = obj.observations[0] as Record<string, unknown>;
  if (typeof firstObs !== 'object' || firstObs === null) {
    return false;
  }

  // Check gpsPoint exists with lat/lon
  const gpsPoint = firstObs.gpsPoint as Record<string, unknown> | undefined;
  if (
    typeof gpsPoint !== 'object' ||
    gpsPoint === null ||
    typeof gpsPoint.latitude !== 'number' ||
    typeof gpsPoint.longitude !== 'number'
  ) {
    return false;
  }

  return true;
}

/**
 * Convert a RefPointDefinition to an ImportedRefPoint.
 * Extracts GPS coordinates from the first observation.
 */
function toImportedRefPoint(
  def: RefPointDefinition,
  sourceZipName: string
): ImportedRefPoint | null {
  if (def.observations.length === 0) {
    // No observations - can't get GPS coordinates
    return null;
  }

  const firstObs = def.observations[0]!;
  return {
    id: def.id,
    name: def.name,
    lat: firstObs.gpsPoint.latitude,
    lon: firstObs.gpsPoint.longitude,
    alt: firstObs.gpsPoint.altitude,
    sourceZipName,
  };
}

// ============================================================================
// ZIP Processing
// ============================================================================

/**
 * Extract reference points from a single ZIP file.
 *
 * @param zipBlob - The ZIP file as a Blob
 * @param zipFileName - Name of the ZIP file (for error messages)
 * @returns Array of imported ref points and any errors
 */
async function extractRefPointsFromZip(
  zipBlob: Blob,
  zipFileName: string
): Promise<{ refPoints: ImportedRefPoint[]; errors: string[] }> {
  const refPoints: ImportedRefPoint[] = [];
  const errors: string[] = [];

  const zipReader = new ZipReader(new BlobReader(zipBlob));

  try {
    const entries = await zipReader.getEntries();

    for (const entry of entries) {
      // Skip directories (they don't have getData)
      if (entry.directory) {
        continue;
      }

      // Skip non-refPoint entries
      if (!isRefPointEntry(entry.filename)) {
        continue;
      }

      try {
        // Read the JSON content
        // Note: For file entries, getData is always defined, but TypeScript
        // doesn't know this after the directory check. We use type assertion.
        const textWriter = new TextWriter();
        const jsonText = await entry.getData(textWriter);

        // Parse JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch (parseErr) {
          errors.push(
            `${zipFileName}/${entry.filename}: Invalid JSON - ${(parseErr as Error).message}`
          );
          continue;
        }

        // Validate structure
        if (!isValidRefPointDefinition(parsed)) {
          errors.push(
            `${zipFileName}/${entry.filename}: Invalid ref point schema`
          );
          continue;
        }

        // Convert to ImportedRefPoint
        const imported = toImportedRefPoint(parsed, zipFileName);
        if (imported) {
          refPoints.push(imported);
        }
      } catch (entryErr) {
        errors.push(
          `${zipFileName}/${entry.filename}: ${(entryErr as Error).message}`
        );
      }
    }
  } finally {
    await zipReader.close();
  }

  return { refPoints, errors };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Import reference points from all ZIP files in a folder.
 *
 * Enumerates all *.zip files in the folder, extracts refPoints/*.json from each,
 * and merges them into a deduplicated list.
 *
 * Deduplication: If the same ref point ID appears in multiple ZIPs, the first
 * occurrence is kept (based on iteration order).
 *
 * @param folderHandle - Read-only directory handle from showDirectoryPicker
 * @returns Result containing merged ref points, scan count, and errors
 */
export async function importRefPointsFromFolder(
  folderHandle: FileSystemDirectoryHandle
): Promise<RefPointImportResult> {
  const allRefPoints: ImportedRefPoint[] = [];
  const seenIds = new Set<string>();
  const allErrors: string[] = [];
  let zipFilesScanned = 0;

  log.info(`Scanning folder: ${folderHandle.name}`);

  try {
    // Iterate over all entries in the folder
    for await (const entry of folderHandle.values()) {
      // Skip non-files and non-ZIPs
      if (entry.kind !== 'file' || !isZipFileName(entry.name)) {
        continue;
      }

      log.debug(`Processing ZIP: ${entry.name}`);

      try {
        // Get file handle and read blob
        const fileHandle = await folderHandle.getFileHandle(entry.name);
        const file = await fileHandle.getFile();

        // Extract ref points from this ZIP
        const { refPoints, errors } = await extractRefPointsFromZip(
          file,
          entry.name
        );

        zipFilesScanned++;
        allErrors.push(...errors);

        // Deduplicate: for H3 IDs, use gridDisk overlap to catch GPS jitter.
        // For legacy string IDs, use exact match.
        for (const refPoint of refPoints) {
          const isDuplicate = isH3Index(refPoint.id)
            ? allRefPoints.some(
                (existing) =>
                  isH3Index(existing.id) &&
                  h3RefsMatch(existing.id, refPoint.id)
              )
            : seenIds.has(refPoint.id);

          if (!isDuplicate) {
            seenIds.add(refPoint.id);
            allRefPoints.push(refPoint);
          } else {
            log.debug(
              `Skipping duplicate ref point: ${refPoint.id} from ${entry.name}`
            );
          }
        }
      } catch (zipErr) {
        const errorMsg = `Failed to process ${entry.name}: ${(zipErr as Error).message}`;
        log.warn(errorMsg);
        allErrors.push(errorMsg);
      }
    }

    log.info(
      `Imported ${allRefPoints.length} ref points from ${zipFilesScanned} ZIP files`
    );

    return {
      success: true,
      refPoints: allRefPoints,
      zipFilesScanned,
      errors: allErrors,
    };
  } catch (err) {
    const errorMsg = `Failed to scan folder: ${(err as Error).message}`;
    log.error(errorMsg);
    return {
      success: false,
      refPoints: allRefPoints,
      zipFilesScanned,
      errors: [...allErrors, errorMsg],
    };
  }
}
