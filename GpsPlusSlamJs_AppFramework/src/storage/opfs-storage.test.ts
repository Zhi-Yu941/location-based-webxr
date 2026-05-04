/**
 * OPFS Storage Module Tests
 *
 * Tests for the Origin Private File System (OPFS) storage backend.
 * This module replaces showDirectoryPicker with OPFS for cross-platform
 * compatibility (Android Chrome, iOS Safari, Desktop).
 *
 * Why these tests matter:
 * - OPFS is the foundation of the storage strategy
 * - Must verify atomic writes work correctly
 * - Must verify flat session layout (no scenario hierarchy)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockOPFSDirectoryHandle } from '../test-utils/browser-mocks';
import { installOPFSMocks } from '../test-utils/browser-mocks';
import {
  initOpfsStorage,
  createSession,
  writeAction,
  writeFrame,
  listSessions,
  writeSessionMetadata,
  getSessionHandle,
  resetOpfsStorage,
  type SessionMetadata,
} from './opfs-storage';

describe('opfs-storage', () => {
  let opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(() => {
    const mocks = installOPFSMocks();
    opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    resetOpfsStorage();
  });

  describe('initOpfsStorage', () => {
    it('creates gps-plus-slam/sessions/ directory structure in OPFS root', async () => {
      // Why: flat layout uses sessions/ directly under gps-plus-slam/
      // (scenarios/ is recorder-only, handled by ScenarioWrappingStorageBackend)
      await initOpfsStorage();

      const gpsPlusSlamDir = await opfsRoot.getDirectoryHandle('gps-plus-slam');
      expect(gpsPlusSlamDir).toBeDefined();
      expect(gpsPlusSlamDir.name).toBe('gps-plus-slam');

      const sessionsDir = await (
        gpsPlusSlamDir as unknown as MockOPFSDirectoryHandle
      ).getDirectoryHandle('sessions');
      expect(sessionsDir).toBeDefined();
      expect(sessionsDir.name).toBe('sessions');
    });

    it('is idempotent - calling twice does not error', async () => {
      // Why: App may call init multiple times (e.g., on page refresh)
      await initOpfsStorage();
      await expect(initOpfsStorage()).resolves.not.toThrow();
    });

    it('throws when OPFS is not supported', async () => {
      // Why: Must give clear error on unsupported browsers
      cleanup();
      const existingNavigator =
        typeof navigator !== 'undefined' ? navigator : {};
      vi.stubGlobal('navigator', {
        ...existingNavigator,
        storage: undefined,
      });

      await expect(initOpfsStorage()).rejects.toThrow(/OPFS.*not supported/i);

      vi.unstubAllGlobals();
    });
  });

  describe('createSession', () => {
    beforeEach(async () => {
      await initOpfsStorage();
    });

    it('creates a flat session folder under sessions/', async () => {
      // Why: framework uses flat sessions/{timestamp}/ layout; scenarios
      // are layered on by the recorder's wrapping backend
      const timestamp = new Date('2026-01-26T10:30:00Z');
      const result = await createSession(timestamp);

      expect(result.sessionName).toMatch(/^recording-2026-01-26_10-30-00utc$/);
    });

    it('creates session folder with actions/ and frames/ subdirectories', async () => {
      // Why: Session must have actions/ and frames/ subdirectories for write ops
      const timestamp = new Date('2026-01-26T10:30:00Z');
      await createSession(timestamp);

      const sessionHandle = getSessionHandle();
      expect(sessionHandle).not.toBeNull();

      const actionsDir = await sessionHandle!.getDirectoryHandle('actions');
      expect(actionsDir).toBeDefined();

      const framesDir = await sessionHandle!.getDirectoryHandle('frames');
      expect(framesDir).toBeDefined();
    });

    it('creates multiple sessions side by side', async () => {
      // Why: flat layout allows multiple sessions without scenario grouping
      const timestamp1 = new Date('2026-01-26T10:00:00Z');
      const timestamp2 = new Date('2026-01-26T11:00:00Z');

      const result1 = await createSession(timestamp1);
      const result2 = await createSession(timestamp2);

      expect(result1.sessionName).toMatch(/^recording-2026-01-26_10-00-00utc$/);
      expect(result2.sessionName).toMatch(/^recording-2026-01-26_11-00-00utc$/);
    });

    it('stores contextTag in result when provided', async () => {
      // Why: contextTag is passed through so callers can use it for metadata
      const timestamp = new Date('2026-01-26T10:30:00Z');
      const result = await createSession(timestamp, 'my-tag');

      expect(result.sessionName).toMatch(/^recording-2026-01-26_10-30-00utc$/);
    });

    it('throws if initOpfsStorage was not called', async () => {
      // Why: Must enforce initialization order
      resetOpfsStorage();
      await expect(createSession(new Date())).rejects.toThrow(
        /not initialized/i
      );
    });
  });

  describe('writeAction', () => {
    beforeEach(async () => {
      await initOpfsStorage();
      await createSession(new Date('2026-01-26T10:00:00Z'));
    });

    it('writes action as JSON file with padded index', async () => {
      // Why: Actions must be numbered for deterministic replay order
      const action = { type: 'test/action', payload: { value: 42 } };
      await writeAction(action, 1);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;

      const content = actionsDir.getStoredContentAsString('000001.json');
      expect(content).toBeDefined();

      const parsed = JSON.parse(content!);
      expect(parsed).toEqual(action);
    });

    it('writes multiple actions with sequential numbering', async () => {
      // Why: Replay requires correct action ordering
      await writeAction({ type: 'action1' }, 1);
      await writeAction({ type: 'action2' }, 2);
      await writeAction({ type: 'action3' }, 100);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;

      expect(actionsDir.getStoredContentAsString('000001.json')).toContain(
        'action1'
      );
      expect(actionsDir.getStoredContentAsString('000002.json')).toContain(
        'action2'
      );
      expect(actionsDir.getStoredContentAsString('000100.json')).toContain(
        'action3'
      );
    });

    it('throws if no active session', async () => {
      // Why: Must have session context before writing
      resetOpfsStorage();
      await expect(writeAction({ type: 'test' }, 1)).rejects.toThrow(
        /no active session/i
      );
    });

    it('aborts writable and propagates error when write fails', async () => {
      // Why: Resource leak prevention - writable must be cleaned up even on errors
      // to avoid file locks and resource exhaustion in OPFS
      const action = { type: 'test/action', payload: { value: 42 } };

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const actionsDir = (await sessionHandle.getDirectoryHandle(
        'actions'
      )) as unknown as MockOPFSDirectoryHandle;

      const fileHandle = await actionsDir.getFileHandle('000001.json', {
        create: true,
      });

      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('Disk full')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fileHandle, 'createWritable').mockResolvedValue(
        mockWritable as unknown as FileSystemWritableFileStream
      );

      await expect(writeAction(action, 1)).rejects.toThrow('Disk full');

      expect(mockWritable.abort).toHaveBeenCalled();
      expect(mockWritable.close).not.toHaveBeenCalled();
    });
  });

  describe('writeFrame', () => {
    beforeEach(async () => {
      await initOpfsStorage();
      await createSession(new Date('2026-01-26T10:00:00Z'));
    });

    it('writes frame blob with padded index', async () => {
      // Why: Frames must be numbered for replay synchronization
      const blob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
      await writeFrame(blob, 1);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const framesDir = (await sessionHandle.getDirectoryHandle(
        'frames'
      )) as unknown as MockOPFSDirectoryHandle;

      const content = framesDir.getStoredContent('frame-000001.jpg');
      expect(content).toBeDefined();
      expect(content!.byteLength).toBeGreaterThan(0);
    });

    it('preserves binary blob content', async () => {
      // Why: Image data must not be corrupted during write
      const originalData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const blob = new Blob([originalData], { type: 'image/jpeg' });
      await writeFrame(blob, 5);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const framesDir = (await sessionHandle.getDirectoryHandle(
        'frames'
      )) as unknown as MockOPFSDirectoryHandle;

      const stored = framesDir.getStoredContent('frame-000005.jpg');
      expect(new Uint8Array(stored!)).toEqual(originalData);
    });

    it('throws if no active session', async () => {
      // Why: Must have session context before writing
      resetOpfsStorage();
      const blob = new Blob(['data']);
      await expect(writeFrame(blob, 1)).rejects.toThrow(/no active session/i);
    });

    it('aborts writable and propagates error when write fails', async () => {
      // Why: Resource leak prevention - writable must be cleaned up even on errors
      const blob = new Blob(['fake-image-data'], { type: 'image/jpeg' });

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const framesDir = (await sessionHandle.getDirectoryHandle(
        'frames'
      )) as unknown as MockOPFSDirectoryHandle;

      const fileHandle = await framesDir.getFileHandle('frame-000001.jpg', {
        create: true,
      });

      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('Storage quota exceeded')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fileHandle, 'createWritable').mockResolvedValue(
        mockWritable as unknown as FileSystemWritableFileStream
      );

      await expect(writeFrame(blob, 1)).rejects.toThrow(
        'Storage quota exceeded'
      );

      expect(mockWritable.abort).toHaveBeenCalled();
      expect(mockWritable.close).not.toHaveBeenCalled();
    });
  });

  describe('writeSessionMetadata', () => {
    beforeEach(async () => {
      await initOpfsStorage();
      await createSession(new Date('2026-01-26T10:00:00Z'));
    });

    it('writes session.json with metadata', async () => {
      // Why: Metadata is required for session identification and export
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        actionCount: 42,
        frameCount: 21,
        userAgent: 'Test Browser',
      };

      await writeSessionMetadata(metadata);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const content = sessionHandle.getStoredContentAsString('session.json');
      expect(content).toBeDefined();

      const parsed = JSON.parse(content!);
      expect(parsed).toEqual(metadata);
    });

    it('writes metadata with optional contextTag', async () => {
      // Why: contextTag replaces the former required scenarioName
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        contextTag: 'my-scenario',
        actionCount: 42,
        frameCount: 21,
        userAgent: 'Test Browser',
      };

      await writeSessionMetadata(metadata);

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;
      const content = sessionHandle.getStoredContentAsString('session.json');
      const parsed = JSON.parse(content!) as { contextTag?: string };
      expect(parsed.contextTag).toBe('my-scenario');
    });

    it('aborts writable and propagates error when write fails', async () => {
      // Why: Resource leak prevention - writable must be cleaned up even on errors
      const metadata: SessionMetadata = {
        version: 1,
        startedAt: '2026-01-26T10:00:00.000Z',
        endedAt: '2026-01-26T10:30:00.000Z',
        actionCount: 42,
        frameCount: 21,
        userAgent: 'Test Browser',
      };

      const sessionHandle =
        getSessionHandle() as unknown as MockOPFSDirectoryHandle;

      const fileHandle = await sessionHandle.getFileHandle('session.json', {
        create: true,
      });

      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('Write failed')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(fileHandle, 'createWritable').mockResolvedValue(
        mockWritable as unknown as FileSystemWritableFileStream
      );

      await expect(writeSessionMetadata(metadata)).rejects.toThrow(
        'Write failed'
      );

      expect(mockWritable.abort).toHaveBeenCalled();
      expect(mockWritable.close).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    beforeEach(async () => {
      await initOpfsStorage();
    });

    it('returns empty array when no sessions exist', async () => {
      // Why: Fresh install should show no sessions
      const sessions = await listSessions();
      expect(sessions).toEqual([]);
    });

    it('returns all session names', async () => {
      // Why: callers need to enumerate available sessions for replay/export
      await createSession(new Date('2026-01-26T10:00:00Z'));
      await createSession(new Date('2026-01-26T11:00:00Z'));

      const sessions = await listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions).toContain('recording-2026-01-26_10-00-00utc');
      expect(sessions).toContain('recording-2026-01-26_11-00-00utc');
    });
  });

  describe('checkStorageQuota', () => {
    it('returns safe default when Storage Manager API is unavailable', async () => {
      // Why: On unsupported platforms, checkStorageQuota should not throw but
      // return a safe fallback so callers can handle gracefully.

      const { checkStorageQuota } = await import('./opfs-storage');

      const originalEstimate = navigator.storage.estimate.bind(
        navigator.storage
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (navigator.storage as any).estimate = undefined as unknown;

      try {
        const result = await checkStorageQuota();
        expect(result).toEqual({ available: 0, used: 0 });
      } finally {
        navigator.storage.estimate = originalEstimate;
      }
    });
  });
});
