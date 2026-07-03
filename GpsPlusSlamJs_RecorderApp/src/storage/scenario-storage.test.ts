/**
 * Scenario Storage Tests
 *
 * Covers the recorder-owned scenario directory layer that was carved out of the
 * framework's `storage/file-system.ts` in Iter 7 of the AppFramework /
 * RecorderApp boundary migration (see
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
 *
 * Why these tests matter:
 * - They pin the exact `scenarios/{name}/recording-{ts}/{actions,images}` OPFS
 *   layout the recorder depends on — the contract Iter 0 promised but never
 *   shipped. A regression here silently breaks every recorder ZIP export, which
 *   resolves sessions by that path.
 * - They prove the recorder can reproduce the scenario behaviour on top of the
 *   framework's *generic* OPFS primitives, so the framework never needs to know
 *   about scenarios (the whole point of the migration).
 * - They guard the cross-store invariant (module-level scenario state, not
 *   per-backend-instance) that Issue #12 relies on.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initStorage,
  startSession,
  setCurrentScenario,
  ensureScenarioDirectory,
  getCurrentScenarioHandle,
  clearRefPointsCacheForAllScenarios,
  resetForNewSession,
  resetScenarioStorage,
  ScenarioWrappingStorageBackend,
} from './scenario-storage';
import type { MockOPFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import { installOPFSMocks } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';

/** Navigate the mock OPFS tree, asserting each segment exists. */
async function resolvePath(
  root: MockOPFSDirectoryHandle,
  ...segments: string[]
): Promise<FileSystemDirectoryHandle> {
  let handle: FileSystemDirectoryHandle = root;
  for (const segment of segments) {
    handle = await handle.getDirectoryHandle(segment);
  }
  return handle;
}

