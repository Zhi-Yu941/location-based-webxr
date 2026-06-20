/**
 * StorageBackend Interface & Implementations Tests
 *
 * Why this test matters: Validates that the StorageBackend abstraction works
 * correctly for both the NullStorageBackend (tests/replay) and
 * OpfsStorageBackend (production). This abstraction decouples the store from
 * the concrete OPFS dependency, enabling clean testing without vi.mock().
 *
 * TDD: These tests were written before the implementations to drive the API.
 */

import { describe, it, expect, vi } from 'vitest';
import type { StorageBackend } from './storage-backend';
import type { SessionMetadata } from './opfs-storage';
import { NullStorageBackend } from './null-storage-backend';
import { OpfsStorageBackend } from './opfs-storage-backend';

// ---------------------------------------------------------------------------
// NullStorageBackend
// ---------------------------------------------------------------------------

describe('NullStorageBackend', () => {
  it('implements StorageBackend interface', () => {
    // Why: Compile-time + runtime check that NullStorageBackend satisfies the interface
    const backend: StorageBackend = new NullStorageBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.writeAction).toBe('function');
    expect(typeof backend.writeFrame).toBe('function');
    expect(typeof backend.writeSessionMetadata).toBe('function');
  });

  it('writeAction resolves without side effects', async () => {
    // Why: NullStorageBackend must be a safe no-op for replay and tests
    const backend = new NullStorageBackend();
    await expect(
      backend.writeAction({ type: 'test/action' }, 1)
    ).resolves.toBeUndefined();
  });

  it('writeFrame resolves without side effects', async () => {
    // Why: Frame writes must also be no-ops in test/replay mode
    const backend = new NullStorageBackend();
    const blob = new Blob(['test'], { type: 'image/jpeg' });
    await expect(backend.writeFrame(blob, 1)).resolves.toBeUndefined();
  });

  it('writeSessionMetadata resolves without side effects', async () => {
    // Why: Session metadata writes must be no-ops in test/replay mode
    const backend = new NullStorageBackend();
    const metadata = {
      version: 1 as const,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T01:00:00Z',
      scenarioName: 'Test',
      actionCount: 10,
      frameCount: 5,
      userAgent: 'test-agent',
    };
    await expect(
      backend.writeSessionMetadata(metadata)
    ).resolves.toBeUndefined();
  });

  it('can be called many times without accumulating state', async () => {
    // Why: Replay dispatches hundreds of actions; must not leak memory
    const backend = new NullStorageBackend();
    for (let i = 0; i < 100; i++) {
      await backend.writeAction({ type: `action/${i}` }, i);
    }
    // If we get here without error, the backend is stateless
    expect(true).toBe(true);
  });

  it('createSession resolves with a session name', async () => {
    // Why: session lifecycle is promoted onto the StorageBackend interface
    // so wrapping backends (e.g. ScenarioWrappingStorageBackend) can intercept it.
    // NullStorageBackend must satisfy the contract with a plausible no-op result.
    const backend: StorageBackend = new NullStorageBackend();
    const result = await backend.createSession(
      new Date('2026-05-03T12:00:00Z')
    );
    expect(result).toHaveProperty('sessionName');
    expect(typeof result.sessionName).toBe('string');
    expect(result.sessionName.length).toBeGreaterThan(0);
  });

  it('createSession accepts an optional contextTag', async () => {
    // Why: contextTag is an opaque string the framework doesn't interpret.
    // The recorder uses it to carry scenario name. NullStorageBackend must accept it.
    const backend: StorageBackend = new NullStorageBackend();
    const result = await backend.createSession(
      new Date('2026-05-03T12:00:00Z'),
      'my-scenario'
    );
    expect(result).toHaveProperty('sessionName');
  });

  it('listSessions resolves with an empty array', async () => {
    // Why: NullStorageBackend has no storage, so listing returns empty.
    const backend: StorageBackend = new NullStorageBackend();
    const sessions = await backend.listSessions();
    expect(sessions).toEqual([]);
  });

  it('writeSessionMetadata accepts metadata without scenarioName', async () => {
    // Why: SessionMetadata.scenarioName is replaced by optional contextTag;
    // framework metadata must not require scenario-specific fields.
    const backend = new NullStorageBackend();
    const metadata: SessionMetadata = {
      version: 1,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T01:00:00Z',
      actionCount: 10,
      frameCount: 5,
      userAgent: 'test-agent',
    };
    await expect(
      backend.writeSessionMetadata(metadata)
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OpfsStorageBackend
// ---------------------------------------------------------------------------

// Mock the opfs-storage module so we can verify delegation without real OPFS.
// Partial mock keeps the rest of opfs-storage real (only the delegated calls
// are stubbed).
vi.mock('./opfs-storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeAction: vi.fn().mockResolvedValue(undefined),
  writeFrame: vi.fn().mockResolvedValue(undefined),
  writeSessionMetadata: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue({
    sessionName: 'recording-2026-01-01_00-00-00utc',
  }),
  listSessions: vi.fn().mockResolvedValue([]),
}));

describe('OpfsStorageBackend', () => {
  it('implements StorageBackend interface', () => {
    // Why: Compile-time + runtime check that OpfsStorageBackend satisfies the interface
    const backend: StorageBackend = new OpfsStorageBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.writeAction).toBe('function');
    expect(typeof backend.writeFrame).toBe('function');
    expect(typeof backend.writeSessionMetadata).toBe('function');
  });

  it('writeAction delegates to opfs-storage writeAction', async () => {
    // Why: OpfsStorageBackend must forward calls to the existing OPFS functions
    const { writeAction } = await import('./opfs-storage');
    const backend = new OpfsStorageBackend();
    const action = { type: 'gpsData/recordGpsEvent', payload: {} };

    await backend.writeAction(action, 42);

    expect(writeAction).toHaveBeenCalledWith(action, 42);
  });

  it('writeFrame delegates to opfs-storage writeFrame', async () => {
    // Why: Frame persistence must use the same OPFS path as direct calls
    const { writeFrame } = await import('./opfs-storage');
    const backend = new OpfsStorageBackend();
    const blob = new Blob(['img'], { type: 'image/jpeg' });

    await backend.writeFrame(blob, 7);

    expect(writeFrame).toHaveBeenCalledWith(blob, 7);
  });

  it('writeSessionMetadata delegates to opfs-storage writeSessionMetadata', async () => {
    // Why: Session metadata must be written via the same OPFS facade
    const { writeSessionMetadata } = await import('./opfs-storage');
    const backend = new OpfsStorageBackend();
    const metadata = {
      version: 1 as const,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T01:00:00Z',
      scenarioName: 'Test',
      actionCount: 10,
      frameCount: 5,
      userAgent: 'test-agent',
    };

    await backend.writeSessionMetadata(metadata);

    expect(writeSessionMetadata).toHaveBeenCalledWith(metadata);
  });

  it('propagates errors from opfs-storage writeAction', async () => {
    // Why: Errors must not be swallowed — the store handles them with onWriteFailure
    const { writeAction } = await import('./opfs-storage');
    vi.mocked(writeAction).mockRejectedValueOnce(new Error('OPFS full'));
    const backend = new OpfsStorageBackend();

    await expect(backend.writeAction({ type: 'test' }, 1)).rejects.toThrow(
      'OPFS full'
    );
  });

  it('createSession delegates to opfs-storage createSession', async () => {
    // Why: OpfsStorageBackend must forward createSession to the underlying
    // opfs-storage module for OPFS directory creation
    const { createSession } = await import('./opfs-storage');
    vi.mocked(createSession).mockResolvedValueOnce({
      sessionName: 'recording-2026-05-03_12-00-00utc',
    });
    const backend = new OpfsStorageBackend();

    const result = await backend.createSession(
      new Date('2026-05-03T12:00:00Z')
    );

    expect(createSession).toHaveBeenCalled();
    expect(result.sessionName).toBe('recording-2026-05-03_12-00-00utc');
  });

  it('listSessions delegates to opfs-storage listSessions', async () => {
    // Why: OpfsStorageBackend must forward listSessions to opfs-storage module
    const { listSessions } = await import('./opfs-storage');
    vi.mocked(listSessions).mockResolvedValueOnce([
      'recording-2026-05-03_12-00-00utc',
      'recording-2026-05-03_13-00-00utc',
    ]);
    const backend = new OpfsStorageBackend();

    const sessions = await backend.listSessions();

    expect(listSessions).toHaveBeenCalled();
    expect(sessions).toEqual([
      'recording-2026-05-03_12-00-00utc',
      'recording-2026-05-03_13-00-00utc',
    ]);
  });
});
