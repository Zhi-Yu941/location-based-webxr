/**
 * Tests for the sibling ref-point merge (D6(a), 2026-07-06).
 *
 * Why this test matters: the recorded-session history contains "visually
 * duplicate, identity-distinct" ref points — the same physical spot stored
 * under two ids. Two mechanisms produce them: neighbor-cell H3 twins (both
 * durable, the import guard only blocks NEW writes) and legacy user-typed
 * ids (no spatial identity at all). `mergeSiblingRefPoints` is the single
 * production mechanism that collapses such clusters in memory at load time
 * — display, capture-matching, and clean imports all consume its output.
 * These tests pin the cluster rule, the most-observations-wins name policy,
 * the in-memory legacy re-mint, and observation conservation.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { gpsToH3 } from 'gps-plus-slam-app-framework/geo/h3-proximity';
import {
  mergeSiblingRefPoints,
  SIBLING_MERGE_MAX_DIST_M,
} from './ref-point-merge';
import type {
  RefPointDefinition,
  RefPointObservation,
} from './ref-point-loader';

/** ~1 m in degrees latitude. */
const LAT_DEG_PER_M = 1 / 111_320;

function obsAt(
  lat: number,
  lon: number,
  timestamp: number,
  sessionId = `session-${timestamp}`
): RefPointObservation {
  return {
    sessionId,
    timestamp,
    arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    gpsPoint: {
      id: `gps-${timestamp}`,
      zeroRef: { lat, lon },
      latitude: lat,
      longitude: lon,
      coordinates: [0, 0, 0],
      weight: 1,
      timestamp,
    },
  };
}

/** Definition whose id is the real H3 cell of its (first) position. */
function h3Def(
  name: string,
  lat: number,
  lon: number,
  obsCount: number,
  baseTs = 1_000_000
): RefPointDefinition {
  return {
    id: gpsToH3(lat, lon),
    name,
    createdAt: baseTs,
    observations: Array.from({ length: obsCount }, (_, i) =>
      obsAt(lat, lon, baseTs + i * 1000)
    ),
  };
}

function legacyDef(
  name: string,
  lat: number,
  lon: number,
  obsCount: number,
  baseTs = 1_000_000
): RefPointDefinition {
  return { ...h3Def(name, lat, lon, obsCount, baseTs), id: name };
}

const LAT = 50.742;
const LON = 6.4786;

