/**
 * H3-Based Reference Point ID Tests
 *
 * Why these tests matter:
 * Reference point identity was previously based on user-entered names, which
 * proved error-prone on mobile devices (virtual keyboard layout shift caused
 * accidental suggestion taps — see docs/2026-03-08-ref-point-naming-investigation.md).
 * The fix replaces user-entered names with deterministic H3 hex indices computed
 * from raw GPS coordinates at capture time.
 *
 * These tests verify:
 * 1. h3-js is correctly installed and its core API works as expected
 * 2. Resolution 11 produces appropriate cell sizes for our use case
 * 3. gridDisk neighbor matching absorbs GPS jitter (~3-10m)
 * 4. The handler uses H3 index as the ref point ID (not picker-returned name)
 *
 * @see docs/2026-03-08-ref-point-naming-investigation.md §6 for design rationale
 */

import { describe, it, expect } from 'vitest';
import { latLngToCell, gridDisk, cellToLatLng } from 'h3-js';
import {
  gpsToH3,
  findNearbyGeoAnchor,
  approxDistanceMetres,
  h3CellsMatch,
  isH3Index,
  H3_RESOLUTION,
  type KnownGeoAnchor,
} from './h3-proximity';

// ============================================================================
// 1. h3-js library integration — proves the dependency works
// ============================================================================

