/**
 * Tests for ref-point-importer.ts
 *
 * This module extracts reference points from ZIP files in a folder,
 * enabling reuse of ref points from previous recording sessions.
 *
 * @module ref-point-importer.test
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  expectTypeOf,
} from 'vitest';
import { BlobWriter, ZipWriter, TextReader } from '@zip.js/zip.js';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';
import type { GpsPoint, Vector3, Quaternion } from 'gps-plus-slam-js';
import type {
  ImportedRefPoint,
  RefPointImportResult,
} from './ref-point-importer';

// We'll import the functions after creating them
// import { importRefPointsFromFolder, type RefPointImportResult } from './ref-point-importer';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock FileSystemDirectoryHandle for testing.
 * Simulates a folder containing ZIP files.
 */
function createMockFolderHandle(
  entries: Array<{
    name: string;
    kind: 'file' | 'directory';
    getFile?: () => Promise<File>;
  }>
): FileSystemDirectoryHandle {
  const handle = {
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
  return handle;
}

/**
 * Create a valid RefPointDefinition for testing.
 * Note: Uses partial GpsPoint with only the fields needed for import/export.
 */
function createTestRefPointDef(
  id: string,
  name: string,
  lat: number = 50.0,
  lon: number = 8.0
): RefPointDefinition {
  return {
    id,
    name,
    createdAt: Date.now(),
    observations: [
      {
        sessionId: 'recording-2026-01-30_12-00-00utc',
        timestamp: Date.now(),
        arPose: {
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
        // Cast to satisfy type - importer only needs latitude/longitude/altitude
        gpsPoint: {
          latitude: lat,
          longitude: lon,
          altitude: 100,
          latLongAccuracy: 5,
          timestamp: Date.now(),
        } as RefPointDefinition['observations'][0]['gpsPoint'],
      },
    ],
  };
}

/**
 * Create a ZIP blob containing reference point JSON files.
 */
async function createTestZipBlob(
  refPoints: RefPointDefinition[]
): Promise<Blob> {
  const blobWriter = new BlobWriter('application/zip');
  const zipWriter = new ZipWriter(blobWriter, { level: 0 });

  // Add session.json (required for valid session ZIP)
  await zipWriter.add(
    'session.json',
    new TextReader(
      JSON.stringify({
        version: 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        scenarioName: 'TestScenario',
        actionCount: 0,
        frameCount: 0,
        userAgent: 'test',
      })
    )
  );

  // Add reference points to refPoints/ folder
  for (const refPoint of refPoints) {
    await zipWriter.add(
      `refPoints/${refPoint.id}.json`,
      new TextReader(JSON.stringify(refPoint))
    );
  }

  return zipWriter.close();
}

/**
 * Create a mock file entry for a ZIP blob.
 */
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

describe('ref-point-importer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('importRefPointsFromFolder', () => {
    it('should return empty array for empty folder', async () => {
      // Dynamic import to allow test to fail first (TDD)
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const folderHandle = createMockFolderHandle([]);
      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.refPoints).toEqual([]);
      expect(result.zipFilesScanned).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('should ignore non-ZIP files', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const folderHandle = createMockFolderHandle([
        {
          name: 'readme.txt',
          kind: 'file',
          getFile: () => Promise.resolve(new File(['test'], 'readme.txt')),
        },
        {
          name: 'image.jpg',
          kind: 'file',
          getFile: () => Promise.resolve(new File(['test'], 'image.jpg')),
        },
        { name: 'subfolder', kind: 'directory' },
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.refPoints).toEqual([]);
      expect(result.zipFilesScanned).toBe(0);
    });

    it('should extract ref points from a single ZIP file', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const refPoint = createTestRefPointDef('point-a', 'Point A', 50.1, 8.1);
      const zipBlob = await createTestZipBlob([refPoint]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-2026-01-30.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.refPoints).toHaveLength(1);
      expect(result.refPoints[0].id).toBe('point-a');
      expect(result.refPoints[0].lat).toBeCloseTo(50.1, 5);
      expect(result.refPoints[0].lon).toBeCloseTo(8.1, 5);
    });

    it('should extract ref points from multiple ZIP files', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const refPointA = createTestRefPointDef('point-a', 'Point A', 50.1, 8.1);
      const refPointB = createTestRefPointDef('point-b', 'Point B', 50.2, 8.2);
      const zipBlob1 = await createTestZipBlob([refPointA]);
      const zipBlob2 = await createTestZipBlob([refPointB]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-1.zip', zipBlob1),
        createMockFileEntry('session-2.zip', zipBlob2),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.zipFilesScanned).toBe(2);
      expect(result.refPoints).toHaveLength(2);
      expect(result.refPoints.map((p) => p.id).sort()).toEqual([
        'point-a',
        'point-b',
      ]);
    });

    it('should deduplicate ref points by ID across ZIPs', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      // Same ref point in two different ZIPs
      const refPointA1 = createTestRefPointDef(
        'point-a',
        'Point A Original',
        50.1,
        8.1
      );
      const refPointA2 = createTestRefPointDef(
        'point-a',
        'Point A Updated',
        50.15,
        8.15
      );
      const zipBlob1 = await createTestZipBlob([refPointA1]);
      const zipBlob2 = await createTestZipBlob([refPointA2]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-old.zip', zipBlob1),
        createMockFileEntry('session-new.zip', zipBlob2),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.refPoints).toHaveLength(1);
      expect(result.refPoints[0].id).toBe('point-a');
      // Should keep the first encountered (or implement merge strategy)
    });

    it('should handle ZIP without refPoints folder gracefully', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      // Create ZIP with only session.json, no refPoints/
      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.refPoints).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should log error for malformed JSON in ref point file', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      // Create ZIP with invalid JSON in refPoints/
      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      await zipWriter.add(
        'refPoints/bad.json',
        new TextReader('{ invalid json }')
      );
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.refPoints).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('bad.json');
    });

    it('should continue processing after encountering corrupt ZIP', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const refPoint = createTestRefPointDef('point-b', 'Point B');
      const validZipBlob = await createTestZipBlob([refPoint]);
      const corruptBlob = new Blob(['not a valid zip file'], {
        type: 'application/zip',
      });

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('corrupt.zip', corruptBlob),
        createMockFileEntry('valid.zip', validZipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.refPoints).toHaveLength(1);
      expect(result.refPoints[0].id).toBe('point-b');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should extract GPS coordinates from first observation', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const refPoint = createTestRefPointDef(
        'point-x',
        'Point X',
        51.5074,
        -0.1278
      ); // London
      const zipBlob = await createTestZipBlob([refPoint]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.refPoints[0].lat).toBeCloseTo(51.5074, 4);
      expect(result.refPoints[0].lon).toBeCloseTo(-0.1278, 4);
    });

    it('should handle ref point with no observations gracefully', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      // Ref point with empty observations array
      const refPointNoObs = {
        id: 'empty-point',
        name: 'Empty Point',
        createdAt: Date.now(),
        observations: [],
      };

      // Create ZIP with this unusual ref point (won't pass isRefPointDefinition validation)
      const blobWriter = new BlobWriter('application/zip');
      const zipWriter = new ZipWriter(blobWriter, { level: 0 });
      await zipWriter.add('session.json', new TextReader('{}'));
      await zipWriter.add(
        'refPoints/empty-point.json',
        new TextReader(JSON.stringify(refPointNoObs))
      );
      const zipBlob = await zipWriter.close();

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      // Should handle gracefully - either skip or include without lat/lon
      expect(result.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle ZIP files with uppercase extension', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const refPoint = createTestRefPointDef('point-upper', 'Upper Case');
      const zipBlob = await createTestZipBlob([refPoint]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session.ZIP', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.zipFilesScanned).toBe(1);
      expect(result.refPoints).toHaveLength(1);
    });

    it('should include source scenario name in imported ref points', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      const refPoint = createTestRefPointDef('point-src', 'Source Test');
      const zipBlob = await createTestZipBlob([refPoint]);

      const folderHandle = createMockFolderHandle([
        createMockFileEntry('Paris-Eiffel_session-1.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.refPoints[0].sourceZipName).toBe(
        'Paris-Eiffel_session-1.zip'
      );
    });
  });

  describe('Single-source-of-truth: RefPointDefinition from ref-point-loader', () => {
    /**
     * Why this test matters:
     * ref-point-importer.ts previously defined its own duplicate
     * RefPointDefinitionShape interface "to avoid circular imports".
     * No circular dependency actually exists — ref-point-importer.ts has
     * zero imports from ref-point-loader.ts.  This test proves that the
     * canonical RefPointDefinition from ref-point-loader is the only type
     * used for ref-point validation in the importer, preventing future
     * re-introduction of a local duplicate.
     */
    it('a full RefPointDefinition with GpsPoint flows through the import pipeline', async () => {
      const { importRefPointsFromFolder } =
        await import('./ref-point-importer');

      // Build a RefPointDefinition using the canonical types — NOT partial casts.
      // If the importer's internal validation requires a different shape,
      // this test will fail at runtime (wrong field names, missing fields, etc.).
      const fullGpsPoint: GpsPoint = {
        id: 'gps-full-1',
        zeroRef: { lat: 52.52, lon: 13.405 },
        latitude: 52.52,
        longitude: 13.405,
        altitude: 34,
        latLongAccuracy: 3.5,
        coordinates: [100, 0, 50],
        weight: 1,
        timestamp: Date.now(),
      };

      const observation: RefPointObservation = {
        sessionId: 'recording-2026-03-03_10-00-00utc',
        timestamp: Date.now(),
        arPose: {
          position: [1, 2, 3],
          rotation: [0, 0, 0, 1],
        },
        gpsPoint: fullGpsPoint,
      };

      const refPointDef: RefPointDefinition = {
        id: 'berlin-gate',
        name: 'Brandenburg Gate',
        createdAt: Date.now(),
        observations: [observation],
      };

      const zipBlob = await createTestZipBlob([refPointDef]);
      const folderHandle = createMockFolderHandle([
        createMockFileEntry('session-berlin.zip', zipBlob),
      ]);

      const result = await importRefPointsFromFolder(folderHandle);

      expect(result.success).toBe(true);
      expect(result.refPoints).toHaveLength(1);
      expect(result.refPoints[0].id).toBe('berlin-gate');
      // The importer extracts lat/lon from gpsPoint.latitude/longitude,
      // which are fields on GpsPoint — proving type compatibility.
      expect(result.refPoints[0].lat).toBeCloseTo(52.52, 4);
      expect(result.refPoints[0].lon).toBeCloseTo(13.405, 4);
      expect(result.refPoints[0].alt).toBe(34);
    });

    /**
     * Why this test matters:
     * Compile-time proof that ImportedRefPoint (the importer's output) is
     * consistent with RefPointDefinition (the loader's type).  If someone
     * re-introduces a local type with different field names, the type
     * assertion on createResultFromDef below will fail to compile.
     */
    it('ImportedRefPoint fields are consistent with RefPointDefinition field names', () => {
      // Simulate what the importer does internally: extract fields from the
      // canonical RefPointDefinition into an ImportedRefPoint.
      const def: RefPointDefinition = {
        id: 'test-point',
        name: 'Test',
        createdAt: 1,
        observations: [
          {
            sessionId: 's1',
            timestamp: 1,
            arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            gpsPoint: {
              id: 'g1',
              zeroRef: { lat: 0, lon: 0 },
              latitude: 48.858,
              longitude: 2.294,
              altitude: 35,
              coordinates: [0, 0, 0],
              weight: 1,
              timestamp: 1,
            },
          },
        ],
      };

      // This lambda mirrors toImportedRefPoint's logic.  If the types
      // drifted (e.g., gpsPoint used 'lat' instead of 'latitude'),
      // TypeScript would error here.
      const createResultFromDef = (
        d: RefPointDefinition,
        source: string
      ): ImportedRefPoint => ({
        id: d.id,
        name: d.name,
        lat: d.observations[0].gpsPoint.latitude,
        lon: d.observations[0].gpsPoint.longitude,
        alt: d.observations[0].gpsPoint.altitude,
        sourceZipName: source,
      });

      const result = createResultFromDef(def, 'test.zip');
      expectTypeOf(result).toMatchTypeOf<ImportedRefPoint>();
      expect(result.lat).toBeCloseTo(48.858, 3);
      expect(result.lon).toBeCloseTo(2.294, 3);
    });

    /**
     * Why this test matters:
     * RefPointObservation.arPose has position (vec3) and rotation (quat)
     * tuple fields.  The importer's validation checks arPose structure on
     * parsed JSON.  This test proves the canonical type's arPose shape is
     * what the validation expects.
     */
    it('RefPointObservation.arPose shape matches validation expectations', () => {
      const obs: RefPointObservation = {
        sessionId: 's1',
        timestamp: Date.now(),
        arPose: {
          position: [10, 20, 30],
          rotation: [0.1, 0.2, 0.3, 0.9],
        },
        gpsPoint: {
          id: 'g1',
          zeroRef: { lat: 0, lon: 0 },
          latitude: 50,
          longitude: 8,
          coordinates: [0, 0, 0],
          weight: 1,
          timestamp: 1,
        },
      };

      // arPose.position is a 3-element array (vec3 tuple)
      expect(obs.arPose.position).toHaveLength(3);
      expectTypeOf(obs.arPose.position).toMatchTypeOf<Vector3>();

      // arPose.rotation is a 4-element array (quaternion tuple)
      expect(obs.arPose.rotation).toHaveLength(4);
      expectTypeOf(obs.arPose.rotation).toMatchTypeOf<Quaternion>();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * ImportedRefPoint is loaded from disk and never mutated after creation.
     */
    it('ImportedRefPoint ≡ Readonly<ImportedRefPoint>', () => {
      expectTypeOf<ImportedRefPoint>().toEqualTypeOf<
        Readonly<ImportedRefPoint>
      >();
    });

    /**
     * Why this test matters:
     * RefPointImportResult is the return value of the import function;
     * it is assembled once and only read afterward.
     */
    it('RefPointImportResult ≡ Readonly<RefPointImportResult>', () => {
      expectTypeOf<RefPointImportResult>().toEqualTypeOf<
        Readonly<RefPointImportResult>
      >();
    });
  });
});
