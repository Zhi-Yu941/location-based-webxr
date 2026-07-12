/**
 * Tests for {@link loadRecording} — the version-transparent recording loader.
 *
 * These tests use real recording zips from `TestDataJs/` to cover the
 * format-evolution path end-to-end:
 *   - An old era-≤3 recording (`2026-03-05_06-47-31utc.zip`): no sidecar
 *     `refPoints/` subdir, payloads use the pre-migration `gpsPoint` shape.
 *     The loader must apply the migration and reconstruct `refPoints` from
 *     `gpsData/markReferencePoint` actions.
 *   - A new era-4+ recording (`2026-04-23_15-55-36utc.zip`): sidecar
 *     `refPoints/*.json` files present. The loader must surface them and
 *     prefer sidecar entries over action-derived ones when ids overlap.
 *
 * Tests skip themselves when the zips are not present (CI without TestDataJs).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BlobWriter, ZipWriter, TextReader, Reader } from '@zip.js/zip.js';
import {
  loadRecording,
  isMarkRefPointAction,
  pickGpsPoint,
  type LoadedRecording,
} from './recording-loader';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';

const RECORDINGS_DIR = path.resolve(__dirname, '../../../../TestDataJs');
const OLD_ZIP = path.join(RECORDINGS_DIR, '2026-03-05_06-47-31utc.zip');
const NEW_ZIP = path.join(RECORDINGS_DIR, '2026-04-23_15-55-36utc.zip');

function readZip(p: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(p));
}

let oldLoaded: LoadedRecording | null = null;
let newLoaded: LoadedRecording | null = null;
let dataAvailable = false;

describe('loadRecording — version-transparent loader', () => {
  beforeAll(async () => {
    if (!fs.existsSync(OLD_ZIP) || !fs.existsSync(NEW_ZIP)) {
      return;
    }
    oldLoaded = await loadRecording(readZip(OLD_ZIP));
    newLoaded = await loadRecording(readZip(NEW_ZIP));
    dataAvailable = true;
  });

  describe('legacy recording (era ≤ 3, no sidecar refPoints)', () => {
    it('applies migration and reports it', () => {
      if (!dataAvailable) return;
      // Old recording uses `gpsPoint` shape → migration rewrites payloads.
      expect(oldLoaded!.capabilities.migrationApplied).toBe(true);
    });

    it('reports no sidecar ref points', () => {
      if (!dataAvailable) return;
      expect(oldLoaded!.capabilities.hasSidecarRefPoints).toBe(false);
    });

    it('reconstructs refPoints from markReferencePoint actions', () => {
      if (!dataAvailable) return;
      // The old recording is known to contain ≥1 markReferencePoint action.
      expect(oldLoaded!.refPoints.length).toBeGreaterThan(0);
      for (const def of oldLoaded!.refPoints) {
        expect(typeof def.id).toBe('string');
        expect(typeof def.createdAt).toBe('number');
        expect(def.observations.length).toBeGreaterThan(0);
        for (const obs of def.observations) {
          // Lat/lon must be real numbers post-migration (era ≤ 3 used
          // `gpsPoint.latitude/longitude` which migration renames to
          // `rawGpsPoint.latitude/longitude`).
          expect(typeof obs.gpsPoint.latitude).toBe('number');
          expect(typeof obs.gpsPoint.longitude).toBe('number');
          expect(Number.isFinite(obs.gpsPoint.latitude)).toBe(true);
          expect(Number.isFinite(obs.gpsPoint.longitude)).toBe(true);
        }
      }
    });

    it('returns actions in chronological order with post-migration schema', () => {
      if (!dataAvailable) return;
      const actions = oldLoaded!.actions;
      expect(actions.length).toBeGreaterThan(0);
      for (let i = 1; i < actions.length; i++) {
        expect(actions[i]!.index).toBeGreaterThanOrEqual(actions[i - 1]!.index);
      }
    });
  });

  describe('modern recording (era ≥ 4, sidecar refPoints/)', () => {
    it('reports sidecar ref points present', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.capabilities.hasSidecarRefPoints).toBe(true);
    });

    it('reports session.json present', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.capabilities.hasSessionMeta).toBe(true);
      expect(newLoaded!.meta).not.toBeNull();
    });

    it('returns at least one refPoint with sidecar fields (name not equal to id)', () => {
      if (!dataAvailable) return;
      expect(newLoaded!.refPoints.length).toBeGreaterThan(0);
      // Sidecar defs carry curated names. Reconstruction from actions
      // falls back to `name === id`. So at least one def must have a
      // distinct human-readable name to prove sidecars won.
      const hasCuratedName = newLoaded!.refPoints.some(
        (d) => typeof d.name === 'string' && d.name !== d.id
      );
      expect(hasCuratedName).toBe(true);
    });
  });

  describe('finalState (lazy, memoized)', () => {
    it('replays actions into a recorder store and is memoized', () => {
      if (!dataAvailable) return;
      const first = newLoaded!.getFinalState();
      const second = newLoaded!.getFinalState();
      expect(first).toBe(second);
    });
  });
});

/**
 * Boundary-contract tests for {@link isMarkRefPointAction}.
 *
 * Why this matters: the guard is the only validation of the pose arrays on
 * the action-derived ref-point path (the migration layer validates GPS
 * coordinates but never `position`/`rotation`). `buildDefsFromActions`
 * unconditionally reads `position[0..2]` and `rotation[0..3]`, so a short
 * array that merely passes `Array.isArray` would inject `undefined` into the
 * typed number tuples (`Vector3` / `Quaternion`) and silently corrupt every
 * downstream consumer of the observation's `arPose`. The guard must reject
 * such payloads up front.
 */
