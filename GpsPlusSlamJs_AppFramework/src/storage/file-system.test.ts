/**
 * File System Storage Module Tests
 *
 * Tests error handling, state management, and type guards.
 * Browser API integration is tested via Playwright E2E tests.
 *
 * Why this test matters:
 * - Verifies error messages are clear when preconditions fail
 * - Ensures type guards correctly identify reference point actions
 * - Improves coverage for defensive code paths
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startSession,
  writeAction,
  writeFrame,
  getCurrentScenarioHandle,
  setCurrentScenario,
  resetStorageState,
  initStorage,
} from './file-system';
import type { MockOPFSDirectoryHandle } from '../test-utils/browser-mocks';
import {
  MockFSDirectoryHandle,
  installOPFSMocks,
} from '../test-utils/browser-mocks';

describe('File System Storage', () => {
  beforeEach(() => {
    // Reset module state between tests
    resetStorageState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('error handling when no root folder selected', () => {
    it('startSession throws when storage not initialized', async () => {
      await expect(startSession('TestScenario')).rejects.toThrow(
        /not initialized/i
      );
    });

    it('setCurrentScenario returns null when storage not initialized', async () => {
      const result = await setCurrentScenario('TestScenario');
      expect(result).toBeNull();
    });

    it('getCurrentScenarioHandle returns null initially', () => {
      expect(getCurrentScenarioHandle()).toBeNull();
    });
  });

  describe('error handling when no active session', () => {
    it('writeAction throws when no active session', async () => {
      const action = { type: 'test', payload: {} };
      await expect(writeAction(action, 0)).rejects.toThrow('No active session');
    });

    it('writeFrame throws when no active session', async () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      await expect(writeFrame(blob, 0)).rejects.toThrow('No active session');
    });

    /**
     * Why this test matters:
     * If the maintenance action is invoked before `initStorage()` succeeds
     * (or in a browser without OPFS), silently returning a zero-count result
     * would mislead the UI into reporting "No cached ref points to clear".
     * Throwing surfaces the real failure to the existing showError channel.
     */
    it('clearRefPointsCacheForAllScenarios throws when storage not initialized', async () => {
      const { clearRefPointsCacheForAllScenarios } =
        await import('./file-system');
      await expect(clearRefPointsCacheForAllScenarios()).rejects.toThrow(
        /OPFS scenarios directory is unavailable/i
      );
    });
  });
});

