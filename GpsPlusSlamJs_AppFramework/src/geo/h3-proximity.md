# h3-proximity.ts

## Purpose

Shared H3 hexagonal grid utilities for reference point identity and matching. Replaces user-typed string IDs with deterministic GPS-derived H3 indices.

## Public API

| Symbol                 | Signature                                                             | Description                                                                                                   |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `H3_RESOLUTION`        | `11` (const)                                                          | H3 resolution: ~25m edge, ~65m gridDisk safe zone                                                             |
| `KnownGeoAnchor`        | `{ h3Index: string; displayName?: string; lat: number; lon: number }` | Interface for proximity matching (lat/lon needed for distance ranking)                                        |
| `approxDistanceMetres` | `(lat1, lon1, lat2, lon2) => number`                                  | Equirectangular distance approximation, accurate < 1 km                                                       |
| `gpsToH3`              | `(lat: number, lng: number) => string`                                | Compute H3 res-11 index from GPS                                                                              |
| `findNearbyGeoAnchor`   | `(lat, lng, KnownGeoAnchors) => KnownGeoAnchor \| undefined`            | Find closest ref point within gridDisk(cell, 1) safe zone; ranks by distance when multiple candidates overlap |
| `h3CellsMatch`          | `(h3a: string, h3b: string) => boolean`                               | Cross-session matching: checks if two H3 indices are within each other's gridDisk(cell, 1)                    |
| `isH3Index`            | `(id: string) => boolean`                                             | Checks if a string looks like an H3 res-11 index (15-char lowercase hex)                                      |

## Invariants & Assumptions

- H3 resolution 11 produces 15-character lowercase hex strings
- `gridDisk(cell, 1)` returns 7 cells (center + 6 neighbors), radius ~65m
- Same physical location within ~25m GPS jitter always lands in the same cell or a neighbor
- Ref points >130m apart always produce non-overlapping gridDisk zones
- When multiple ref points fall in the gridDisk safe zone (65–130 m apart), `findNearbyGeoAnchor` returns the closest by equirectangular distance — result is independent of array order
- `h3CellsMatch` is NOT symmetric in edge cases (gridDisk overlap is checked from A to B only), but for res-11 this is practically symmetric

## Examples

```ts
const h3 = gpsToH3(50.7475, 6.4812); // "8b1f1a5c2e3d4f1"
const match = findNearbyGeoAnchor(50.7475, 6.4812, [
  { h3Index: h3, displayName: 'Bank', lat: 50.7475, lon: 6.4812 },
]);
// match === { h3Index: "8b1f1a5c2e3d4f1", displayName: "Bank", lat: 50.7475, lon: 6.4812 }
h3CellsMatch(h3, h3); // true
isH3Index(h3); // true
isH3Index('Bank'); // false

// Distance helper
approxDistanceMetres(50.7475, 6.4812, 50.74825, 6.4812); // ~83 m
```

## Tests

- `h3-ref-point.test.ts` — 25 tests covering h3-js integration, gpsToH3, findNearbyGeoAnchor (including closest-match ranking), h3CellsMatch, isH3Index
- `h3-ref-point.property.test.ts` — 5 property-based tests for distance helper metrics and closest-match array-order independence
- `h3-retroactive.test.ts` (in investigation/) — 4 tests validating H3 consistency on real rec3-rec5 recordings
