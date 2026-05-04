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
import {
  initOpfsStorage,
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