describe('mergeSiblingRefPoints', () => {
  it('returns empty for empty input and passes unrelated points through', () => {
    expect(mergeSiblingRefPoints([])).toEqual([]);

    // Two points ~500 m apart: distinct cells far beyond gridDisk reach.
    const a = h3Def('A', LAT, LON, 2);
    const b = h3Def('B', LAT + 500 * LAT_DEG_PER_M, LON, 2);
    const merged = mergeSiblingRefPoints([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged.map((d) => d.name).sort()).toEqual(['A', 'B']);
  });

  it('merges neighbor-cell H3 twins a couple of meters apart (the durable-sibling class)', () => {
    // Find a cell boundary by nudging north, then place the twins 4 m apart
    // STRADDLING that boundary — two real neighboring cells, well under the
    // distance cap (nudging from an arbitrary start can wander a whole cell
    // width, so anchor both points at the crossing).
    let lat2 = LAT;
    do {
      lat2 += 2 * LAT_DEG_PER_M;
    } while (gpsToH3(lat2, LON) === gpsToH3(LAT, LON));
    const latA = lat2 - 4 * LAT_DEG_PER_M;
    const twinA = h3Def('Haustüre', latA, LON, 9);
    const twinB = h3Def('Haustüre', lat2, LON, 2);
    expect(twinA.id).not.toBe(twinB.id);

    const merged = mergeSiblingRefPoints([twinA, twinB]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('Haustüre');
    expect(merged[0]!.observations).toHaveLength(11);
    // The merged id is the cell of the member with the most observations.
    expect(merged[0]!.id).toBe(twinA.id);
  });

  it('resolves name conflicts by most observations, not newest (the rename-artifact fix)', () => {
    // Same id split across sources: eleven 1-obs exports named "Haustüre",
    // one NEWER 1-obs export named "Trz4" — the throwaway rename must lose.
    const id = gpsToH3(LAT, LON);
    const defs: RefPointDefinition[] = [
      ...Array.from({ length: 11 }, (_, i) => ({
        ...h3Def('Haustüre', LAT, LON, 1, 1_000_000 + i * 10_000),
        id,
      })),
      { ...h3Def('Trz4', LAT, LON, 1, 9_000_000), id },
    ];
    const merged = mergeSiblingRefPoints(defs);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('Haustüre');
    expect(merged[0]!.observations).toHaveLength(12);
    // createdAt keeps the earliest value.
    expect(merged[0]!.createdAt).toBe(1_000_000);
  });

  it('breaks name ties toward the newest backing observation', () => {
    const id = gpsToH3(LAT, LON);
    const older = { ...h3Def('Old', LAT, LON, 2, 1_000_000), id };
    const newer = { ...h3Def('New', LAT, LON, 2, 2_000_000), id };
    const merged = mergeSiblingRefPoints([older, newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe('New');
  });

  it('merges a legacy-id def into a nearby H3 def (the legacy-duplicate class)', () => {
    const h3 = h3Def('500m Schild', LAT, LON, 4);
    const legacy = legacyDef('500m Schild', LAT + 3 * LAT_DEG_PER_M, LON, 1);
    const merged = mergeSiblingRefPoints([h3, legacy]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(h3.id);
    expect(merged[0]!.observations).toHaveLength(5);
  });

  it('re-mints a lone legacy id to its averaged-position H3 cell (in-memory)', () => {
    const legacy = legacyDef('Treppe', LAT, LON, 2);
    const merged = mergeSiblingRefPoints([legacy]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(gpsToH3(LAT, LON));
    expect(merged[0]!.name).toBe('Treppe');
    expect(merged[0]!.observations).toHaveLength(2);
  });

  it('does NOT merge neighbor cells whose averaged positions are farther than the distance cap', () => {
    // Construct two neighboring cells with positions ~40 m apart (worst-case
    // legitimate-vs-distinct ambiguity): neighbor cells alone must not merge.
    let lat2 = LAT;
    do {
      lat2 += 2 * LAT_DEG_PER_M;
    } while (gpsToH3(lat2, LON) === gpsToH3(LAT, LON));
    const farLat = lat2 + 38 * LAT_DEG_PER_M;
    const a = h3Def('A', LAT, LON, 2);
    const b = { ...h3Def('B', farLat, LON, 2), id: gpsToH3(lat2, LON) };
    // Guard the fixture: distance really exceeds the cap.
    expect((farLat - LAT) / LAT_DEG_PER_M).toBeGreaterThan(
      SIBLING_MERGE_MAX_DIST_M
    );
    const merged = mergeSiblingRefPoints([a, b]);
    expect(merged).toHaveLength(2);
  });

  it('keeps definitions without observations as-is (no position → no clustering)', () => {
    const empty: RefPointDefinition = {
      id: 'legacy-empty',
      name: 'Empty',
      createdAt: 1,
      observations: [],
    };
    const merged = mergeSiblingRefPoints([empty, h3Def('A', LAT, LON, 2)]);
    expect(merged).toHaveLength(2);
    expect(merged.some((d) => d.id === 'legacy-empty')).toBe(true);
  });

  it('dedupes identical observations by content (sessionId, timestamp, raw position)', () => {
    const id = gpsToH3(LAT, LON);
    const obs = obsAt(LAT, LON, 1_000_000, 'session-x');
    const a: RefPointDefinition = {
      id,
      name: 'A',
      createdAt: 1,
      observations: [obs],
    };
    const b: RefPointDefinition = {
      id,
      name: 'A',
      createdAt: 1,
      observations: [obs, obsAt(LAT, LON, 2_000_000, 'session-y')],
    };
    const merged = mergeSiblingRefPoints([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.observations).toHaveLength(2);
  });
});

describe('mergeSiblingRefPoints properties', () => {
  /** Arbitrary: a small field of definitions scattered around one area. */
  const defArb = fc
    .record({
      name: fc.constantFrom('A', 'B', 'Haustüre', 'Trz4', 'Schild'),
      // Offsets up to ~200 m so clusters and non-clusters both occur.
      latOffsetM: fc.integer({ min: -200, max: 200 }),
      lonOffsetM: fc.integer({ min: -200, max: 200 }),
      obsCount: fc.integer({ min: 1, max: 5 }),
      legacy: fc.boolean(),
      baseTs: fc.integer({ min: 1_000_000, max: 9_000_000 }),
    })
    .map(({ name, latOffsetM, lonOffsetM, obsCount, legacy, baseTs }) => {
      const lat = LAT + latOffsetM * LAT_DEG_PER_M;
      const lon = LON + lonOffsetM * LAT_DEG_PER_M;
      return legacy
        ? legacyDef(name, lat, lon, obsCount, baseTs)
        : h3Def(name, lat, lon, obsCount, baseTs);
    });

  const obsKey = (o: RefPointObservation) =>
    `${o.sessionId}|${o.timestamp}|${o.gpsPoint.latitude}|${o.gpsPoint.longitude}`;

  // Why: the merge runs on every load — feeding its own output back in must
  // be a no-op or positions/names would drift load over load.
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.array(defArb, { maxLength: 12 }), (defs) => {
        const once = mergeSiblingRefPoints(defs);
        const twice = mergeSiblingRefPoints(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 50 }
    );
  });

  // Why: merging must never lose or duplicate an observation — the set of
  // distinct observations is exactly preserved.
  it('conserves the distinct-observation set', () => {
    fc.assert(
      fc.property(fc.array(defArb, { maxLength: 12 }), (defs) => {
        const inputKeys = new Set(
          defs.flatMap((d) => d.observations.map(obsKey))
        );
        const output = mergeSiblingRefPoints(defs);
        const outputKeys = output.flatMap((d) => d.observations.map(obsKey));
        expect(new Set(outputKeys).size).toBe(outputKeys.length);
        expect(new Set(outputKeys)).toEqual(inputKeys);
      }),
      { numRuns: 50 }
    );
  });

  // Why: the merged name must always be one that actually appears in the
  // cluster — the policy can never invent or cross-assign names.
  it('never invents a name and never increases the definition count', () => {
    fc.assert(
      fc.property(fc.array(defArb, { maxLength: 12 }), (defs) => {
        const names = new Set(defs.map((d) => d.name));
        const output = mergeSiblingRefPoints(defs);
        expect(output.length).toBeLessThanOrEqual(defs.length);
        for (const d of output) {
          expect(names.has(d.name)).toBe(true);
        }
      }),
      { numRuns: 50 }
    );
  });
});
