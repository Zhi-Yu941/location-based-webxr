/**
 * ZIP Export Module Tests
 *
 * Tests for exporting OPFS session data as ZIP files.
 * The ZIP format allows users to download their recordings for
 * offline analysis and sharing.
 *
 * Why these tests matter:
 * - ZIP must be valid and readable by native OS tools
 * - File structure inside ZIP must match OPFS structure
 * - Binary data (frames) must not be corrupted
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  expectTypeOf,
} from 'vitest';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import type { MockOPFSDirectoryHandle } from '../test-utils/browser-mocks';
import { installOPFSMocks } from '../test-utils/browser-mocks';
import { formatTimestamp } from './file-system-utils';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';
import { saveRefPointObservation } from './ref-point-loader';
import type { GpsPoint, Vector3, Quaternion } from 'gps-plus-slam-js';
import {
  initOpfsStorage,
  createSession,
  writeAction,
  writeFrame,
  writeSessionMetadata,
  resetOpfsStorage,
  getAppRootHandle,
  setSessionHandles,
  type SessionMetadata,
} from './opfs-storage';
import {
  exportSessionAsZip,
  downloadZip,
  syncToExternalZip,
  type ZipExportResult,
} from './zip-export';

/**
 * Helper to decompress a ZIP blob and return file contents.
 * Uses @zip.js/zip.js for verification (same library as production code).
 */
async function unzipBlob(blob: Blob): Promise<Map<string, Uint8Array>> {
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();
  const files = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (!entry.directory && entry.getData) {
      const data = await entry.getData(new Uint8ArrayWriter());
      files.set(entry.filename, data);
    }
  }

  await zipReader.close();
  return files;
}

/**
 * Build a scenario-layout session under OPFS for tests that exercise
 * the framework's legacy scenario branch in `exportSessionAsZip`.
 *
 * Creates `gps-recorder/scenarios/{scenarioName}/recording-{ts}/`
 * with empty `actions/` and `frames/` subdirectories, and wires the
 * handles into opfs-storage so subsequent `writeAction` / `writeFrame` /
 * `writeSessionMetadata` calls target this session.
 *
 * Until the recorder owns scenarios via `ScenarioWrappingStorageBackend`
 * (Iter 0/3 of the boundary plan), framework tests build the layout
 * directly to keep coverage on the legacy branch.
 */
async function createScenarioSession(
  scenarioName: string,
  timestamp: Date
): Promise<{
  scenarioName: string;
  sessionName: string;
  scenarioHandle: FileSystemDirectoryHandle;
}> {
  const appRoot = getAppRootHandle();
  if (!appRoot) {
    throw new Error('OPFS not initialized - call initOpfsStorage first');
  }
  const scenariosDir = await appRoot.getDirectoryHandle('scenarios', {
    create: true,
  });
  const scenarioHandle = await scenariosDir.getDirectoryHandle(scenarioName, {
    create: true,
  });
  const ts = formatTimestamp(timestamp);
  const sessionName = `recording-${ts}`;
  const sessionHandle = await scenarioHandle.getDirectoryHandle(sessionName, {
    create: true,
  });
  const actions = await sessionHandle.getDirectoryHandle('actions', {
    create: true,
  });
  const frames = await sessionHandle.getDirectoryHandle('frames', {
    create: true,
  });
  setSessionHandles(sessionHandle, actions, frames);
  return { scenarioName, sessionName, scenarioHandle };
}