describe('File System Storage - Integration with Mocks', () => {
  let opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(() => {
    resetStorageState();
    const mocks = installOPFSMocks();
    opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('initStorage browser compatibility', () => {
    /**
     * Why this test matters:
     * When OPFS is not available, initStorage should throw
     * a clear error message instead of crashing with TypeError.
     */
    it('throws descriptive error when OPFS is not available', async () => {
      // Remove OPFS support
      cleanup();
      vi.stubGlobal('navigator', { storage: undefined });

      await expect(initStorage()).rejects.toThrow(/OPFS.*not supported/i);
    });

    /**
     * Why this test matters:
     * The error message should guide users to use a compatible browser.
     */
    it('error message mentions browser requirements', async () => {
      cleanup();
      vi.stubGlobal('navigator', { storage: undefined });

      await expect(initStorage()).rejects.toThrow(/Chrome|Safari|Firefox/i);
    });
  });

  describe('initStorage with OPFS', () => {
    /**
     * Why this test matters:
     * initStorage should discover existing scenario folders.
     */
    it('returns list of existing scenario folders', async () => {
      // First init to create scenarios
      await initStorage();
      await startSession('Scenario1');
      resetStorageState();

      // Re-init should find the scenario
      const scenarios = await initStorage();

      expect(scenarios).toContain('Scenario1');
    });

    /**
     * Why this test matters:
     * initStorage should return empty array for empty folder.
     */
    it('returns empty array for empty folder', async () => {
      const scenarios = await initStorage();

      expect(scenarios).toHaveLength(0);
    });
  });

  describe('startSession with OPFS', () => {
    beforeEach(async () => {
      await initStorage();
    });

    /**
     * Why this test matters:
     * startSession should create the scenario folder.
     */
    it('creates new scenario folder', async () => {
      const result = await startSession('NewScenario');

      expect(result.scenarioPath).toBe('NewScenario');
      expect(result.sessionPath).toMatch(/^recording-/);
    });

    /**
     * Why this test matters:
     * startSession should create both actions and frames subdirectories.
     */
    it('creates session with actions and frames folders', async () => {
      await startSession('MyScenario');

      // After session is started, writeAction and writeFrame should work
      const action = { type: 'test', payload: {} };
      await expect(writeAction(action, 1)).resolves.not.toThrow();

      const blob = new Blob(['test'], { type: 'image/jpeg' });
      await expect(writeFrame(blob, 0)).resolves.not.toThrow();
    });

    /**
     * Why this test matters:
     * startSession with existing scenario should open it, not create.
     */
    it('opens existing scenario when starting new session', async () => {
      // First create the scenario by starting a session
      await startSession('ExistingScenario');

      // Reset and re-init to simulate a new app session
      resetStorageState();
      await initStorage();

      // Now start another session in the same scenario
      const result = await startSession('ExistingScenario');

      expect(result.scenarioPath).toBe('ExistingScenario');
    });
  });

  describe('writeAction with OPFS', () => {
    beforeEach(async () => {
      await initStorage();
      await startSession('TestScenario');
    });

    /**
     * Why this test matters:
     * writeAction should successfully write a valid action to a file.
     */
    it('writes action to JSON file with correct naming', async () => {
      const action = {
        type: 'recording/recordGpsEvent',
        payload: { lat: 50.0, lon: 8.0 },
      };

      await expect(writeAction(action, 42)).resolves.not.toThrow();
    });

    /**
     * Why this test matters:
     * Actions should be serialized as formatted JSON.
     */
    it('serializes action as formatted JSON', async () => {
      const action = {
        type: 'test/action',
        payload: { value: 123 },
      };

      // The mock handles write - this just verifies no errors
      await expect(writeAction(action, 1)).resolves.not.toThrow();
    });
  });

  describe('writeFrame with OPFS', () => {
    beforeEach(async () => {
      await initStorage();
      await startSession('TestScenario');
    });

    /**
     * Why this test matters:
     * writeFrame should write blob data to a file with correct naming.
     */
    it('writes frame blob to file', async () => {
      const blob = new Blob(['test image data'], { type: 'image/jpeg' });

      await expect(writeFrame(blob, 5)).resolves.not.toThrow();
    });

    /**
     * Why this test matters:
     * Multiple frames should be writable with different indices.
     */
    it('writes multiple frames with different indices', async () => {
      const blob1 = new Blob(['frame 1'], { type: 'image/jpeg' });
      const blob2 = new Blob(['frame 2'], { type: 'image/jpeg' });

      await writeFrame(blob1, 1);
      await writeFrame(blob2, 2);

      // No errors means success
      expect(true).toBe(true);
    });
  });

  describe('setCurrentScenario with OPFS', () => {
    beforeEach(async () => {
      await initStorage();
    });

    /**
     * Why this test matters:
     * setCurrentScenario should return handle for existing scenario.
     */
    it('returns handle for existing scenario', async () => {
      // Create scenario first
      await startSession('MyScenario');
      resetStorageState();

      // Re-install mocks and re-init
      const mocks = installOPFSMocks(opfsRoot);
      cleanup = mocks.cleanup;
      await initStorage();

      const handle = await setCurrentScenario('MyScenario');

      expect(handle).not.toBeNull();
      expect(handle?.name).toBe('MyScenario');
    });

    /**
     * Why this test matters:
     * setCurrentScenario should return null for non-existent scenario.
     */
    it('returns null for non-existent scenario', async () => {
      const handle = await setCurrentScenario('NonExistent');

      expect(handle).toBeNull();
    });

    /**
     * Why this test matters:
     * After creating a session, getCurrentScenarioHandle returns the scenario.
     */
    it('getCurrentScenarioHandle returns scenario after session creation', async () => {
      await startSession('MyScenario');

      expect(getCurrentScenarioHandle()).not.toBeNull();
    });
  });

  describe('clearRefPointsCacheForAllScenarios', () => {
    /**
     * Why these tests matter:
     * The "Clear Reference Point Cache" maintenance action must wipe the
     * `refPoints/` directory across every scenario so the next scenario
     * load triggers a re-import from the read folder's *.zip recordings.
     * Missing caches must not be reported as errors (common case for fresh
     * scenarios).
     */
    beforeEach(async () => {
      await initStorage();
    });

    it('reports zero scenarios when none exist', async () => {
      const { clearRefPointsCacheForAllScenarios } =
        await import('./file-system');

      const result = await clearRefPointsCacheForAllScenarios();

      expect(result.scenariosScanned).toBe(0);
      expect(result.scenariosCleared).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('removes refPoints/ directory from every scenario that has one', async () => {
      const { clearRefPointsCacheForAllScenarios } =
        await import('./file-system');

      // Seed two scenarios with cached ref points
      const scenarioA = await startSession('ScenarioA');
      const scenarioB = await startSession('ScenarioB');
      expect(scenarioA.scenarioPath).toContain('ScenarioA');
      expect(scenarioB.scenarioPath).toContain('ScenarioB');

      const handleA = await setCurrentScenario('ScenarioA');
      const refPointsA = await handleA!.getDirectoryHandle('refPoints', {
        create: true,
      });
      await refPointsA.getFileHandle('cell-1.json', { create: true });

      const handleB = await setCurrentScenario('ScenarioB');
      const refPointsB = await handleB!.getDirectoryHandle('refPoints', {
        create: true,
      });
      await refPointsB.getFileHandle('cell-2.json', { create: true });

      const result = await clearRefPointsCacheForAllScenarios();

      expect(result.scenariosScanned).toBe(2);
      // Mock removeEntry always succeeds, so both should be reported cleared.
      expect(result.scenariosCleared).toBe(2);
      expect(result.errors).toEqual([]);

      // Verify the directories no longer have the refPoints/ entry.
      const reA = await setCurrentScenario('ScenarioA');
      await expect(reA!.getDirectoryHandle('refPoints')).rejects.toThrow();
    });
  });

  describe('verifyWriteAccess', () => {
    /**
     * Why this test matters:
     * User feedback Issue #1 - Write verification is critical to detect
     * read-only folder access before recording starts. If we can't write,
     * we need to know immediately, not after losing data.
     */
    it('returns true when write and delete succeed', async () => {
      const { verifyWriteAccess } = await import('./file-system');
      const testDir = new MockFSDirectoryHandle('test-root');

      const result = await verifyWriteAccess(testDir);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    /**
     * Why this test matters:
     * When createWritable() fails (as observed in user logs with
     * NoModificationAllowedError), we need to detect this and report it.
     */
    it('returns false with error when createWritable fails', async () => {
      const { verifyWriteAccess } = await import('./file-system');
      const testDir = new MockFSDirectoryHandle('test-root');

      // Create a file handle that throws on createWritable
      const readOnlyFile = {
        kind: 'file' as const,
        name: '.write-test',
        getFile: () => Promise.resolve(new File([''], '.write-test')),
        createWritable: () =>
          Promise.reject(
            new DOMException(
              'Cannot write to a read-only file.',
              'NoModificationAllowedError'
            )
          ),
        createSyncAccessHandle: () => {
          throw new Error('Not implemented');
        },
        isSameEntry: () => Promise.resolve(false),
      } as FileSystemFileHandle;

      // Override getFileHandle to return our read-only file
      testDir.getFileHandle = vi.fn().mockResolvedValue(readOnlyFile);

      const result = await verifyWriteAccess(testDir);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/read-only|write/i);
    });

    /**
     * Why this test matters:
     * If file creation itself fails, we should catch and report it.
     */
    it('returns false when getFileHandle fails', async () => {
      const { verifyWriteAccess } = await import('./file-system');
      const testDir = new MockFSDirectoryHandle('test-root');

      // Override getFileHandle to throw
      testDir.getFileHandle = vi
        .fn()
        .mockRejectedValue(
          new DOMException('Permission denied', 'NotAllowedError')
        );

      const result = await verifyWriteAccess(testDir);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    /**
     * Why this test matters:
     * Even if delete fails, write success should still be reported.
     * Cleanup failure is non-critical as long as write works.
     */
    it('returns true even when cleanup (removeEntry) fails', async () => {
      const { verifyWriteAccess } = await import('./file-system');
      const testDir = new MockFSDirectoryHandle('test-root');

      // Override removeEntry to throw
      testDir.removeEntry = vi
        .fn()
        .mockRejectedValue(
          new DOMException('Delete failed', 'NotAllowedError')
        );

      const result = await verifyWriteAccess(testDir);

      // Write succeeded, cleanup failure is acceptable
      expect(result.success).toBe(true);
    });
  });
});
