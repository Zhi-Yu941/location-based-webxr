/**
 * Shared helper for drawing per-event GPS accuracy circles on a Leaflet map.
 *
 * Used by both `preview-map.ts` (replay setup screen) and `summary-map.ts`
 * (session summary panel) so the two views stay visually consistent and
 * future style changes only need to happen in one place.
 */

import L from 'leaflet';

// ============================================================================
// Style constants
// ============================================================================

/**
 * Style for per-event GPS accuracy circles. Radius comes from the GPS event's
 * horizontal accuracy in meters; larger circles mean lower-quality fixes.
 * Filled and stroked with a highly transparent variant of the path color so
 * overlapping circles remain legible without obscuring the basemap or the
 * polyline drawn on top.
 */
export const ACCURACY_CIRCLE_FILL_OPACITY = 0.12;
export const ACCURACY_CIRCLE_STROKE_OPACITY = 0.5;
export const ACCURACY_CIRCLE_WEIGHT = 1;

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal shape required to render an accuracy circle. Intentionally narrower
 * than `RawGpsSample` / `GpsPathCoord` so any caller with `lat`/`lng` and an
 * optional `accuracy` (meters) can use this helper without coupling to a
 * specific GPS-sample type.
 */
export interface AccuracyCircleSample {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy?: number;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Draw one transparent circle per sample whose `accuracy` is a finite
 * positive number. Samples without a usable accuracy value are skipped so
 * pre-accuracy recordings still render their polyline.
 *
 * Circles are added to `map` immediately. The caller is responsible for
 * draw-order: invoke this BEFORE adding the polyline so the line stays
 * visually on top of the circles.
 *
 * @param map - The Leaflet map to add circles to.
 * @param samples - GPS samples to consider; non-positive / non-finite
 *   `accuracy` values are silently skipped.
 * @param color - CSS color string used for both stroke and fill.
 * @returns The created `L.Circle` instances, in the order they were added.
 *   Callers that track layers for cleanup can append these to their list.
 */
export function addAccuracyCircles(
  map: L.Map,
  samples: readonly AccuracyCircleSample[],
  color: string
): L.Circle[] {
  const circles: L.Circle[] = [];
  for (const sample of samples) {
    if (
      typeof sample.accuracy !== 'number' ||
      !Number.isFinite(sample.accuracy) ||
      sample.accuracy <= 0
    ) {
      continue;
    }
    const circle = L.circle([sample.lat, sample.lng], {
      radius: sample.accuracy,
      color,
      weight: ACCURACY_CIRCLE_WEIGHT,
      opacity: ACCURACY_CIRCLE_STROKE_OPACITY,
      fillColor: color,
      fillOpacity: ACCURACY_CIRCLE_FILL_OPACITY,
    }).addTo(map);
    circles.push(circle);
  }
  return circles;
}