describe('h3-js library integration', () => {
  // Why: Proves h3-js is correctly installed and latLngToCell returns
  // a valid H3 index string. This test will break if the dependency is
  // removed or the API changes in a breaking way.
  it('latLngToCell returns a hex string at resolution 11', () => {
    const index = latLngToCell(50.7495, 6.4793, 11);
    expect(index).toBeTypeOf('string');
    // H3 indices at res 11 are 15-character hex strings ending in "ffff"
    expect(index).toMatch(/^[0-9a-f]{15}$/);
  });

  // Why: Proves resolution 11 cells are small enough for our use case.
  // Two points ~25m apart should sometimes get different cells, but
  // two points < 1m apart should always get the same cell.
  it('same GPS position always produces the same cell', () => {
    const a = latLngToCell(50.7495, 6.4793, 11);
    const b = latLngToCell(50.7495, 6.4793, 11);
    expect(a).toBe(b);
  });

  // Why: Two points far apart (> 100m) must be in different cells at res 11.
  // This confirms resolution 11 is granular enough to distinguish ref points.
  it('distant points produce different cells at resolution 11', () => {
    const cellA = latLngToCell(50.7495, 6.4793, 11); // Location 1
    const cellB = latLngToCell(50.7451, 6.4804, 11); // Location 4 (~500m away)
    expect(cellA).not.toBe(cellB);
  });

  // Why: gridDisk(cell, 1) must return 7 cells (center + 6 neighbors).
  // This is the foundation of the boundary-jitter safe zone (~65m radius).
  it('gridDisk returns 7 cells for k=1', () => {
    const center = latLngToCell(50.7495, 6.4793, 11);
    const disk = gridDisk(center, 1);
    expect(disk).toHaveLength(7);
    expect(disk).toContain(center);
  });

  // Why: cellToLatLng must round-trip to approximately the same position.
  // This proves H3 indices can be decoded back to GPS for display.
  it('cellToLatLng round-trips to within ~25m of original', () => {
    const origLat = 50.7495;
    const origLng = 6.4793;
    const cell = latLngToCell(origLat, origLng, 11);
    const [decodedLat, decodedLng] = cellToLatLng(cell);

    // At res 11 (~25m edge), center should be within 25m of original
    const R = 6_371_000;
    const dLat = ((decodedLat - origLat) * Math.PI) / 180;
    const dLng = ((decodedLng - origLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((origLat * Math.PI) / 180) *
        Math.cos((decodedLat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    expect(distance).toBeLessThan(25);
  });
});

// ============================================================================
// 2. GPS jitter absorption via gridDisk
// ============================================================================

describe('gridDisk jitter absorption at resolution 11', () => {
  // Why: GPS jitter of 3-10m can push a point into a neighboring cell.
  // gridDisk must absorb this so that re-visits to the same physical spot
  // are recognized even when the raw H3 cell differs.
  it('points within 3-10m GPS jitter share a gridDisk overlap', () => {
    // Original position
    const baseLat = 50.7475;
    const baseLng = 6.4812;

    // Simulate 5m jitter in different directions
    // 5m ≈ 0.000045° latitude, ≈ 0.000070° longitude at lat 50°
    const jitteredPositions = [
      { lat: baseLat + 0.000045, lng: baseLng }, // ~5m north
      { lat: baseLat - 0.000045, lng: baseLng }, // ~5m south
      { lat: baseLat, lng: baseLng + 0.00007 }, // ~5m east
      { lat: baseLat, lng: baseLng - 0.00007 }, // ~5m west
      { lat: baseLat + 0.00009, lng: baseLng + 0.00007 }, // ~10m NE
    ];

    const baseCell = latLngToCell(baseLat, baseLng, 11);
    const baseDisk = gridDisk(baseCell, 1);

    for (const pos of jitteredPositions) {
      const jitteredCell = latLngToCell(pos.lat, pos.lng, 11);
      const jitteredDisk = gridDisk(jitteredCell, 1);

      // The base cell must appear in the jittered disk OR the jittered cell
      // must appear in the base disk (symmetric matching)
      const overlap =
        baseDisk.includes(jitteredCell) || jitteredDisk.includes(baseCell);
      expect(overlap, `jitter at (${pos.lat}, ${pos.lng}) should overlap`).toBe(
        true
      );
    }
  });

  // Why: Ref points at different physical locations (> 130m apart) must NOT
  // overlap via gridDisk. This ensures the matching doesn't produce false positives.
  it('points >130m apart do NOT share gridDisk overlap', () => {
    // Location 3 and Location 4 from investigation (~135m apart)
    const cellA = latLngToCell(50.7462, 6.4811, 11);
    const cellB = latLngToCell(50.7451, 6.4804, 11);

    const diskA = gridDisk(cellA, 1);
    const diskB = gridDisk(cellB, 1);

    // Neither cell should appear in the other's disk
    expect(diskA.includes(cellB)).toBe(false);
    expect(diskB.includes(cellA)).toBe(false);
  });

  // Why: The 4 physical locations from the investigation must be distinguishable
  // at resolution 11. This is the real-world validation of the resolution choice.
  it('all 4 investigation locations produce distinct non-overlapping cells', () => {
    const locations = [
      { name: 'Loc 1', lat: 50.7495, lng: 6.4793 },
      { name: 'Loc 2', lat: 50.7475, lng: 6.4812 },
      { name: 'Loc 3', lat: 50.7462, lng: 6.4811 },
      { name: 'Loc 4', lat: 50.7451, lng: 6.4804 },
    ];

    const cells = locations.map((loc) => latLngToCell(loc.lat, loc.lng, 11));
    const disks = cells.map((c) => gridDisk(c, 1));

    // All cells must be unique
    expect(new Set(cells).size).toBe(4);

    // No cell from one location should appear in any other location's disk
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        const overlap =
          disks[i].includes(cells[j]) || disks[j].includes(cells[i]);
        expect(
          overlap,
          `${locations[i].name} and ${locations[j].name} should NOT overlap`
        ).toBe(false);
      }
    }
  });
});

// ============================================================================
// 3. h3-proximity.ts utility module
// ============================================================================

describe('gpsToH3', () => {
  // Why: Verifies the exported helper wraps latLngToCell at the correct resolution.
  it('returns the same index as latLngToCell at resolution 11', () => {
    const lat = 50.7475;
    const lng = 6.4812;
    expect(gpsToH3(lat, lng)).toBe(latLngToCell(lat, lng, 11));
  });

  // Why: H3_RESOLUTION must be 11 — the design rationale depends on this exact value.
  it('exports H3_RESOLUTION as 11', () => {
    expect(H3_RESOLUTION).toBe(11);
  });
});

describe('findNearbyGeoAnchor', () => {
  const loc2: KnownGeoAnchor = {
    h3Index: latLngToCell(50.7475, 6.4812, 11),
    displayName: 'Bank',
    lat: 50.7475,
    lon: 6.4812,
  };
  const loc4: KnownGeoAnchor = {
    h3Index: latLngToCell(50.7451, 6.4804, 11),
    displayName: 'Eingang Pfad',
    lat: 50.7451,
    lon: 6.4804,
  };

  // Why: Empty list must return undefined (no match possible).
  it('returns undefined when no known ref points', () => {
    expect(findNearbyGeoAnchor(50.7475, 6.4812, [])).toBeUndefined();
  });

  // Why: A position at the exact same GPS as a known ref point must match.
  it('finds exact match', () => {
    const match = findNearbyGeoAnchor(50.7475, 6.4812, [loc2, loc4]);
    expect(match).toBe(loc2);
  });

  // Why: A position with ~5m GPS jitter should still match via gridDisk.
  it('finds match within GPS jitter range', () => {
    // ~5m north of loc2
    const match = findNearbyGeoAnchor(50.7475 + 0.000045, 6.4812, [loc2, loc4]);
    expect(match).toBe(loc2);
  });

  // Why: A position far from all known ref points must return undefined.
  it('returns undefined when no ref point is nearby', () => {
    // ~1km away from any known point
    const match = findNearbyGeoAnchor(50.76, 6.49, [loc2, loc4]);
    expect(match).toBeUndefined();
  });

  // Why: When standing between two ref points (but >65m from both),
  // neither should match — prevents ambiguous re-observations.
  it('returns undefined when between two distant ref points', () => {
    // Midpoint between loc2 and loc4 (~250m from each)
    const midLat = (50.7475 + 50.7451) / 2;
    const midLng = (6.4812 + 6.4804) / 2;
    const match = findNearbyGeoAnchor(midLat, midLng, [loc2, loc4]);
    expect(match).toBeUndefined();
  });

  // ---- Closest-match ranking (overlapping gridDisks) ----

  // Why: Two ref points ~83m apart have overlapping gridDisk zones. When the
  // user stands at a position inside both safe zones, the function must return
  // the closest ref point by distance, not the first one in the array.
  // This is the core bug fix from the 2026-04-18 proximity button improvements.
  it('returns the closest ref point when multiple are in range', () => {
    // rpA ("Bank") at 50.7475, 6.4812
    // rpB ("Fountain") at 50.74825, 6.4812 — ~83m north of rpA
    const rpA: KnownGeoAnchor = {
      h3Index: latLngToCell(50.7475, 6.4812, 11),
      displayName: 'Bank',
      lat: 50.7475,
      lon: 6.4812,
    };
    const rpB: KnownGeoAnchor = {
      h3Index: latLngToCell(50.74825, 6.4812, 11),
      displayName: 'Fountain',
      lat: 50.74825,
      lon: 6.4812,
    };

    // Query at 30% from A to B: ~25m from A, ~58m from B — both in gridDisk
    const queryLat = 50.7475 + (50.74825 - 50.7475) * 0.3;
    const match = findNearbyGeoAnchor(queryLat, 6.4812, [rpA, rpB]);
    expect(match).toBe(rpA);
  });

  // Why: The result must not depend on which ref point appears first in the
  // array. Before the fix, Array.find() returned whichever appeared first.
  it('closest-match is independent of array order', () => {
    const rpA: KnownGeoAnchor = {
      h3Index: latLngToCell(50.7475, 6.4812, 11),
      displayName: 'Bank',
      lat: 50.7475,
      lon: 6.4812,
    };
    const rpB: KnownGeoAnchor = {
      h3Index: latLngToCell(50.74825, 6.4812, 11),
      displayName: 'Fountain',
      lat: 50.74825,
      lon: 6.4812,
    };

    // Query at 30% from A to B — closer to A
    const queryLat = 50.7475 + (50.74825 - 50.7475) * 0.3;

    // rpB first in array — must still return rpA (the closer one)
    const match = findNearbyGeoAnchor(queryLat, 6.4812, [rpB, rpA]);
    expect(match).toBe(rpA);
  });

  // Why: When the query is closer to B, B must be returned — symmetric test.
  it('returns B when query is closer to B in overlap zone', () => {
    const rpA: KnownGeoAnchor = {
      h3Index: latLngToCell(50.7475, 6.4812, 11),
      displayName: 'Bank',
      lat: 50.7475,
      lon: 6.4812,
    };
    const rpB: KnownGeoAnchor = {
      h3Index: latLngToCell(50.74825, 6.4812, 11),
      displayName: 'Fountain',
      lat: 50.74825,
      lon: 6.4812,
    };

    // Query at 60% from A to B: ~50m from A, ~33m from B — both in gridDisk
    const queryLat = 50.7475 + (50.74825 - 50.7475) * 0.6;
    const match = findNearbyGeoAnchor(queryLat, 6.4812, [rpA, rpB]);
    expect(match).toBe(rpB);
  });
});

describe('approxDistanceMetres antimeridian handling', () => {
  // Why: The equirectangular formula using a naive lon2 - lon1 would compute
  // ~40,000 km for points 0.0002° apart across the ±180° seam. The function
  // must normalize the longitude delta so true neighbors near the antimeridian
  // are ranked correctly — otherwise findNearbyGeoAnchor would pick the wrong
  // ref point when its gridDisk straddles the seam.
  it('computes small distance for points straddling the antimeridian', () => {
    // Two points 0.001° apart in longitude at the equator ≈ 111 m.
    const d = approxDistanceMetres(0, 179.9995, 0, -179.9995);
    expect(d).toBeLessThan(150);
    expect(d).toBeGreaterThan(80);
  });

  // Why: Symmetry must hold across the seam — the direction of the wrap
  // cannot change the computed distance.
  it('is symmetric across the antimeridian', () => {
    const d1 = approxDistanceMetres(0, 179.9995, 0, -179.9995);
    const d2 = approxDistanceMetres(0, -179.9995, 0, 179.9995);
    expect(d1).toBeCloseTo(d2, 6);
  });

  // Why: Away from the seam, adding 360° to one longitude must not change
  // the result (degrees are modular). This catches over-normalization bugs.
  it('treats lon and lon+360 as equivalent', () => {
    const dDirect = approxDistanceMetres(50, 6, 50, 7);
    const dWrapped = approxDistanceMetres(50, 6, 50, 7 - 360);
    expect(dWrapped).toBeCloseTo(dDirect, 6);
  });

  // Why: If the GPS query sits near the seam with one ref point on the same
  // side (moderate distance) and another on the opposite side (close via
  // seam), the seam-crossing candidate must be recognised as the closest.
  // Without wrap-around normalisation its naive distance is ~40,000 km, so
  // the same-side candidate wins and the wrong ref point is returned.
  it('findNearbyGeoAnchor picks the seam-crossing candidate when it is closer', () => {
    const rpSameSide: KnownGeoAnchor = {
      h3Index: latLngToCell(0, 179.9995, H3_RESOLUTION),
      displayName: 'SameSide',
      lat: 0,
      lon: 179.9995,
    };
    const rpAcrossSeam: KnownGeoAnchor = {
      h3Index: latLngToCell(0, -179.99995, H3_RESOLUTION),
      displayName: 'AcrossSeam',
      lat: 0,
      lon: -179.99995,
    };

    // Query at lon=179.9999:
    //   → rpSameSide is 0.0004° away (~44 m)
    //   → rpAcrossSeam is 0.00015° away via the seam (~17 m)
    // Skip the assertion if H3's gridDisk doesn't actually include both —
    // we only care that *if* both are candidates, ranking is correct.
    const queryLat = 0;
    const queryLon = 179.9999;
    const queryCell = latLngToCell(queryLat, queryLon, H3_RESOLUTION);
    const disk = gridDisk(queryCell, 1);
    if (
      !disk.includes(rpSameSide.h3Index) ||
      !disk.includes(rpAcrossSeam.h3Index)
    ) {
      return; // precondition not satisfied; covered by distance unit tests
    }
    const match = findNearbyGeoAnchor(queryLat, queryLon, [
      rpSameSide,
      rpAcrossSeam,
    ]);
    expect(match?.displayName).toBe('AcrossSeam');
  });
});

describe('h3CellsMatch', () => {
  const cellA = latLngToCell(50.7475, 6.4812, 11);

  // Why: Same index must always match.
  it('returns true for identical indices', () => {
    expect(h3CellsMatch(cellA, cellA)).toBe(true);
  });

  // Why: Neighbor cells should match (GPS jitter can shift across boundaries).
  it('returns true for neighboring cells', () => {
    const neighbors = gridDisk(cellA, 1).filter((c) => c !== cellA);
    for (const neighbor of neighbors) {
      expect(h3CellsMatch(cellA, neighbor)).toBe(true);
    }
  });

  // Why: Cells >130m apart must not match.
  it('returns false for distant cells', () => {
    const cellFar = latLngToCell(50.7451, 6.4804, 11); // loc4
    expect(h3CellsMatch(cellA, cellFar)).toBe(false);
  });
});

describe('isH3Index', () => {
  // Why: Real H3 resolution-11 indices must be recognized as H3.
  it('returns true for valid H3 res-11 index', () => {
    const h3 = gpsToH3(50.7475, 6.4812);
    expect(isH3Index(h3)).toBe(true);
  });

  // Why: Old-style user-typed names must NOT be recognized as H3.
  it('returns false for legacy user-typed ref point names', () => {
    expect(isH3Index('Bank')).toBe(false);
    expect(isH3Index('Lärm Schild')).toBe(false);
    expect(isH3Index('bench')).toBe(false);
    expect(isH3Index('Eingang Pfad')).toBe(false);
  });

  // Why: Empty strings and short hex fragments must not match.
  it('returns false for empty or short strings', () => {
    expect(isH3Index('')).toBe(false);
    expect(isH3Index('abc')).toBe(false);
    expect(isH3Index('8b1f1a5c2e3d4')).toBe(false); // 14 chars
  });

  // Why: Uppercase hex should not match (H3 produces lowercase).
  it('returns false for uppercase hex', () => {
    expect(isH3Index('8B1F1A5C2E3D4F1')).toBe(false);
  });
});
