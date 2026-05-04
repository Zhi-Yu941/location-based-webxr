/**
 * Geo module — H3-based proximity matching for geo-anchored points.
 */

export {
  H3_RESOLUTION,
  type KnownGeoAnchor,
  approxDistanceMetres,
  gpsToH3,
  findNearbyGeoAnchor,
  h3CellsMatch,
  isH3Index,
} from './h3-proximity.js';
