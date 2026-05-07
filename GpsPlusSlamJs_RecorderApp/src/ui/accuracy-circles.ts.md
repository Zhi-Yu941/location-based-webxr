# `accuracy-circles.ts`

## Purpose

Shared helper for drawing per-event GPS accuracy circles on a Leaflet map.
Used by both [preview-map.ts](preview-map.ts) (replay setup screen) and
[summary-map.ts](summary-map.ts) (session summary panel) so the two views stay
visually consistent and future style changes only happen in one place.

## Public API

- `ACCURACY_CIRCLE_FILL_OPACITY` / `ACCURACY_CIRCLE_STROKE_OPACITY` /
  `ACCURACY_CIRCLE_WEIGHT` — style constants applied to every circle.
- `AccuracyCircleSample` — minimal sample shape (`lat`, `lng`, optional
  `accuracy` in meters). Both `RawGpsSample` and `GpsPathCoord` are
  structurally compatible.
- `addAccuracyCircles(map, samples, color): L.Circle[]` — adds one
  transparent circle per sample with a finite positive `accuracy`. Returns
  the created circles so callers tracking layers for cleanup can append them
  to their layer list.

## Invariants & assumptions

- A sample is rendered iff `typeof accuracy === 'number'`, `Number.isFinite`,
  and `accuracy > 0`. Pre-accuracy recordings (no field) and bad values
  (`0`, negative, `NaN`) are silently skipped — the polyline path still
  renders, see the existing tests in [preview-map.test.ts](preview-map.test.ts)
  and [summary-map.test.ts](summary-map.test.ts).
- Circles are added immediately. Callers must invoke this BEFORE adding the
  polyline so the line stays visually on top.
- Circle radius is interpreted by Leaflet as meters.

## Examples

```ts
const circles = addAccuracyCircles(map, gpsPath, RAW_GPS_COLOR);
layers.push(...circles); // for later cleanup
L.polyline(latLngs, { color: RAW_GPS_COLOR }).addTo(map);
```

## Tests

- [accuracy-circles.test.ts](accuracy-circles.test.ts) — unit tests for the
  filtering rules and applied options.
- The behavior is also exercised end-to-end via
  [preview-map.test.ts](preview-map.test.ts) and
  [summary-map.test.ts](summary-map.test.ts).
