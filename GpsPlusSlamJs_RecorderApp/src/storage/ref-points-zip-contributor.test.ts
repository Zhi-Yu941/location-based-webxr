/**
 * Tests for the recorder-side ref-points ZIP contributor.
 *
 * Why these tests matter: ref-point storage was migrated out of the
 * framework in Iter 3 of the AppFramework / RecorderApp boundary cleanup.
 * The framework's old hard-coded `streamSessionRefPointsToZip` branch was
 * retired in favour of this contributor, so the per-session filtering
 * semantics that users rely on must continue to hold here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveRefPointObservation,
  type RefPointDefinition,
  type RefPointObservation,
} from './ref-point-loader';
import { createRefPointsZipContributor } from './ref-points-zip-contributor';
import { MockFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import type {
  GpsPoint,
  Vector3,
  Quaternion,
} from 'gps-plus-slam-app-framework/core';

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

describe('createRefPointsZipContributor', () => {
  let scenarioHandle: MockFSDirectoryHandle;
  const sessionName = 'recording-2026-04-13_10-00-00utc';

  // Capture every file the contributor writes so each test can assert on the
  // exact final layout.
  let written: Map<string, Blob>;
  const addFile = vi.fn((path: string, blob: Blob) => {
    written.set(path, blob);
    return Promise.resolve();
  });

  beforeEach(() => {
    written = new Map();
    addFile.mockClear();
    scenarioHandle = new MockFSDirectoryHandle('scenarios/refpts');
  });

  it('declares the refPoints/ subdir', () => {
    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    expect(contributor.subdir).toBe('refPoints');
  });

  it('includes ref points observed in the current session', async () => {
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f1',
      'Bench',
      makeObservation(sessionName, 1)
    );

    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    const count = await contributor.contribute(addFile);

    expect(count).toBe(1);
    expect(written.has('8b1f1a5c2e3d4f1.json')).toBe(true);
    const parsed = JSON.parse(
      await (written.get('8b1f1a5c2e3d4f1.json') as Blob).text()
    ) as RefPointDefinition;
    expect(parsed.id).toBe('8b1f1a5c2e3d4f1');
    expect(parsed.name).toBe('Bench');
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0].sessionId).toBe(sessionName);
  });

  it('filters out observations from other sessions', async () => {
    // Two observations on the same ref point: one for this session, one for another.
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

    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    const count = await contributor.contribute(addFile);

    expect(count).toBe(1);
    const parsed = JSON.parse(
      await (written.get('8b1f1a5c2e3d4f2.json') as Blob).text()
    ) as RefPointDefinition;
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0].sessionId).toBe(sessionName);
  });

  /**
   * Why this test matters (indoor-loop enablement follow-up, 2026-07-12):
   * the loop-recording protocol re-marks the same corner on every pass, so
   * one session legitimately holds SEVERAL observations of one id. The
   * session filter must keep them ALL — a `find`-style first-match (or an
   * accidental dedupe) would silently halve the within-recording
   * re-observation ground truth in every exported zip.
   */
  it('includes ALL same-session observations of one ref point (within-recording re-marks)', async () => {
    // Three marks of the same corner in THIS session (loop passes,
    // ≥10 s apart), plus one from another session that must be filtered.
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f9',
      'Corner A1',
      makeObservation(sessionName, 1_000)
    );
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f9',
      'Corner A1',
      makeObservation(sessionName, 16_000)
    );
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f9',
      'Corner A1',
      makeObservation(sessionName, 31_000)
    );
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f9',
      'Corner A1',
      makeObservation('recording-2026-04-12_09-00-00utc', 99_000)
    );

    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    const count = await contributor.contribute(addFile);

    expect(count).toBe(1);
    const parsed = JSON.parse(
      await (written.get('8b1f1a5c2e3d4f9.json') as Blob).text()
    ) as RefPointDefinition;
    expect(parsed.observations).toHaveLength(3);
    expect(parsed.observations.map((o) => o.timestamp)).toEqual([
      1_000, 16_000, 31_000,
    ]);
    for (const o of parsed.observations) {
      expect(o.sessionId).toBe(sessionName);
    }
  });

  it('excludes ref points with zero observations in this session', async () => {
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f3',
      'Tree',
      makeObservation('recording-2026-04-12_09-00-00utc', 1000)
    );

    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    const count = await contributor.contribute(addFile);

    expect(count).toBe(0);
    expect(written.has('8b1f1a5c2e3d4f3.json')).toBe(false);
  });

  it('returns 0 when the refPoints directory does not exist', async () => {
    // No saveRefPointObservation calls — refPoints/ never created.
    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    const count = await contributor.contribute(addFile);

    expect(count).toBe(0);
    expect(addFile).not.toHaveBeenCalled();
  });

  it('returns 0 when scenarioHandle is null (flat layout)', async () => {
    const contributor = createRefPointsZipContributor(null, sessionName);
    const count = await contributor.contribute(addFile);
    expect(count).toBe(0);
    expect(addFile).not.toHaveBeenCalled();
  });

  it('preserves id, name, and createdAt fields', async () => {
    await saveRefPointObservation(
      scenarioHandle,
      '8b1f1a5c2e3d4f5',
      'Cathedral',
      makeObservation(sessionName, 1713000000000)
    );

    const contributor = createRefPointsZipContributor(
      scenarioHandle,
      sessionName
    );
    await contributor.contribute(addFile);

    const parsed = JSON.parse(
      await (written.get('8b1f1a5c2e3d4f5.json') as Blob).text()
    ) as RefPointDefinition;
    expect(parsed.id).toBe('8b1f1a5c2e3d4f5');
    expect(parsed.name).toBe('Cathedral');
    expect(typeof parsed.createdAt).toBe('number');
  });
});
