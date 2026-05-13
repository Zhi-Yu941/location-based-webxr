/**
 * Shared OSM base-map setup and path style tokens for Leaflet map views.
 *
 * Both `preview-map.ts` (replay setup screen) and `summary-map.ts` (session
 * summary panel) render an OpenStreetMap basemap with the same tile URL,
 * attribution, and zoom limit, and draw GPS paths with the same line weight
 * and opacity. Centralising those values here keeps the two views visually
 * consistent and avoids accidental drift on future tweaks.
 *
 * Scope intentionally narrow: only the truly identical pieces live here.
 * View-specific concerns (fullscreen toggle, multi-path layering, ref-point
 * markers, resize delays) stay in their respective files.
 */

import L from 'leaflet';

// ============================================================================
// OpenStreetMap basemap
// ============================================================================

/** OSM raster tile URL template (subdomains a/b/c). */
export const OSM_TILE_URL =
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Attribution required by the OSM tile policy. */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Maximum zoom level supported by OSM raster tiles. Going beyond this
 * yields blurry up-scaled tiles, so both views cap here.
 */
export const OSM_MAX_ZOOM = 19;

/**
 * Add the standard OSM tile layer to `map` and return it so the caller can
 * track it for cleanup. The caller decides ordering relative to other layers.
 */
export function addOsmTileLayer(map: L.Map): L.TileLayer {
  return L.tileLayer(OSM_TILE_URL, {
    attribution: OSM_ATTRIBUTION,
    maxZoom: OSM_MAX_ZOOM,
  }).addTo(map);
}

// ============================================================================
// Shared path/view style tokens
// ============================================================================

/**
 * Stroke weight (in pixels) for GPS path polylines. Both views use the same
 * value so raw, fused, and snapshot polylines render at a consistent
 * thickness across screens.
 */
export const PATH_POLYLINE_WEIGHT = 3;

/**
 * Stroke opacity for GPS path polylines. Slightly transparent so overlapping
 * paths (raw + fused) remain distinguishable.
 */
export const PATH_POLYLINE_OPACITY = 0.8;

/**
 * Initial zoom level used when centering on the first GPS point before
 * `fitBounds` runs. Picked to roughly show a city block.
 */
export const INITIAL_ZOOM = 15;

/**
 * Padding (in pixels) passed to `map.fitBounds` so markers and accuracy
 * circles aren't clipped at the edges.
 */
export const FIT_BOUNDS_PADDING: L.PointTuple = [20, 20];
