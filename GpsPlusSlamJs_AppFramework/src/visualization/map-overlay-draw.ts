/**
 * Shared map-overlay-drawing module.
 *
 * `drawMapData` is the SINGLE Leaflet drawing routine rendered by BOTH map
 * consumers — the live/replay 3D overlay (`LeafletMapOverlay`) and the 2D
 * session-summary map (`createSummaryMap`). Centralising the drawing here is
 * Phase 3 of the map-system review and the fix for Findings 1 & 4 of the
 * unified-trajectory-map user feedback: previously each renderer drew the
 * trajectory by hand and the two visibly diverged.
 *
 * It consumes the resolved {@link MapData} produced by `buildMapData` and adds,
 * in this order:
 *   1. per-event accuracy circles for the raw GPS path (drawn first so the
 *      polyline stays on top), then the raw GPS polyline;
 *   2. the fused (SLAM+GPS) polyline;
 *   3. the alignment-snapshot polyline;
 *   4. (optional) a user-position marker — a dot plus, when `userHeadingDeg`
 *      is set, a thin view-direction line rotated to that true-north bearing.
 *
 * SCOPE: this module draws only the genuinely-shared SLAM/GPS trajectory
 * layers. Reference-point markers are a RECORDER concept and are drawn by the
 * recorder-owned `ui/draw-ref-point-markers.ts` helper (called from both the
 * summary map and the live overlay wiring), so the two maps stay identical
 * while the framework remains ref-point-agnostic. See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md
 * § Step 5.
 *
 * The caller owns map creation, tile layer, `fitBounds`, resize handling and
 * fullscreen — this module only draws data layers and reports the accumulated
 * bounds so the caller can frame the view.
 */

import L from 'leaflet';
import type { MapData } from './map-data.js';
import { VIS_COLORS } from './vis-colors.js';
import { addAccuracyCircles } from './accuracy-circles.js';

// ============================================================================
// Constants
// ============================================================================

/** Raw GPS polyline + accuracy-circle color (yellow). */
export const RAW_GPS_COLOR = VIS_COLORS.RAW_GPS.css;
/** Fused SLAM+GPS polyline color (cyan). */
export const FUSED_PATH_COLOR = VIS_COLORS.FUSED_VIO.css;
/** Alignment-snapshot polyline color (red). */
export const ALIGNMENT_SNAPSHOT_COLOR = VIS_COLORS.ALIGNMENT_SNAPSHOT.css;
/** User-position marker color (blue). */
export const USER_POSITION_COLOR = VIS_COLORS.USER_POSITION.css;

/** Polyline weight (px) — matches the recorder's `PATH_POLYLINE_WEIGHT`. */
export const MAP_PATH_POLYLINE_WEIGHT = 3;
/** Polyline opacity — matches the recorder's `PATH_POLYLINE_OPACITY`. */
export const MAP_PATH_POLYLINE_OPACITY = 0.8;

/**
 * Length (px) of the user view-direction line. A FIXED pixel length (not a
 * metric distance): the line is a direction-only indicator drawn inside the
 * user-position divIcon, so it stays the same size at every zoom level.
 * Module-private — internal styling detail, not part of the public surface.
 */
const USER_HEADING_LINE_LENGTH_PX = 28;

/**
 * Build the inner HTML for the user-position divIcon: a centered dot, plus —
 * when `headingDeg` is a finite bearing — a thin line rotated to that absolute
 * (true-north) heading. The line lives in a zero-size wrapper centered on the
 * dot and rotated by CSS, so North (0°) points up and the line keeps a fixed
 * pixel length regardless of map zoom. A null/undefined/non-finite heading
 * yields the dot alone (Finding 2: fallback when the camera is near-vertical or
 * before the first alignment solve).
 */
function buildUserMarkerHtml(headingDeg: number | null | undefined): string {
  const dot = `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:${USER_POSITION_COLOR};width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>`;
  if (typeof headingDeg !== 'number' || !Number.isFinite(headingDeg)) {
    return dot;
  }
  const line = `<div style="position:absolute;left:50%;top:50%;transform:rotate(${headingDeg}deg);"><div class="map-overlay-user-heading" style="position:absolute;left:-1px;bottom:0;width:2px;height:${USER_HEADING_LINE_LENGTH_PX}px;background:${USER_POSITION_COLOR};"></div></div>`;
  // Line first so the dot renders on top of the line's base.
  return `${line}${dot}`;
}

