/**
 * H3 Geo-Anchor Proximity Matching
 *
 * Generic utility for matching GPS positions to known geo-anchored points
 * using H3 hexagonal grid indices. Uses gridDisk(cell, 1) to create a ~65m
 * safe zone that absorbs GPS jitter of 3-10m.
 *
 * Renamed from `ref-points/h3-ref-point.ts` in Iter 4 to drop recorder-only
 * naming. The math is unchanged; only the public type/function names were
 * generalised so the framework can serve any geo-anchored consumer.
 *
 * @see docs/2026-03-08-ref-point-naming-investigation.md §6
 */

import { latLngToCell, gridDisk } from 'h3-js';

/** H3 resolution 11: ~25m edge, ~65m gridDisk safe zone */
export const H3_RESOLUTION = 11;

/**
 * A known geo-anchored point with its H3 cell index and GPS coordinates,
 * used for proximity matching. GPS coordinates are needed to rank
 * multiple candidates by distance when their gridDisk zones overlap.
 */
export interface KnownGeoAnchor {
  readonly h3Index: string;
  readonly displayName?: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Compute the H3 resolution-11 index for a GPS position.
 */
export function gpsToH3(lat: number, lng: number): string {
  return latLngToCell(lat, lng, H3_RESOLUTION);
}

/**
 * Approximate distance in metres using equirectangular projection.
 * Accurate to < 0.1% for distances under 1 km at mid-latitudes,
 * which is sufficient for ranking ref point candidates within a
 * gridDisk safe zone (~65–130 m).
 */
export function approxDistanceMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  // Normalise longitude delta to (-180, 180] so points straddling the ±180°
  // antimeridian (or lon values offset by whole turns) yield the short-way
  // distance instead of a spurious ~40,000 km wrap.
  let dLonDeg = lon2 - lon1;
  dLonDeg -= 360 * Math.floor((dLonDeg + 180) / 360);
  const dLon = (dLonDeg * Math.PI) / 180;
  const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const x = dLon * cosLat;
  return R * Math.sqrt(dLat * dLat + x * x);
}

/**
 * Find the known geo-anchor closest to the given GPS position,
 * provided it falls within the gridDisk safe zone.
 *
 * The safe zone is the center cell plus its 6 neighbors (~65m radius),
 * which absorbs GPS jitter of 3-10m while keeping anchors >130m apart
 * distinguishable.
 *
 * When multiple anchors have overlapping safe zones (65–130 m apart),
 * the closest one by equirectangular distance is returned.
 */
export function findNearbyGeoAnchor(
  lat: number,
  lng: number,
  knownAnchors: readonly KnownGeoAnchor[]
): KnownGeoAnchor | undefined {
  if (knownAnchors.length === 0) {
    return undefined;
  }
  const currentCell = latLngToCell(lat, lng, H3_RESOLUTION);
  const safeZone = gridDisk(currentCell, 1);

  const candidates = knownAnchors.filter((rp) =>
    safeZone.includes(rp.h3Index)
  );

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Multiple matches — return the closest by approximate distance
  return candidates.reduce((closest, rp) => {
    const distRp = approxDistanceMetres(lat, lng, rp.lat, rp.lon);
    const distClosest = approxDistanceMetres(
      lat,
      lng,
      closest.lat,
      closest.lon
    );
    return distRp < distClosest ? rp : closest;
  });
}

/**
 * Check whether two H3 indices refer to the same physical location
 * (i.e., one falls within the other's gridDisk safe zone).
 * This is the canonical cross-session matching check.
 */
export function h3CellsMatch(h3a: string, h3b: string): boolean {
  if (h3a === h3b) {
    return true;
  }
  const diskA = gridDisk(h3a, 1);
  return diskA.includes(h3b);
}

/** H3 resolution-11 indices are 15-character lowercase hex strings. */
const H3_INDEX_PATTERN = /^[0-9a-f]{15}$/;

/**
 * Check whether a string looks like a valid H3 resolution-11 index.
 * Used to distinguish H3 IDs from legacy user-typed string IDs.
 */
export function isH3Index(id: string): boolean {
  return H3_INDEX_PATTERN.test(id);
}
