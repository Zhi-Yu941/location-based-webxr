/**
 * Property-Based Tests for H3 Ref Point Proximity Matching
 *
 * These tests verify invariants of findNearbyGeoAnchor and approxDistanceMetres
 * using randomized inputs, catching edge cases that example-based tests miss.
 *
 * Why these tests matter:
 * 1. findNearbyGeoAnchor must always return the closest candidate when multiple
 *    ref points have overlapping gridDisk zones — regardless of array order.
 * 2. approxDistanceMetres must be consistent with haversine for small distances.
 * 3. The distance helper must satisfy basic metric space properties.
 *
 * @see docs/2026-04-18-ref-point-proximity-button-improvements.md Part A
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { latLngToCell, gridDisk } from 'h3-js';
import {
  findNearbyGeoAnchor,
  approxDistanceMetres,
  type KnownGeoAnchor,
  H3_RESOLUTION,
} from './h3-proximity';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** GPS latitude in a reasonable range (mid-Europe) */
const arbLat = fc.double({ min: 48.0, max: 52.0, noNaN: true });

/** GPS longitude in a reasonable range (mid-Europe) */
const arbLon = fc.double({ min: 5.0, max: 10.0, noNaN: true });

/** Small offset in degrees: 0.0005–0.0012° ≈ 55–133 m at lat ~50° */
const arbOverlapOffset = fc.double({ min: 0.0005, max: 0.0012, noNaN: true });

/** Interpolation factor between 0.1 and 0.9 */
const arbLerp = fc.double({ min: 0.1, max: 0.9, noNaN: true });

// ---------------------------------------------------------------------------
// approxDistanceMetres properties
// ---------------------------------------------------------------------------

describe('approxDistanceMetres properties', () => {
  // Why: distance(a, a) must be 0 for any point — identity of indiscernibles.
  it('returns 0 for identical points', () => {
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        expect(approxDistanceMetres(lat, lon, lat, lon)).toBe(0);
      })
    );
  });

  // Why: distance(a, b) must equal distance(b, a) — symmetry.
  it('is symmetric', () => {
    fc.assert(
      fc.property(arbLat, arbLon, arbLat, arbLon, (lat1, lon1, lat2, lon2) => {
        const d1 = approxDistanceMetres(lat1, lon1, lat2, lon2);
        const d2 = approxDistanceMetres(lat2, lon2, lat1, lon1);
        expect(d1).toBeCloseTo(d2, 6);
      })
    );
  });

  // Why: distance must always be non-negative — positive definiteness.
  it('is non-negative', () => {
    fc.assert(
      fc.property(arbLat, arbLon, arbLat, arbLon, (lat1, lon1, lat2, lon2) => {
        expect(
          approxDistanceMetres(lat1, lon1, lat2, lon2)
        ).toBeGreaterThanOrEqual(0);
      })
    );
  });
});

// ---------------------------------------------------------------------------
// findNearbyGeoAnchor closest-match properties
// ---------------------------------------------------------------------------

describe('findNearbyGeoAnchor closest-match properties', () => {
  // Why: When two ref points overlap and a query point is between them,
  // the returned ref point must always be the one with smaller distance,
  // regardless of array order. This is the core invariant that the
  // .find() → .filter() + distance ranking fix must preserve.
  it('returns the closest candidate regardless of array order', () => {
    fc.assert(
      fc.property(
        arbLat,
        arbLon,
        arbOverlapOffset,
        arbLerp,
        (baseLat, baseLon, offset, t) => {
          // Two ref points separated by `offset` degrees north-south
          const rpA: KnownGeoAnchor = {
            h3Index: latLngToCell(baseLat, baseLon, H3_RESOLUTION),
            displayName: 'A',
            lat: baseLat,
            lon: baseLon,
          };
          const rpB: KnownGeoAnchor = {
            h3Index: latLngToCell(baseLat + offset, baseLon, H3_RESOLUTION),
            displayName: 'B',
            lat: baseLat + offset,
            lon: baseLon,
          };

          // Query at interpolation factor t between A and B
          const queryLat = baseLat + offset * t;
          const queryLon = baseLon;

          // Check both are in the query's gridDisk (overlap zone)
          const queryCell = latLngToCell(queryLat, queryLon, H3_RESOLUTION);
          const safeZone = gridDisk(queryCell, 1);
          const aInZone = safeZone.includes(rpA.h3Index);
          const bInZone = safeZone.includes(rpB.h3Index);

          if (!aInZone || !bInZone) {
            // Not in the overlap zone — skip this sample (precondition)
            return;
          }

          // Both candidates in range — the result must be the same
          // regardless of array order
          const matchAB = findNearbyGeoAnchor(queryLat, queryLon, [rpA, rpB]);
          const matchBA = findNearbyGeoAnchor(queryLat, queryLon, [rpB, rpA]);
          expect(matchAB?.displayName).toBe(matchBA?.displayName);

          // The result must be the closest by distance
          const distA = approxDistanceMetres(
            queryLat,
            queryLon,
            rpA.lat,
            rpA.lon
          );
          const distB = approxDistanceMetres(
            queryLat,
            queryLon,
            rpB.lat,
            rpB.lon
          );
          const expected = distA <= distB ? 'A' : 'B';
          expect(matchAB?.displayName).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  // Why: When only one ref point is in range, findNearbyGeoAnchor must
  // return it — the single-match fast path must still work correctly.
  it('returns the single candidate when only one is in range', () => {
    fc.assert(
      fc.property(arbLat, arbLon, (lat, lon) => {
        const rp: KnownGeoAnchor = {
          h3Index: latLngToCell(lat, lon, H3_RESOLUTION),
          displayName: 'Solo',
          lat,
          lon,
        };
        // Query at the exact same position — guaranteed to be in gridDisk
        const match = findNearbyGeoAnchor(lat, lon, [rp]);
        expect(match).toBe(rp);
      })
    );
  });
});