// ============================================================================
// Types
// ============================================================================

/** Options controlling optional layers drawn by {@link drawMapData}. */
export interface DrawMapDataOptions {
  /**
   * Draw a user-position marker when `MapData.userPosition` is set. Off by
   * default — the summary map shows the path only; the live overlay opts in.
   */
  showUserPosition?: boolean;
}

/** Result of {@link drawMapData}: the created layers and accumulated bounds. */
export interface DrawnMapData {
  /** Every Leaflet layer created, in draw order, for later cleanup. */
  layers: L.Layer[];
  /** Bounds spanning every drawn coordinate; use `.isValid()` before fitting. */
  bounds: L.LatLngBounds;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Draw a {@link MapData} snapshot onto an existing Leaflet map.
 *
 * @param map - Target map (already created with a tile layer by the caller).
 * @param data - Resolved trajectory data from `buildMapData`.
 * @param options - Optional layer toggles (see {@link DrawMapDataOptions}).
 * @returns The created layers and the bounds spanning every drawn coordinate.
 */
export function drawMapData(
  map: L.Map,
  data: MapData,
  options: DrawMapDataOptions = {}
): DrawnMapData {
  const layers: L.Layer[] = [];
  const bounds = L.latLngBounds([]);

  // 1. Raw GPS: accuracy circles first (so the polyline stays on top), then line.
  if (data.rawGpsPath.length > 0) {
    const rawLatLngs = data.rawGpsPath.map(
      (p) => [p.lat, p.lng] as L.LatLngTuple
    );

    const circles = addAccuracyCircles(map, data.rawGpsPath, RAW_GPS_COLOR);
    layers.push(...circles);

    const rawPolyline = L.polyline(rawLatLngs, {
      color: RAW_GPS_COLOR,
      weight: MAP_PATH_POLYLINE_WEIGHT,
      opacity: MAP_PATH_POLYLINE_OPACITY,
    }).addTo(map);
    layers.push(rawPolyline);

    for (const ll of rawLatLngs) {
      bounds.extend(ll);
    }
  }

  // 2. Fused SLAM+GPS polyline.
  if (data.fusedPath.length > 0) {
    const fusedLatLngs = data.fusedPath.map(
      (p) => [p.lat, p.lng] as L.LatLngTuple
    );
    const fusedPolyline = L.polyline(fusedLatLngs, {
      color: FUSED_PATH_COLOR,
      weight: MAP_PATH_POLYLINE_WEIGHT,
      opacity: MAP_PATH_POLYLINE_OPACITY,
    }).addTo(map);
    layers.push(fusedPolyline);

    for (const ll of fusedLatLngs) {
      bounds.extend(ll);
    }
  }

  // 3. Alignment-snapshot polyline.
  if (data.alignmentSnapshots.length > 0) {
    const snapshotLatLngs = data.alignmentSnapshots.map(
      (p) => [p.lat, p.lng] as L.LatLngTuple
    );
    const snapshotPolyline = L.polyline(snapshotLatLngs, {
      color: ALIGNMENT_SNAPSHOT_COLOR,
      weight: MAP_PATH_POLYLINE_WEIGHT,
      opacity: MAP_PATH_POLYLINE_OPACITY,
    }).addTo(map);
    layers.push(snapshotPolyline);

    for (const ll of snapshotLatLngs) {
      bounds.extend(ll);
    }
  }

  // 4. Optional user-position marker (dot) + optional view-direction line.
  if (options.showUserPosition && data.userPosition) {
    const icon = L.divIcon({
      className: 'map-overlay-user-position',
      html: buildUserMarkerHtml(data.userHeadingDeg),
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const marker = L.marker([data.userPosition.lat, data.userPosition.lng], {
      icon,
    }).addTo(map);
    layers.push(marker);

    bounds.extend([data.userPosition.lat, data.userPosition.lng]);
  }

  return { layers, bounds };
}
