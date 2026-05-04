/**
 * Tests for ref-point-recovery.ts
 *
 * Recovery module: extracts full RefPointDefinition objects from ZIP files
 * and merges observations by H3 cell ID. Unlike ref-point-importer (which
 * returns simplified ImportedRefPoint for display), this module preserves
 * complete observation data (AR poses, GPS, timestamps) needed for 3D
 * display and OPFS restoration after browser data loss.
 *
 * @module ref-point-recovery.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlobWriter, ZipWriter, TextReader } from '@zip.js/zip.js';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';
import type { GpsPoint } from 'gps-plus-slam-js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock FileSystemDirectoryHandle for testing.
 * Same pattern as ref-point-importer.test.ts.
 */
function createMockFolderHandle(
  entries: Array<{
    name: string;
    kind: 'file' | 'directory';
    getFile?: () => Promise<File>;
  }>
): FileSystemDirectoryHandle {
  return {
    kind: 'directory' as const,
    name: 'test-folder',
    values: vi.fn(() => {
      let index = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          if (index < entries.length) {
            return Promise.resolve({
              value: entries[index++],
              done: false as const,
            });
          }
          return Promise.resolve({ value: undefined, done: true as const });
        },
      };
    }),
    getFileHandle: vi.fn((name: string) => {
      const entry = entries.find((e) => e.name === name && e.kind === 'file');
      if (!entry) {
        return Promise.reject(new Error(`File not found: ${name}`));
      }
      return Promise.resolve(entry);
    }),
  } as unknown as FileSystemDirectoryHandle;
}

/** Build a realistic GpsPoint with all required fields. */
function makeGpsPoint(lat: number, lon: number, alt: number = 100): GpsPoint {
  return {
    id: `gps-${Date.now()}`,
    zeroRef: { lat, lon },
    latitude: lat,
    longitude: lon,
    altitude: alt,
    latLongAccuracy: 5,
    coordinates: [0, 0, 0],
    weight: 1,
    timestamp: Date.now(),
  };
}

/** Build a RefPointObservation with all required nested fields. */
function makeObservation(
  sessionId: string,
  timestamp: number,
  lat: number = 50.0,
  lon: number = 8.0
): RefPointObservation {
  return {
    sessionId,
    timestamp,
    arPose: {
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    },
    gpsPoint: makeGpsPoint(lat, lon),
  };
}

/** Build a RefPointDefinition with the given observations. */
function makeRefPointDef(
  id: string,
  name: string,
  observations: RefPointObservation[]
): RefPointDefinition {
  return {
    id,
    name,
    createdAt: observations.length > 0 ? observations[0].timestamp : Date.now(),
    observations,
  };
}

/** Create a ZIP blob containing ref point definitions and an optional session.json. */
async function createTestZipBlob(
  refPoints: RefPointDefinition[],
  scenarioName: string = 'TestScenario'
): Promise<Blob> {
  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  await zipWriter.add(
    'session.json',
    new TextReader(
      JSON.stringify({
        version: 1,
        startedAt: new Date().toISOString(),
        scenarioName,
        actionCount: 0,
        frameCount: 0,
        userAgent: 'test',
      })
    )
  );

  for (const rp of refPoints) {
    await zipWriter.add(
      `refPoints/${rp.id}.json`,
      new TextReader(JSON.stringify(rp))
    );
  }

  return zipWriter.close();
}