describe('isMarkRefPointAction — pose-array length contract', () => {
  const baseAction = (
    position: number[],
    rotation: number[]
  ): RecordedAction => ({
    type: 'gpsData/markReferencePoint',
    payload: {
      id: 'h3-abc',
      position,
      rotation,
      timestamp: 1_700_000_000_000,
      rawGpsPoint: { latitude: 50.77, longitude: 6.08 },
    },
  });

  it('accepts a full-length position (3) and rotation (4)', () => {
    expect(isMarkRefPointAction(baseAction([1, 2, 3], [0, 0, 0, 1]))).toBe(
      true
    );
  });

  it('rejects a position with fewer than 3 elements', () => {
    expect(isMarkRefPointAction(baseAction([1, 2], [0, 0, 0, 1]))).toBe(false);
  });

  it('rejects a rotation with fewer than 4 elements', () => {
    expect(isMarkRefPointAction(baseAction([1, 2, 3], [0, 0, 1]))).toBe(false);
  });

  it('rejects empty pose arrays even though they are arrays', () => {
    expect(isMarkRefPointAction(baseAction([], []))).toBe(false);
  });
});

/**
 * Boundary-contract tests for {@link pickGpsPoint}.
 *
 * Why this matters: the migration layer drops non-finite GPS coordinates only
 * when it synthesizes `refPoints/addRefPointEntry` actions, but
 * `buildDefsFromActions` reconstructs ref points directly from the preserved
 * `gpsData/markReferencePoint` actions. `pickGpsPoint` is therefore the only
 * place on that path that validates the coordinates. A point with
 * `NaN`/`undefined` lat/lon that slipped through would produce a
 * `RefPointDefinition` whose observations carry non-finite coordinates,
 * feeding the H3 matcher and `selectKnownAnchorsByCell` garbage. The guard
 * must return `null` so the malformed action is skipped.
 */
describe('pickGpsPoint — finite-coordinate contract', () => {
  const payload = (
    gps: Record<string, unknown> | undefined
  ): Parameters<typeof pickGpsPoint>[0] =>
    ({
      id: 'h3-abc',
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      timestamp: 1_700_000_000_000,
      rawGpsPoint: gps,
    }) as unknown as Parameters<typeof pickGpsPoint>[0];

  it('returns the point when latitude and longitude are finite', () => {
    const gps = { latitude: 50.77, longitude: 6.08 };
    expect(pickGpsPoint(payload(gps))).toBe(gps);
  });

  it('returns null when no GPS point is present', () => {
    expect(pickGpsPoint(payload(undefined))).toBeNull();
  });

  it('returns null when latitude is NaN', () => {
    expect(
      pickGpsPoint(payload({ latitude: NaN, longitude: 6.08 }))
    ).toBeNull();
  });

  it('returns null when longitude is undefined', () => {
    expect(pickGpsPoint(payload({ latitude: 50.77 }))).toBeNull();
  });

  it('returns null when coordinates are Infinity', () => {
    expect(
      pickGpsPoint(payload({ latitude: Infinity, longitude: 6.08 }))
    ).toBeNull();
  });

  it('falls back to the legacy `gpsPoint` field when `rawGpsPoint` is absent', () => {
    const gps = { latitude: 50.77, longitude: 6.08 };
    const p = {
      id: 'h3-abc',
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      timestamp: 1_700_000_000_000,
      gpsPoint: gps,
    } as unknown as Parameters<typeof pickGpsPoint>[0];
    expect(pickGpsPoint(p)).toBe(gps);
  });
});