describe('scenario-storage — error handling before init', () => {
  beforeEach(() => {
    resetScenarioStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('startSession throws when storage not initialized', async () => {
    await expect(startSession('TestScenario')).rejects.toThrow(
      /not initialized/i
    );
  });

  it('setCurrentScenario returns null when storage not initialized', async () => {
    expect(await setCurrentScenario('TestScenario')).toBeNull();
  });

  it('getCurrentScenarioHandle returns null initially', () => {
    expect(getCurrentScenarioHandle()).toBeNull();
  });

  it('clearRefPointsCacheForAllScenarios throws when storage not initialized', async () => {
    await expect(clearRefPointsCacheForAllScenarios()).rejects.toThrow(
      /OPFS scenarios directory is unavailable/i
    );
  });

  it('initStorage throws a descriptive error when OPFS is unavailable', async () => {
    vi.stubGlobal('navigator', { storage: undefined });
    await expect(initStorage()).rejects.toThrow(/OPFS.*not supported/i);
  });
});

describe('scenario-storage — with OPFS mocks', () => {
  let opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(() => {
    resetScenarioStorage();
    const mocks = installOPFSMocks();
    opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('initStorage returns an empty list for a fresh store', async () => {
    expect(await initStorage()).toHaveLength(0);
  });

  it('initStorage discovers existing scenario folders', async () => {
    await initStorage();
    await startSession('Scenario1');
    resetScenarioStorage();

    const scenarios = await initStorage();
    expect(scenarios).toContain('Scenario1');
  });

  it('startSession creates the scenarios/{name}/recording-{ts}/ layout', async () => {
    await initStorage();
    const result = await startSession('NewScenario');

    expect(result.scenarioPath).toBe('NewScenario');
    expect(result.sessionPath).toMatch(/^recording-/);

    // The session dir and its actions/images children must exist under
    // scenarios/{name}/ — the path ZIP export later resolves.
    await expect(
      resolvePath(
        opfsRoot,
        'gps-plus-slam',
        'scenarios',
        'NewScenario',
        result.sessionPath,
        'actions'
      )
    ).resolves.toBeDefined();
    await expect(
      resolvePath(
        opfsRoot,
        'gps-plus-slam',
        'scenarios',
        'NewScenario',
        result.sessionPath,
        'images'
      )
    ).resolves.toBeDefined();
  });

  it('getCurrentScenarioHandle returns the scenario after a session starts', async () => {
    await initStorage();
    await startSession('MyScenario');

    const handle = getCurrentScenarioHandle();
    expect(handle).not.toBeNull();
    expect(handle?.name).toBe('MyScenario');
  });

  it('setCurrentScenario returns a handle for an existing scenario', async () => {
    await initStorage();
    await startSession('MyScenario');
    resetForNewSession();

    const handle = await setCurrentScenario('MyScenario');
    expect(handle).not.toBeNull();
    expect(handle?.name).toBe('MyScenario');
  });

  it('setCurrentScenario returns null for a non-existent scenario', async () => {
    await initStorage();
    expect(await setCurrentScenario('NopeScenario')).toBeNull();
  });

  it('ensureScenarioDirectory creates a scenario directory on demand', async () => {
    await initStorage();
    const handle = await ensureScenarioDirectory('RecoveredScenario');
    expect(handle).not.toBeNull();
    expect(handle?.name).toBe('RecoveredScenario');

    // Now discoverable by a fresh init.
    resetScenarioStorage();
    expect(await initStorage()).toContain('RecoveredScenario');
  });

  describe('clearRefPointsCacheForAllScenarios', () => {
    beforeEach(async () => {
      await initStorage();
    });

    it('reports zero scenarios when none exist', async () => {
      const result = await clearRefPointsCacheForAllScenarios();
      expect(result.scenariosScanned).toBe(0);
      expect(result.scenariosCleared).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('does not surface a scenario without a refPoints/ cache as an error', async () => {
      await startSession('NoCacheScenario');
      const result = await clearRefPointsCacheForAllScenarios();
      expect(result.scenariosScanned).toBe(1);
      // Note: the OPFS mock's removeEntry resolves even for a missing entry, so
      // the production NotFoundError "skip, don't count" branch can't be
      // exercised here — the load-bearing claim of this test is that a missing
      // cache never lands in `errors`.
      expect(result.errors).toEqual([]);
    });

    it('removes an existing refPoints/ cache and counts it cleared', async () => {
      await startSession('CachedScenario');
      const scenarioHandle = getCurrentScenarioHandle()!;
      await scenarioHandle.getDirectoryHandle('refPoints', { create: true });

      const result = await clearRefPointsCacheForAllScenarios();
      expect(result.scenariosScanned).toBe(1);
      expect(result.scenariosCleared).toBe(1);
      expect(result.errors).toEqual([]);

      // Cache is gone.
      await expect(
        scenarioHandle.getDirectoryHandle('refPoints')
      ).rejects.toThrow();
    });
  });
});

describe('ScenarioWrappingStorageBackend', () => {
  let opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(async () => {
    resetScenarioStorage();
    const mocks = installOPFSMocks();
    opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
    await initStorage();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('createSession nests the session under scenarios/{contextTag}/ at the given timestamp', async () => {
    const backend = new ScenarioWrappingStorageBackend();
    const timestamp = new Date(Date.UTC(2025, 1, 28, 14, 30, 11));

    const { sessionName } = await backend.createSession(timestamp, 'BackendSc');

    expect(sessionName).toBe('recording-2025-02-28_14-30-11utc');
    await expect(
      resolvePath(
        opfsRoot,
        'gps-plus-slam',
        'scenarios',
        'BackendSc',
        sessionName
      )
    ).resolves.toBeDefined();
  });

  it('drops the previous scenario handle when a FLAT session follows a scenario session (PR #106 review)', async () => {
    // Why this test matters: it pins the OBSERVABLE contract — after a flat
    // session, getCurrentScenarioHandle() must answer null. (The accessor's
    // empty-name guard already delivered that; the flat branch now also nulls
    // the retained handle reference so module state stays coherent instead of
    // merely masked.)
    const backend = new ScenarioWrappingStorageBackend();
    await backend.createSession(
      new Date(Date.UTC(2025, 1, 28, 14, 30, 11)),
      'StaleSc'
    );
    expect(getCurrentScenarioHandle()?.name).toBe('StaleSc');

    await backend.createSession(new Date(Date.UTC(2025, 1, 28, 14, 30, 12))); // flat
    expect(getCurrentScenarioHandle()).toBeNull();
  });

  it('round-trips action / frame / metadata writes into the scenario session', async () => {
    const backend = new ScenarioWrappingStorageBackend();
    const timestamp = new Date(Date.UTC(2025, 0, 2, 3, 4, 5));
    const { sessionName } = await backend.createSession(timestamp, 'RoundTrip');

    await backend.writeAction({ type: 'gpsData/recordGpsEvent' }, 1);
    await backend.writeFrame(new Blob(['img'], { type: 'image/jpeg' }), 1);
    await backend.writeSessionMetadata({
      version: 1,
      startedAt: timestamp.toISOString(),
      endedAt: timestamp.toISOString(),
      contextTag: 'RoundTrip',
      actionCount: 1,
      frameCount: 1,
      userAgent: 'test',
    });

    const sessionHandle = await resolvePath(
      opfsRoot,
      'gps-plus-slam',
      'scenarios',
      'RoundTrip',
      sessionName
    );
    await expect(
      sessionHandle.getFileHandle('session.json')
    ).resolves.toBeDefined();
    const actionsHandle = await sessionHandle.getDirectoryHandle('actions');
    await expect(
      actionsHandle.getFileHandle('000001.json')
    ).resolves.toBeDefined();
    const imagesHandle = await sessionHandle.getDirectoryHandle('images');
    await expect(
      imagesHandle.getFileHandle('frame-000001.jpg')
    ).resolves.toBeDefined();
  });

  it('listSessions returns the sessions recorded under the current scenario', async () => {
    const backend = new ScenarioWrappingStorageBackend();
    const a = await backend.createSession(
      new Date(Date.UTC(2025, 0, 1, 0, 0, 0)),
      'ListSc'
    );
    const b = await backend.createSession(
      new Date(Date.UTC(2025, 0, 1, 0, 0, 1)),
      'ListSc'
    );

    const sessions = await backend.listSessions();
    expect(sessions).toContain(a.sessionName);
    expect(sessions).toContain(b.sessionName);
  });
});