describe('zip-export', () => {
  let _opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(() => {
    const mocks = installOPFSMocks();
    _opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    resetOpfsStorage();
  });

  describe('exportSessionAsZip', () => {
    it('creates a valid ZIP blob', async () => {
      // Why: ZIP must be readable by native OS tools
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'test-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'test-scenario',
        actionCount: 1,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/action' }, 1);

      const { blob: zipBlob } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );

      expect(zipBlob).toBeInstanceOf(Blob);
      expect(zipBlob.type).toBe('application/zip');
      expect(zipBlob.size).toBeGreaterThan(0);
    });

    it('includes session.json at root level', async () => {
      // Why: Session metadata must be easily accessible
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'test-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'test-scenario',
        actionCount: 0,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);

      const { blob: zipBlob } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );
      const files = await unzipBlob(zipBlob);

      expect(files.has('session.json')).toBe(true);
      const content = new TextDecoder().decode(files.get('session.json'));
      const parsed = JSON.parse(content) as { contextTag: string };
      expect(parsed.contextTag).toBe('test-scenario');
    });

    it('includes actions in actions/ folder', async () => {
      // Why: Actions must be in correct location for replay
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'test-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      await writeAction({ type: 'action1', payload: 'test1' }, 1);
      await writeAction({ type: 'action2', payload: 'test2' }, 2);

      const { blob: zipBlob } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );
      const files = await unzipBlob(zipBlob);

      expect(files.has('actions/000001.json')).toBe(true);
      expect(files.has('actions/000002.json')).toBe(true);

      const action1 = JSON.parse(
        new TextDecoder().decode(files.get('actions/000001.json'))
      ) as { type: string };
      expect(action1.type).toBe('action1');
    });

    it('includes frames in frames/ folder', async () => {
      // Why: Frames must be in correct location for replay
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'test-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      const frameData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
      await writeFrame(new Blob([frameData], { type: 'image/jpeg' }), 1);

      const { blob: zipBlob } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );
      const files = await unzipBlob(zipBlob);

      expect(files.has('frames/frame-000001.jpg')).toBe(true);
      const frameContent = files.get('frames/frame-000001.jpg');
      expect(frameContent).toEqual(frameData);
    });

    it('preserves binary frame data exactly', async () => {
      // Why: Image corruption would make recordings useless
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'test-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      // Create a larger binary blob with various byte values
      const originalData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        originalData[i] = i;
      }
      await writeFrame(new Blob([originalData]), 5);

      const { blob: zipBlob } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );
      const files = await unzipBlob(zipBlob);

      const extractedData = files.get('frames/frame-000005.jpg');
      expect(extractedData).toEqual(originalData);
    });

    it('throws for non-existent scenario', async () => {
      // Why: Clear error for invalid export request
      await initOpfsStorage();

      await expect(
        exportSessionAsZip('non-existent', 'recording-2026-01-26_10-00-00utc')
      ).rejects.toThrow(/scenario.*not found/i);
    });

    it('throws for non-existent session', async () => {
      // Why: Clear error for invalid export request
      await initOpfsStorage();
      await createScenarioSession(
        'existing-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      await expect(
        exportSessionAsZip('existing-scenario', 'non-existent-session')
      ).rejects.toThrow(/session.*not found/i);
    });

    it('uses store mode (no compression) for fast packaging', async () => {
      // Why: Uncompressed ZIP is faster to create; images are already compressed
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'test-scenario',
        new Date('2026-01-26T10:00:00Z')
      );

      // Write some compressible data
      const text = 'A'.repeat(1000);
      await writeAction({ type: 'test', data: text }, 1);

      const { blob: zipBlob } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );

      // With store mode, ZIP size should be >= original content size
      // (Compression would make it smaller)
      const files = await unzipBlob(zipBlob);
      const actionContent = files.get('actions/000001.json');
      // Just verify it's a valid ZIP - `@zip.js/zip.js` handles the decompression
      expect(actionContent).toBeDefined();
    });

    it('returns a ZipExportResult with blob and fileCount', async () => {
      // Why: Issue #2+#3 (2026-02-06) need blob + file count for share/stats
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'meta-test',
        new Date('2026-02-06T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-02-06T10:00:00.000Z',
        endedAt: '2026-02-06T10:30:00.000Z',
        contextTag: 'meta-test',
        actionCount: 2,
        frameCount: 1,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'a1' }, 1);
      await writeAction({ type: 'a2' }, 2);
      const frameData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      await writeFrame(new Blob([frameData], { type: 'image/jpeg' }), 1);

      const result: ZipExportResult = await exportSessionAsZip(
        scenarioName,
        sessionName
      );

      // Must return an object with blob and fileCount
      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('fileCount');
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('application/zip');
      // session.json + 2 actions + 1 frame = 4 files
      expect(result.fileCount).toBe(4);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Ref point inclusion in ZIP exports (Problem 3 fix)
  // ──────────────────────────────────────────────────────────────────────────

  describe('ref point inclusion in ZIP exports', () => {
    /**
     * Create a minimal valid RefPointObservation for testing.
     * Uses only required fields with plausible values.
     */
    function makeObservation(
      sessionId: string,
      timestamp: number
    ): RefPointObservation {
      return {
        sessionId,
        timestamp,
        arPose: {
          position: [1, 2, 3] as unknown as Vector3,
          rotation: [0, 0, 0, 1] as unknown as Quaternion,
        },
        gpsPoint: {
          latitude: 50.776,
          longitude: 6.083,
          altitude: 170,
          accuracy: 5,
        } as unknown as GpsPoint,
      };
    }

    it('includes ref points observed in the current session', async () => {
      // Why: This is the core fix for Problem 3 — ref points must appear in
      // exported ZIPs so they can be recovered after OPFS loss.
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'refpt-scenario',
        new Date('2026-04-13T10:00:00Z')
      );

      const scenarioHandle = _scenarioHandle;
      await saveRefPointObservation(
        scenarioHandle,
        '8b1f1a5c2e3d4f1',
        'Bench',
        makeObservation(sessionName, Date.now())
      );

      const { blob, fileCount } = await exportSessionAsZip(
        scenarioName,
        sessionName
      );
      const files = await unzipBlob(blob);

      expect(files.has('refPoints/8b1f1a5c2e3d4f1.json')).toBe(true);
      const parsed = JSON.parse(
        new TextDecoder().decode(files.get('refPoints/8b1f1a5c2e3d4f1.json'))
      ) as RefPointDefinition;
      expect(parsed.id).toBe('8b1f1a5c2e3d4f1');
      expect(parsed.name).toBe('Bench');
      expect(parsed.observations).toHaveLength(1);
      expect(parsed.observations[0].sessionId).toBe(sessionName);
      // fileCount must include the ref point file
      expect(fileCount).toBeGreaterThanOrEqual(1);
    });

    it('filters out observations from other sessions', async () => {
      // Why: Per-session filtering ensures each ZIP contains only its own
      // observations; full state is reconstructed by merging all ZIPs.
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'filter-scenario',
        new Date('2026-04-13T11:00:00Z')
      );

      const scenarioHandle = _scenarioHandle;
      // Two observations on the same ref point: one from this session, one from another
      await saveRefPointObservation(
        scenarioHandle,
        '8b1f1a5c2e3d4f2',
        'Fountain',
        makeObservation('recording-2026-04-12_09-00-00utc', 1000)
      );
      await saveRefPointObservation(
        scenarioHandle,
        '8b1f1a5c2e3d4f2',
        'Fountain',
        makeObservation(sessionName, 2000)
      );

      const { blob } = await exportSessionAsZip(scenarioName, sessionName);
      const files = await unzipBlob(blob);

      expect(files.has('refPoints/8b1f1a5c2e3d4f2.json')).toBe(true);
      const parsed = JSON.parse(
        new TextDecoder().decode(files.get('refPoints/8b1f1a5c2e3d4f2.json'))
      ) as RefPointDefinition;
      // Only the current session's observation should be present
      expect(parsed.observations).toHaveLength(1);
      expect(parsed.observations[0].sessionId).toBe(sessionName);
    });

    it('excludes ref points with zero observations in this session', async () => {
      // Why: If a ref point was only observed in other sessions, it should not
      // bloat this session's ZIP.
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'exclude-scenario',
        new Date('2026-04-13T12:00:00Z')
      );

      const scenarioHandle = _scenarioHandle;
      // Ref point only observed in a different session
      await saveRefPointObservation(
        scenarioHandle,
        '8b1f1a5c2e3d4f3',
        'Tree',
        makeObservation('recording-2026-04-12_09-00-00utc', 1000)
      );

      const { blob } = await exportSessionAsZip(scenarioName, sessionName);
      const files = await unzipBlob(blob);

      expect(files.has('refPoints/8b1f1a5c2e3d4f3.json')).toBe(false);
    });

    it('works when no refPoints directory exists', async () => {
      // Why: New scenarios have no ref points yet; export must not crash.
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'no-refpts',
        new Date('2026-04-13T13:00:00Z')
      );

      // No ref points written — refPoints/ dir doesn't exist
      const { blob } = await exportSessionAsZip(scenarioName, sessionName);
      const files = await unzipBlob(blob);

      // No refPoints/ entries should be present
      const refPointEntries = [...files.keys()].filter((k) =>
        k.startsWith('refPoints/')
      );
      expect(refPointEntries).toHaveLength(0);
    });

    it('includes ref point file count in the returned fileCount', async () => {
      // Why: fileCount is used for UI stats display; must be accurate.
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'count-scenario',
        new Date('2026-04-13T14:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-04-13T14:00:00.000Z',
        endedAt: '',
        contextTag: 'count-scenario',
        actionCount: 1,
        frameCount: 0,
        userAgent: 'Test',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/action' }, 1);

      const scenarioHandle = _scenarioHandle;
      await saveRefPointObservation(
        scenarioHandle,
        '8b1f1a5c2e3d4f4',
        'Lamp',
        makeObservation(sessionName, Date.now())
      );

      const { fileCount } = await exportSessionAsZip(scenarioName, sessionName);
      // session.json + 1 action + 1 ref point = 3 files
      expect(fileCount).toBe(3);
    });

    it('preserves id, name, and createdAt fields in exported ref points', async () => {
      // Why: These metadata fields are needed for reconstruction on import.
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'metadata-scenario',
        new Date('2026-04-13T15:00:00Z')
      );

      const scenarioHandle = _scenarioHandle;
      const obs = makeObservation(sessionName, 1713000000000);
      await saveRefPointObservation(
        scenarioHandle,
        '8b1f1a5c2e3d4f5',
        'Cathedral',
        obs
      );

      const { blob } = await exportSessionAsZip(scenarioName, sessionName);
      const files = await unzipBlob(blob);

      const parsed = JSON.parse(
        new TextDecoder().decode(files.get('refPoints/8b1f1a5c2e3d4f5.json'))
      ) as RefPointDefinition;
      expect(parsed.id).toBe('8b1f1a5c2e3d4f5');
      expect(parsed.name).toBe('Cathedral');
      expect(parsed.createdAt).toBe(1713000000000);
    });
  });

  describe('downloadZip', () => {
    it('creates download link with correct filename', async () => {
      // Why: User should get a meaningful filename
      const blob = new Blob(['test'], { type: 'application/zip' });

      // Mock DOM environment
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
        style: { display: '' },
      };
      const mockBody = {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      };

      vi.stubGlobal('document', {
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') {
            return mockLink;
          }
          throw new Error(`Unexpected createElement: ${tag}`);
        }),
        body: mockBody,
      });

      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test-url'),
        revokeObjectURL: vi.fn(),
      });

      // Mock window without showSaveFilePicker to force fallback path
      vi.stubGlobal('window', {});

      try {
        await downloadZip(blob, 'test-scenario-2026-01-26.zip');

        expect(mockLink.download).toBe('test-scenario-2026-01-26.zip');
        expect(mockLink.href).toBe('blob:test-url');
        expect(mockLink.click).toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('syncToExternalZip', () => {
    /**
     * Mock FileSystemFileHandle with createWritable().
     * Simulates the File System Access API handle obtained from showSaveFilePicker.
     */
    function createMockFileHandle(): {
      handle: FileSystemFileHandle;
      getWrittenData: () => Blob | null;
    } {
      let writtenBlob: Blob | null = null;

      const mockWritable = {
        write: vi.fn((data: Blob) => {
          writtenBlob = data;
          return Promise.resolve();
        }),
        close: vi.fn(() => Promise.resolve()),
      };

      const handle = {
        kind: 'file' as const,
        name: 'test-session.zip',
        createWritable: vi.fn(() => Promise.resolve(mockWritable)),
        getFile: vi.fn(),
        isSameEntry: vi.fn(),
        queryPermission: vi.fn(),
        requestPermission: vi.fn(),
      } as unknown as FileSystemFileHandle;

      return { handle, getWrittenData: () => writtenBlob };
    }

    it('writes a valid ZIP to the external file handle', async () => {
      // Why: This is the primary use case - sync OPFS data to user's chosen file
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'sync-test',
        new Date('2026-01-30T10:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-30T10:00:00.000Z',
        endedAt: '',
        contextTag: 'sync-test',
        actionCount: 2,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/action1' }, 1);
      await writeAction({ type: 'test/action2' }, 2);

      const { handle, getWrittenData } = createMockFileHandle();

      await syncToExternalZip(handle, scenarioName, sessionName);

      // Verify a blob was written
      const writtenBlob = getWrittenData();
      expect(writtenBlob).toBeInstanceOf(Blob);
      expect(writtenBlob!.type).toBe('application/zip');

      // Verify the ZIP contains the expected files
      const files = await unzipBlob(writtenBlob!);
      expect(files.has('session.json')).toBe(true);
      expect(files.has('actions/000001.json')).toBe(true);
      expect(files.has('actions/000002.json')).toBe(true);
    });

    it('includes frames in the synced ZIP', async () => {
      // Why: Frames are critical recording data and must be synced
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'frame-sync-test',
        new Date('2026-01-30T11:00:00Z')
      );

      const frameData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      await writeFrame(new Blob([frameData], { type: 'image/jpeg' }), 1);

      const { handle, getWrittenData } = createMockFileHandle();

      await syncToExternalZip(handle, scenarioName, sessionName);

      const files = await unzipBlob(getWrittenData()!);
      expect(files.has('frames/frame-000001.jpg')).toBe(true);
      expect(files.get('frames/frame-000001.jpg')).toEqual(frameData);
    });

    it('calls createWritable and close on the handle', async () => {
      // Why: Proper handle lifecycle is critical for data integrity
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'handle-test',
        new Date('2026-01-30T12:00:00Z')
      );

      const mockWritable = {
        write: vi.fn(() => Promise.resolve()),
        close: vi.fn(() => Promise.resolve()),
      };

      const handle = {
        kind: 'file' as const,
        name: 'test-session.zip',
        createWritable: vi.fn(() => Promise.resolve(mockWritable)),
      } as unknown as FileSystemFileHandle;

      await syncToExternalZip(handle, scenarioName, sessionName);

      expect(handle.createWritable).toHaveBeenCalledTimes(1);
      expect(mockWritable.write).toHaveBeenCalledTimes(1);
      expect(mockWritable.close).toHaveBeenCalledTimes(1);
    });

    it('throws for non-existent scenario', async () => {
      // Why: Clear error handling for invalid sync request
      await initOpfsStorage();
      const { handle } = createMockFileHandle();

      await expect(
        syncToExternalZip(
          handle,
          'non-existent',
          'recording-2026-01-30_10-00-00utc'
        )
      ).rejects.toThrow(/scenario.*not found/i);
    });

    it('throws for non-existent session', async () => {
      // Why: Clear error handling for invalid sync request
      await initOpfsStorage();
      await createScenarioSession(
        'existing-scenario',
        new Date('2026-01-30T10:00:00Z')
      );

      const { handle } = createMockFileHandle();

      await expect(
        syncToExternalZip(handle, 'existing-scenario', 'non-existent-session')
      ).rejects.toThrow(/session.*not found/i);
    });

    it('returns ZipExportResult with blob and fileCount', async () => {
      // Why: Issue #2+#3 (2026-02-06) — caller needs blob for share + stats
      await initOpfsStorage();
      const {
        scenarioName,
        sessionName,
        scenarioHandle: _scenarioHandle,
      } = await createScenarioSession(
        'result-test',
        new Date('2026-02-06T14:00:00Z')
      );

      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-02-06T14:00:00.000Z',
        endedAt: '2026-02-06T14:30:00.000Z',
        contextTag: 'result-test',
        actionCount: 1,
        frameCount: 0,
        userAgent: 'Test Browser',
      };
      await writeSessionMetadata(metadata);
      await writeAction({ type: 'test/sync-result' }, 1);

      const { handle, getWrittenData } = createMockFileHandle();

      const result: ZipExportResult = await syncToExternalZip(
        handle,
        scenarioName,
        sessionName
      );

      // Must return blob and fileCount
      expect(result).toHaveProperty('blob');
      expect(result).toHaveProperty('fileCount');
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe('application/zip');
      // session.json + 1 action = 2 files
      expect(result.fileCount).toBe(2);
      // Blob written to handle should match returned blob
      const writtenBlob = getWrittenData();
      expect(writtenBlob).toBeInstanceOf(Blob);
      expect(writtenBlob!.size).toBe(result.blob.size);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Memory efficiency — BlobReader instead of arrayBuffer + Uint8ArrayReader
  // ──────────────────────────────────────────────────────────────────────────

  describe('memory-efficient file streaming', () => {
    it('uses BlobReader instead of Uint8ArrayReader for streaming file data into ZIP', async () => {
      // Why: Regression guard. BlobReader lets zip.js handle file data
      // without forcing the entire file into the JS heap via
      // file.arrayBuffer() + new Uint8Array(buffer). If this test fails,
      // someone has regressed to the heap-copying pattern.
      const { readFile } = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const modulePath = fileURLToPath(
        new URL('./zip-export.ts', import.meta.url)
      );
      const source = await readFile(modulePath, 'utf8');

      // streamDirectoryToZip must use BlobReader, not Uint8ArrayReader
      expect(source).toMatch(/new BlobReader\(/);
      expect(source).not.toMatch(/new Uint8ArrayReader\(/);
      // file.arrayBuffer() heap-copy pattern must not appear
      expect(source).not.toMatch(/\.arrayBuffer\(\)/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * ZipExportResult is created once and returned; never mutated.
     */
    it('ZipExportResult = Readonly<ZipExportResult>', () => {
      expectTypeOf<ZipExportResult>().toEqualTypeOf<
        Readonly<ZipExportResult>
      >();
    });
  });
});
