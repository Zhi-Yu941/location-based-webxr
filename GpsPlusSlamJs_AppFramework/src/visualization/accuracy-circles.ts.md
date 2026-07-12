# `accuracy-circles.ts`

## Purpose

Shared helper for drawing per-event GPS accuracy circles on a Leaflet map.
Home of the canonical implementation (app-framework, per D4 of the
unified-map plan). Reused by the framework's
[map-overlay-draw.ts](map-overlay-draw.ts) and — via a thin re-export — by the
recorder app's `ui/preview-map.ts` (replay setup) and `ui/summary-map.ts`
(session summary). Keeping one implementation means future style changes only
happen here.

## Public API

- `ACCURACY_CIRCLE_STROKE_OPACITY` / `ACCURACY_CIRCLE_WEIGHT` — style constants
  applied to every circle's stroke.
- `ACCURACY_CIRCLE_FILL_OPACITY` — **deprecated** (stroke-only since 2026-06-28,
  Finding 1). No longer passed to `L.circle`; retained only to preserve the
  published API surface.
- `AccuracyCircleSample` — minimal sample shape (`lat`, `lng`, optional
  `accuracy` in meters). `RawGpsSample` is structurally compatible.
- `addAccuracyCircles(map, samples, color): L.Circle[]` — adds one
  **stroke-only** (un-filled) circle per sample with a finite positive
  `accuracy`. Returns the created circles so callers tracking layers for
  cleanup can append them.

## Invariants & assumptions

- A sample is rendered iff `typeof accuracy === 'number'`, `Number.isFinite`,
  and `accuracy > 0`. Pre-accuracy recordings (no field) and bad values
  (`0`, negative, `NaN`, `Infinity`) are silently skipped — the polyline path
  still renders.
- Circles are added immediately. Callers must invoke this BEFORE adding the
  polyline so the line stays visually on top.
- Circle radius is interpreted by Leaflet as meters.
- **Stroke-only — no fill** (`fill: false`). Leaflet composites overlapping
  semi-transparent SVG fills, so filled circles reach `1 − (1 − fillOpacity)^N`
  opacity over N overlaps and paint the basemap solid on dense recordings. An
  outline never accumulates an opaque interior, so the basemap shows through at
  any overlap density. This is the locked decision of Finding 1
  (`GpsPlusSlamJs_Docs/docs/2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md`).

## Examples

```ts
const circles = addAccuracyCircles(map, gpsPath, RAW_GPS_COLOR);
layers.push(...circles); // for later cleanup
L.polyline(latLngs, { color: RAW_GPS_COLOR }).addTo(map);
```

## Tests

- [accuracy-circles.test.ts](accuracy-circles.test.ts) — filtering rules and
  applied options.
- Also exercised end-to-end via the recorder's `preview-map.test.ts` and
  `summary-map.test.ts`, and via [map-overlay-draw.test.ts](map-overlay-draw.test.ts).