/**
 * Deep-validation contract for sidecar `refPoints/*.json`.
 *
 * Why this matters: `readSidecarRefPoints` must apply the same deep
 * validation as the OPFS loader (`isRefPointDefinition`), not the shape-only
 * `isRefPointDefinitionShape`. A sidecar whose top-level shape is valid but
 * whose observations are malformed (missing `arPose` / `gpsPoint` / their
 * nested fields) would otherwise be surfaced in `LoadedRecording.refPoints`
 * and later crash consumers such as `flattenRefPointsToMarks` when they read
 * `obs.arPose.position` / `obs.gpsPoint.latitude` off undefined.
 */
describe('readSidecarRefPoints — deep observation validation', () => {
  async function buildZip(
    sidecars: Record<string, unknown>
  ): Promise<Uint8Array> {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
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
    for (const [id, body] of Object.entries(sidecars)) {
      await zipWriter.add(
        `refPoints/${id}.json`,
        new TextReader(JSON.stringify(body))
      );
    }
    const blob = await zipWriter.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  const validDef = {
    id: 'pointGood',
    name: 'Good Point',
    createdAt: 1_700_000_000_000,
    observations: [
      {
        sessionId: 's1',
        timestamp: 1_700_000_000_000,
        arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        gpsPoint: { latitude: 50.77, longitude: 6.08 },
      },
    ],
  };

  // Top-level shape is valid (id/name/createdAt/observations[]) but the lone
  // observation lacks `arPose` and `gpsPoint`, so deep validation must reject
  // the whole sidecar.
  const malformedObsDef = {
    id: 'pointBad',
    name: 'Bad Point',
    createdAt: 1_700_000_000_000,
    observations: [{ sessionId: 's1', timestamp: 1_700_000_000_000 }],
  };

  it('keeps a sidecar whose observations are well-formed', async () => {
    const loaded = await loadRecording(await buildZip({ pointGood: validDef }));
    expect(loaded.refPoints.map((d) => d.id)).toContain('pointGood');
    expect(loaded.capabilities.hasSidecarRefPoints).toBe(true);
  });

  it('skips a sidecar with malformed observations while keeping valid ones', async () => {
    const loaded = await loadRecording(
      await buildZip({ pointGood: validDef, pointBad: malformedObsDef })
    );
    const ids = loaded.refPoints.map((d) => d.id);
    expect(ids).toContain('pointGood');
    expect(ids).not.toContain('pointBad');
  });
});

/**
 * Within-recording re-mark round trip (indoor-loop enablement follow-up,
 * 2026-07-12).
 *
 * Why this test matters: the loop-recording field protocol re-marks the
 * same corner on every pass, so one recording zip legitimately carries
 * SEVERAL `refPoints/addRefPointEntry` actions of the same id AND a
 * sidecar with several same-session observations. This is the read half
 * of the end-to-end promise (the write half is pinned in
 * recorder-store.test.ts / ref-points-zip-contributor.test.ts /
 * ref-point-loader.test.ts): `loadRecording` must surface ALL of them —
 * a first-wins dedupe in the action stream or an observation merge in the
 * sidecar path would silently destroy the re-observation ground truth the
 * investigations consume.
 */
describe('loadRecording — within-recording re-marks survive the zip round trip', () => {
  const CORNER_ID = '8b1fa0a4970afff';
  const SESSION = 'recording-2026-07-11_12-44-19utc';
  const TIMESTAMPS = [1_700_000_001_000, 1_700_000_016_000, 1_700_000_031_000];

  function markAction(timestamp: number): RecordedAction {
    return {
      type: 'refPoints/addRefPointEntry',
      payload: {
        id: CORNER_ID,
        timestamp,
        name: 'Corner A1',
        rawGpsPoint: {
          id: `gps-${timestamp}`,
          latitude: 50.776,
          longitude: 6.083,
          timestamp,
        },
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
      },
    };
  }

  async function buildLoopZip(): Promise<Uint8Array> {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await zipWriter.add(
      'session.json',
      new TextReader(
        JSON.stringify({
          version: 1,
          startedAt: new Date(TIMESTAMPS[0]!).toISOString(),
          endedAt: new Date(TIMESTAMPS[2]!).toISOString(),
          scenarioName: 'LoopScenario',
          actionCount: 4,
          frameCount: 0,
          userAgent: 'test',
        })
      )
    );
    const actions: RecordedAction[] = [
      {
        type: 'recording/startSession',
        payload: { sessionName: SESSION, startTime: TIMESTAMPS[0] },
      },
      ...TIMESTAMPS.map(markAction),
    ];
    for (let i = 0; i < actions.length; i++) {
      await zipWriter.add(
        `actions/${String(i + 1).padStart(6, '0')}.json`,
        new TextReader(JSON.stringify(actions[i]))
      );
    }
    await zipWriter.add(
      `refPoints/${CORNER_ID}.json`,
      new TextReader(
        JSON.stringify({
          id: CORNER_ID,
          name: 'Corner A1',
          createdAt: TIMESTAMPS[0],
          observations: TIMESTAMPS.map((t) => ({
            sessionId: SESSION,
            timestamp: t,
            arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
            gpsPoint: { latitude: 50.776, longitude: 6.083 },
          })),
        })
      )
    );
    const blob = await zipWriter.close();
    return new Uint8Array(await blob.arrayBuffer());
  }

  it('surfaces all three same-id actions AND all three sidecar observations', async () => {
    const loaded = await loadRecording(await buildLoopZip());

    // Action stream: every re-mark survives, in order, none deduped.
    const marks = loaded.actions.filter(
      (e) => e.action.type === 'refPoints/addRefPointEntry'
    );
    expect(marks).toHaveLength(3);
    expect(
      marks.map((e) => (e.action.payload as { timestamp: number }).timestamp)
    ).toEqual(TIMESTAMPS);

    // Sidecar path: one definition carrying ALL observations.
    const def = loaded.refPoints.find((d) => d.id === CORNER_ID);
    expect(def).toBeDefined();
    expect(def!.observations).toHaveLength(3);
    expect(def!.observations.map((o) => o.timestamp)).toEqual(TIMESTAMPS);
  });
});

/**
 * Lazy ZipSource Reader input — full-chain equivalence.
 *
 * Why this test matters: the Investigation corpus gate validates 100+
 * recording zips (2.4 GB total) and must not read whole archives into memory
 * just to check a few KB of JSON — that breached its 60 s regression budget
 * (gps-plus-slam repo:
 * GpsPlusSlamJs_Investigation/docs/2026-07-09-1944-regression-gate-budget-breach-followup.md).
 * loadRecording therefore accepts any zip.js Reader. This test proves the
 * full lazy chain (fd-backed ranged Reader → framework zip helpers →
 * loadRecording) yields a LoadedRecording identical to the Uint8Array path,
 * including loadRecording's concurrent triple use of the ONE shared Reader
 * instance (Promise.all over actions + metadata + sidecar helpers). It runs
 * against the framework SOURCE (vitest alias), so it guards the lazy path
 * before the framework change is published to npm.
 */
describe('loadRecording — lazy ZipSource Reader input', () => {
  /** Ranged reader over an open fd; reads only the byte ranges zip.js asks for. */
  class NodeFdReader extends Reader<void> {
    private readonly fd: number;
    constructor(fd: number) {
      super(undefined);
      this.fd = fd;
    }
    override async init(): Promise<void> {
      await super.init?.();
      this.size = fs.fstatSync(this.fd).size;
    }
    readUint8Array(index: number, length: number): Promise<Uint8Array> {
      const clamped = Math.min(length, Math.max(0, this.size - index));
      const buf = Buffer.alloc(clamped);
      let offset = 0;
      while (offset < clamped) {
        const n = fs.readSync(
          this.fd,
          buf,
          offset,
          clamped - offset,
          index + offset
        );
        if (n === 0) break;
        offset += n;
      }
      return Promise.resolve(
        new Uint8Array(buf.buffer, buf.byteOffset, offset)
      );
    }
  }

  it('yields a LoadedRecording identical to the Uint8Array path (modern zip)', async () => {
    if (!fs.existsSync(NEW_ZIP)) return; // CI without TestDataJs
    const fd = fs.openSync(NEW_ZIP, 'r');
    try {
      const lazy = await loadRecording(new NodeFdReader(fd));
      const eager = await loadRecording(readZip(NEW_ZIP));
      expect(lazy.meta).toEqual(eager.meta);
      expect(lazy.actions).toEqual(eager.actions);
      expect(lazy.refPoints).toEqual(eager.refPoints);
      expect(lazy.capabilities).toEqual(eager.capabilities);
    } finally {
      fs.closeSync(fd);
    }
  });

  it('handles the migration path identically for a legacy (era ≤ 3) zip', async () => {
    if (!fs.existsSync(OLD_ZIP)) return; // CI without TestDataJs
    const fd = fs.openSync(OLD_ZIP, 'r');
    try {
      const lazy = await loadRecording(new NodeFdReader(fd));
      const eager = await loadRecording(readZip(OLD_ZIP));
      expect(lazy.capabilities.migrationApplied).toBe(true);
      expect(lazy.actions).toEqual(eager.actions);
      expect(lazy.refPoints).toEqual(eager.refPoints);
    } finally {
      fs.closeSync(fd);
    }
  });
});
