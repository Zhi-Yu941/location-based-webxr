/**
 * Property-based tests for the scenario-aware ref-point indexing pass
 * (`indexRefPointDefinitionsFromFolder`, 2026-07-05 folder-import plan
 * Slice 1).
 *
 * Why this test file matters:
 * The indexing pass partitions definitions from arbitrary ZIP sets into
 * per-scenario buckets (D4a) and merges each bucket via the shared sibling
 * merge (D6(a)): same-anchor definitions collapse, legacy ids re-mint to
 * their averaged-position cell, observations dedupe by content. Because the
 * merge may change definition IDS, the partition invariant is pinned at the
 * OBSERVATION level per scenario. Example-based tests pin individual
 * behaviors; these properties pin the invariants that must hold for ANY
 * folder content:
 * - Partition completeness: every input observation surfaces in exactly the
 *   bucket of its ZIP's scenario — nothing lost, nothing leaked across
 *   scenarios.
 * - Determinism/idempotence: indexing the same folder twice yields the same
 *   result (the newest-first sort makes bucket content order-independent of
 *   directory iteration order).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { BlobWriter, ZipWriter, TextReader } from '@zip.js/zip.js';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';
import { indexRefPointDefinitionsFromFolder } from './ref-point-recovery';

// ---------------------------------------------------------------------------
// Fixtures (minimal variants of the helpers in ref-point-recovery.test.ts —
// duplicated here because vitest test files cannot import from each other
// without promoting the helpers into production code)
// ---------------------------------------------------------------------------

function makeObservation(
  sessionId: string,
  timestamp: number
): RefPointObservation {
  return {
    sessionId,
    timestamp,
    arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
    gpsPoint: {
      id: `gps-${sessionId}-${timestamp}`,
      zeroRef: { lat: 50, lon: 8 },
      latitude: 50,
      longitude: 8,
      altitude: 100,
      latLongAccuracy: 5,
      coordinates: [0, 0, 0],
      weight: 1,
      timestamp,
    },
  };
}

async function createZipBlob(
  scenario: string,
  defs: RefPointDefinition[]
): Promise<Blob> {
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'), {
    level: 0,
  });
  await zipWriter.add(
    'session.json',
    new TextReader(JSON.stringify({ version: 1, contextTag: scenario }))
  );
  for (const rp of defs) {
    await zipWriter.add(
      `refPoints/${rp.id}.json`,
      new TextReader(JSON.stringify(rp))
    );
  }
  return zipWriter.close();
}

function createFolderHandle(
  files: Array<{ name: string; blob: Blob }>
): FileSystemDirectoryHandle {
  return {
    kind: 'directory' as const,
    name: 'prop-folder',
    values: () => {
      let index = 0;
      const entries = files.map((f) => ({
        name: f.name,
        kind: 'file' as const,
        getFile: () =>
          Promise.resolve(
            new File([f.blob], f.name, { type: 'application/zip' })
          ),
      }));
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
    },
  } as unknown as FileSystemDirectoryHandle;
}

// ---------------------------------------------------------------------------
// Arbitraries — kept intentionally small: each run builds real zip.js
// archives, so the value space is bounded to keep the suite fast.
// ---------------------------------------------------------------------------

const arbScenario = fc.constantFrom('Scenario A', 'Scenario B');
const arbCellId = fc.constantFrom('cell-1', 'cell-2', 'cell-3');
const arbSessionId = fc.constantFrom('sess-a', 'sess-b');

const arbDefinition: fc.Arbitrary<RefPointDefinition> = fc
  .record({
    id: arbCellId,
    name: fc.string({ minLength: 1, maxLength: 8 }),
    obsSpecs: fc.array(
      fc.record({
        sessionId: arbSessionId,
        timestamp: fc.integer({ min: 1, max: 50 }),
      }),
      { minLength: 1, maxLength: 2 }
    ),
  })
  .map(({ id, name, obsSpecs }) => {
    const observations = obsSpecs.map((s) =>
      makeObservation(s.sessionId, s.timestamp)
    );
    return {
      id,
      name,
      createdAt: observations[0]!.timestamp,
      observations,
    };
  });

// Ids must be unique within one zip: a real recording zip has one
// refPoints/{id}.json per id (zip entry paths cannot collide).
const arbZipSpec = fc.record({
  scenario: arbScenario,
  defs: fc.uniqueArray(arbDefinition, {
    minLength: 0,
    maxLength: 3,
    selector: (d) => d.id,
  }),
});

const arbFolderSpec = fc.array(arbZipSpec, { minLength: 0, maxLength: 3 });

/** Observation identity as used by the production dedupe. */
function obsKey(obs: RefPointObservation): string {
  return `${obs.sessionId}:${obs.timestamp}`;
}

describe('indexRefPointDefinitionsFromFolder — properties', () => {
  it('partitions every input observation into exactly its scenario bucket (complete, no cross-scenario leakage)', async () => {
    await fc.assert(
      fc.asyncProperty(arbFolderSpec, async (zipSpecs) => {
        const files = await Promise.all(
          zipSpecs.map(async (spec, i) => ({
            name: `recording-2026-01-0${i + 1}_10-00-00utc.zip`,
            blob: await createZipBlob(spec.scenario, spec.defs),
          }))
        );

        const result = await indexRefPointDefinitionsFromFolder(
          createFolderHandle(files)
        );

        // Expected: set of "scenario|sessionId:timestamp" over all inputs
        // (duplicates collapse — exactly what the dedupe must do). The
        // definition ID is deliberately NOT part of the key: the D6(a)
        // sibling merge may collapse ids or re-mint legacy ones, but it must
        // never move an observation across scenarios or lose one.
        const expected = new Set<string>();
        for (const spec of zipSpecs) {
          for (const def of spec.defs) {
            for (const obs of def.observations) {
              expected.add(`${spec.scenario}|${obsKey(obs)}`);
            }
          }
        }

        const actual = new Set<string>();
        for (const [scenario, defs] of result.definitionsByScenario) {
          for (const def of defs) {
            for (const obs of def.observations) {
              actual.add(`${scenario}|${obsKey(obs)}`);
            }
          }
        }

        expect(actual).toEqual(expected);
        expect(result.errors).toEqual([]);
        expect(result.zipFilesScanned).toBe(zipSpecs.length);
      }),
      { numRuns: 15 }
    );
  });

  it('is deterministic: indexing the same folder twice yields identical results', async () => {
    await fc.assert(
      fc.asyncProperty(arbFolderSpec, async (zipSpecs) => {
        const files = await Promise.all(
          zipSpecs.map(async (spec, i) => ({
            name: `recording-2026-01-0${i + 1}_10-00-00utc.zip`,
            blob: await createZipBlob(spec.scenario, spec.defs),
          }))
        );
        const handle = createFolderHandle(files);

        const first = await indexRefPointDefinitionsFromFolder(handle);
        const second = await indexRefPointDefinitionsFromFolder(handle);

        expect([...second.definitionsByScenario.entries()]).toEqual([
          ...first.definitionsByScenario.entries(),
        ]);
      }),
      { numRuns: 10 }
    );
  });
});