/** Create a mock file entry (matching the pattern from importer tests). */
function createMockFileEntry(
  name: string,
  blob: Blob
): { name: string; kind: 'file'; getFile: () => Promise<File> } {
  return {
    name,
    kind: 'file' as const,
    getFile: () =>
      Promise.resolve(new File([blob], name, { type: 'application/zip' })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ref-point-recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recoverRefPointDefinitionsFromZips', () => {
    /**
     * Why this test matters:
     * Empty folder is the base case — recovery should not crash and
     * should return an empty result set.
     */
    it('should return empty definitions for empty folder', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const folderHandle = createMockFolderHandle([]);
      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toEqual([]);
      expect(result.zipFilesScanned).toBe(0);
      expect(result.errors).toEqual([]);
    });

    /**
     * Why this test matters:
     * Core recovery scenario — a single ZIP with one ref point should return
     * the full RefPointDefinition including all observation data (AR poses,
     * GPS, timestamps) needed for 3D display and OPFS restoration.
     */
    it('should extract full RefPointDefinition from single ZIP', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const obs = makeObservation('session-1', 1000, 50.1, 8.1);
      const def = makeRefPointDef('h3-cell-a', 'Bench', [obs]);
      const zipBlob = await createTestZipBlob([def]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('h3-cell-a');
      expect(result.definitions[0].name).toBe('Bench');
      expect(result.definitions[0].observations).toHaveLength(1);
      // Full observation data preserved (not simplified to lat/lon)
      expect(result.definitions[0].observations[0].arPose.position).toEqual([
        1, 2, 3,
      ]);
      expect(
        result.definitions[0].observations[0].gpsPoint.latitude
      ).toBeCloseTo(50.1);
      expect(result.definitions[0].observations[0].sessionId).toBe('session-1');
      expect(result.zipFilesScanned).toBe(1);
    });

    /**
     * Why this test matters:
     * The key merge scenario — same H3 cell observed in two different session
     * ZIPs. Observations must be unioned (not deduplicated by first-wins like
     * the simplified importer). This is what enables full OPFS reconstruction.
     */
    it('should merge observations from multiple ZIPs for the same ref point ID', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const obs1 = makeObservation('session-1', 1000, 50.1, 8.1);
      const obs2 = makeObservation('session-2', 2000, 50.1001, 8.1001);

      const def1 = makeRefPointDef('h3-cell-a', 'Bench', [obs1]);
      const def2 = makeRefPointDef('h3-cell-a', 'Bench Renamed', [obs2]);

      const zip1 = await createTestZipBlob([def1]);
      const zip2 = await createTestZipBlob([def2]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-2.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('h3-cell-a');
      // Observations from both ZIPs merged
      expect(result.definitions[0].observations).toHaveLength(2);
      // Uses earliest createdAt
      expect(result.definitions[0].createdAt).toBe(1000);
      // Uses first-encountered name (consistent with current first-name-wins behavior)
      expect(result.definitions[0].name).toBe('Bench');
      expect(result.zipFilesScanned).toBe(2);
    });

    /**
     * Why this test matters:
     * Different H3 cells must remain separate — the merge is by ID only.
     */
    it('should keep different H3 cell ref points separate', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const defA = makeRefPointDef('h3-cell-a', 'Bench', [
        makeObservation('session-1', 1000, 50.1, 8.1),
      ]);
      const defB = makeRefPointDef('h3-cell-b', 'Tree', [
        makeObservation('session-1', 1001, 50.2, 8.2),
      ]);

      const zip1 = await createTestZipBlob([defA]);
      const zip2 = await createTestZipBlob([defB]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-2.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(2);
      const ids = result.definitions.map((d) => d.id).sort();
      expect(ids).toEqual(['h3-cell-a', 'h3-cell-b']);
    });

    /**
     * Why this test matters:
     * Deduplication by sessionId + timestamp prevents double-counting when
     * the same observation appears in multiple exports (e.g., periodic sync
     * re-exports).
     */
    it('should deduplicate observations by sessionId + timestamp', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      // Same observation in two ZIPs (periodic sync produced both)
      const obs = makeObservation('session-1', 1000, 50.1, 8.1);
      const def1 = makeRefPointDef('h3-cell-a', 'Bench', [obs]);
      const def2 = makeRefPointDef('h3-cell-a', 'Bench', [obs]);

      const zip1 = await createTestZipBlob([def1]);
      const zip2 = await createTestZipBlob([def2]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-1-final.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      // Only one observation despite appearing in two ZIPs
      expect(result.definitions[0].observations).toHaveLength(1);
    });

    /**
     * Why this test matters:
     * ZIPs without refPoints/ should not cause errors — many session ZIPs
     * from before the Problem 3 fix have no ref points.
     */
    it('should handle ZIP without refPoints folder gracefully', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('old-session.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toEqual([]);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.errors).toEqual([]);
    });

    /**
     * Why this test matters:
     * Malformed JSON should be reported but not block recovery of other
     * ref points from the same or other ZIPs.
     */
    it('should log error for malformed JSON and continue', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      // ZIP with one valid and one malformed ref point
      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      await zipWriter.add(
        'refPoints/bad.json',
        new TextReader('{ invalid json }')
      );
      const validDef = makeRefPointDef('good-point', 'Good', [
        makeObservation('session-1', 1000),
      ]);
      await zipWriter.add(
        'refPoints/good-point.json',
        new TextReader(JSON.stringify(validDef))
      );
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('good-point');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('bad.json');
    });

    /**
     * Why this test matters:
     * Corrupt ZIPs should not block recovery from other valid ZIPs
     * in the same folder.
     */
    it('should continue after corrupt ZIP', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const validDef = makeRefPointDef('point-b', 'Point B', [
        makeObservation('session-2', 2000),
      ]);
      const validZip = await createTestZipBlob([validDef]);
      const corruptZip = new Blob(['not a zip'], {
        type: 'application/zip',
      });

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('corrupt.zip', corruptZip),
        createMockFileEntry('valid.zip', validZip),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('point-b');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    /**
     * Why this test matters:
     * Non-ZIP files in the folder should be silently ignored.
     */
    it('should ignore non-ZIP files', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const folderHandle = createMockFolderHandle([
        {
          name: 'readme.txt',
          kind: 'file',
          getFile: () => Promise.resolve(new File(['text'], 'readme.txt')),
        },
        { name: 'subfolder', kind: 'directory' },
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toEqual([]);
      expect(result.zipFilesScanned).toBe(0);
    });

    /**
     * Why this test matters:
     * Empty observations is technically valid per the schema but has no
     * useful data for recovery. The definition should still be included
     * (it preserves the ref point identity and name).
     */
    it('should include ref points with empty observations array', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const def: RefPointDefinition = {
        id: 'empty-obs',
        name: 'Empty Point',
        createdAt: Date.now(),
        observations: [],
      };
      const zipBlob = await createTestZipBlob([def]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      // Empty-obs ref points are included (schema-valid, preserves identity)
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('empty-obs');
      expect(result.definitions[0].observations).toHaveLength(0);
    });

    /**
     * Why this test matters:
     * When 3+ ZIPs contribute observations for the same ref point (some
     * with duplicates), deduplication must be correct across all merges —
     * not just the first pair. This catches regressions in the seen-set
     * lifecycle (e.g., recreating it from scratch on every merge).
     */
    it('should deduplicate correctly across 3+ ZIPs for the same ref point', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const obsA = makeObservation('session-1', 1000, 50.1, 8.1);
      const obsB = makeObservation('session-2', 2000, 50.2, 8.2);
      const obsC = makeObservation('session-3', 3000, 50.3, 8.3);

      // ZIP 1: obsA
      const def1 = makeRefPointDef('h3-cell-x', 'Lamp', [obsA]);
      // ZIP 2: obsA (duplicate) + obsB (new)
      const def2 = makeRefPointDef('h3-cell-x', 'Lamp', [obsA, obsB]);
      // ZIP 3: obsB (duplicate) + obsC (new)
      const def3 = makeRefPointDef('h3-cell-x', 'Lamp', [obsB, obsC]);

      const zip1 = await createTestZipBlob([def1]);
      const zip2 = await createTestZipBlob([def2]);
      const zip3 = await createTestZipBlob([def3]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zip1),
        createMockFileEntry('session-2.zip', zip2),
        createMockFileEntry('session-3.zip', zip3),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(1);
      // Exactly 3 unique observations despite 6 total across ZIPs
      expect(result.definitions[0].observations).toHaveLength(3);
      const sessionIds = result.definitions[0].observations
        .map((o) => o.sessionId)
        .sort();
      expect(sessionIds).toEqual(['session-1', 'session-2', 'session-3']);
      expect(result.zipFilesScanned).toBe(3);
    });

    /**
     * Why this test matters:
     * folderHandle.values() already yields FileSystemFileHandle objects.
     * After the `kind === 'file'` guard the entry IS a FileSystemFileHandle,
     * so calling folderHandle.getFileHandle(entry.name) is a redundant
     * directory lookup. This test asserts the implementation uses the
     * iterator entry directly rather than re-resolving through getFileHandle.
     */
    it('should use iterator entry directly without calling getFileHandle', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const def = makeRefPointDef('direct-entry', 'DirectEntry', [
        makeObservation('session-1', 1000),
      ]);
      const zipBlob = await createTestZipBlob([def]);
      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zipBlob),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      // Recovery should succeed
      expect(result.definitions).toHaveLength(1);
      expect(result.definitions[0].id).toBe('direct-entry');
      // getFileHandle should NOT have been called — entry is used directly
      expect(folderHandle.getFileHandle).not.toHaveBeenCalled();
    });

    /**
     * Why this test matters:
     * Sorting by createdAt provides deterministic output order for tests
     * and consistent display in the UI.
     */
    it('should sort merged definitions by createdAt', async () => {
      const { recoverRefPointDefinitionsFromZips } =
        await import('./ref-point-recovery');

      const defOlder = makeRefPointDef('cell-older', 'Older', [
        makeObservation('session-1', 1000),
      ]);
      const defNewer = makeRefPointDef('cell-newer', 'Newer', [
        makeObservation('session-2', 5000),
      ]);

      // Newer ZIP processed first, but older ref point should come first
      const zip1 = await createTestZipBlob([defNewer]);
      const zip2 = await createTestZipBlob([defOlder]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('newer-session.zip', zip1),
        createMockFileEntry('older-session.zip', zip2),
      ]);

      const result = await recoverRefPointDefinitionsFromZips(folderHandle);

      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].id).toBe('cell-older');
      expect(result.definitions[1].id).toBe('cell-newer');
    });
  });
});
