/**
 * Summary Map Component
 *
 * Leaflet-based 2D map for the session summary panel.
 * Displays the recorded path with:
 * - Yellow polyline: Raw GPS readings
 * - Cyan polyline: Fused GPS+SLAM aligned positions
 * - Markers: Reference points with labels
 *
 * User Feedback Issue #4 (2026-01-27):
 * "In the final report screen when I clicked 'Stop' I would like to be able
 * to see the map with the path the user walked (both the raw GPS path and
 * the fused GPS+SLAM path)."
 */

import L from 'leaflet';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type {
  GpsCoord,
  RawGpsSample,
  RefPointMarker,
} from 'gps-plus-slam-app-framework/types/geo-types';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import { addAccuracyCircles } from './accuracy-circles';

const log = createLogger('SummaryMap');

// ============================================================================
// Types
// ============================================================================

/** Data required to render the summary map */
export interface SummaryMapData {
  /**
   * Raw GPS positions (yellow polyline). When samples include `accuracy`
   * (in meters), a transparent yellow circle of that radius is drawn at
   * each point so users can visually distinguish accurate from noisy fixes.
   */
  rawGpsPath: RawGpsSample[];
  /** Fused/aligned positions (cyan polyline) */
  fusedPath: GpsCoord[];
  /** Reference points with markers */
  referencePoints: RefPointMarker[];
  /** Alignment snapshot GPS positions (red dots) — Issue #1 */
  alignmentSnapshots?: GpsCoord[];
}

/** Summary map instance with cleanup and fullscreen methods */
export interface SummaryMapInstance {
  /** Clean up Leaflet resources */
  destroy: () => void;
  /** Expand map to fullscreen overlay */
  expand: () => void;
  /** Collapse map back to inline view */
  collapse: () => void;
  /** Whether the map is currently in fullscreen mode */
  isExpanded: () => boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Colors matching the 3D visualization — re-exported from vis-colors.ts */
export const RAW_GPS_COLOR = VIS_COLORS.RAW_GPS.css;
export const FUSED_PATH_COLOR = VIS_COLORS.FUSED_VIO.css;
export const REF_POINT_COLOR = VIS_COLORS.CURRENT_REF_POINT.css;
export const ALIGNMENT_SNAPSHOT_COLOR = VIS_COLORS.ALIGNMENT_SNAPSHOT.css;

/** OpenStreetMap tile URL */
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** CSS classes added in fullscreen mode */
const FULLSCREEN_CLASSES = ['fixed', 'inset-0', 'z-[60]'];
/** CSS classes removed in fullscreen mode (restored on collapse) */
const INLINE_CLASSES = ['h-48', 'rounded-lg'];
/** Delay (ms) before calling invalidateSize after a resize transition */
const RESIZE_DELAY_MS = 300;

/** Polyline style settings */
const POLYLINE_WEIGHT = 3;
const POLYLINE_OPACITY = 0.8;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a summary map in the given container.
 *
 * @param container - DOM element to render the map into
 * @param data - GPS paths and reference points to display
 * @returns Map instance with destroy() method, or null if creation failed
 */
export function createSummaryMap(
  container: HTMLElement | null,
  data: SummaryMapData
): SummaryMapInstance | null {
  // Validate container
  if (!container) {
    log.warn('Cannot create summary map: container is null');
    return null;
  }

  // Narrow type for closures (TS can't narrow the parameter in nested functions)
  const mapContainer = container;

  // Validate data - need at least one GPS point to show anything
  if (data.rawGpsPath.length === 0 && data.fusedPath.length === 0) {
    log.warn('Cannot create summary map: no GPS path data');
    return null;
  }

  try {
    // Determine initial center from first GPS point
    const firstPoint = data.rawGpsPath[0] ?? data.fusedPath[0]!;
    const map = L.map(mapContainer).setView(
      [firstPoint.lat, firstPoint.lng],
      15
    );

    // Add OSM tile layer
    const tileLayer = L.tileLayer(OSM_TILE_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    // Track all layers for cleanup
    const layers: L.Layer[] = [tileLayer];

    // Create bounds for auto-fit
    const bounds = L.latLngBounds([]);

    // Add raw GPS polyline (yellow)
    if (data.rawGpsPath.length > 0) {
      const rawLatLngs = data.rawGpsPath.map(
        (p) => [p.lat, p.lng] as L.LatLngTuple
      );

      // Per-event accuracy circles (transparent, sized by horizontal accuracy
      // in meters). Drawn BEFORE the polyline so the line stays visually on
      // top. Shared with `preview-map.ts` via `accuracy-circles.ts`.
      const circles = addAccuracyCircles(map, data.rawGpsPath, RAW_GPS_COLOR);
      layers.push(...circles);

      const rawPolyline = L.polyline(rawLatLngs, {
        color: RAW_GPS_COLOR,
        weight: POLYLINE_WEIGHT,
        opacity: POLYLINE_OPACITY,
      }).addTo(map);
      layers.push(rawPolyline);

      // Extend bounds
      for (const ll of rawLatLngs) {
        bounds.extend(ll);
      }
    }

    // Add fused path polyline (cyan)
    if (data.fusedPath.length > 0) {
      const fusedLatLngs = data.fusedPath.map(
        (p) => [p.lat, p.lng] as L.LatLngTuple
      );
      const fusedPolyline = L.polyline(fusedLatLngs, {
        color: FUSED_PATH_COLOR,
        weight: POLYLINE_WEIGHT,
        opacity: POLYLINE_OPACITY,
      }).addTo(map);
      layers.push(fusedPolyline);

      // Extend bounds
      for (const ll of fusedLatLngs) {
        bounds.extend(ll);
      }
    }

    // Add reference point markers
    for (const refPoint of data.referencePoints) {
      // Inline HTML is intentional: simple static icon, no user input, standard Leaflet pattern
      const icon = L.divIcon({
        className: 'summary-map-ref-point',
        html: `<div style="background:${REF_POINT_COLOR};width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const popupContent = document.createElement('b');
      popupContent.textContent = `📍 ${refPoint.name}`;

      const marker = L.marker([refPoint.lat, refPoint.lng], { icon })
        .bindPopup(popupContent)
        .addTo(map);
      layers.push(marker);

      bounds.extend([refPoint.lat, refPoint.lng]);
    }

    // Add alignment snapshot polyline (red)
    if (data.alignmentSnapshots && data.alignmentSnapshots.length > 0) {
      const snapshotLatLngs = data.alignmentSnapshots.map(
        (p) => [p.lat, p.lng] as L.LatLngTuple
      );
      const snapshotPolyline = L.polyline(snapshotLatLngs, {
        color: ALIGNMENT_SNAPSHOT_COLOR,
        weight: POLYLINE_WEIGHT,
        opacity: POLYLINE_OPACITY,
      }).addTo(map);
      layers.push(snapshotPolyline);

      for (const ll of snapshotLatLngs) {
        bounds.extend(ll);
      }
    }

    // Fit bounds if we have valid bounds
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    // Force a resize in case container wasn't visible initially
    const resizeTimeoutId = setTimeout(() => map.invalidateSize(), 100);

    log.info('Summary map created', {
      rawPoints: data.rawGpsPath.length,
      fusedPoints: data.fusedPath.length,
      refPoints: data.referencePoints.length,
    });

    // Track if already destroyed to prevent double cleanup
    let destroyed = false;
    let expanded = false;
    let expandResizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // --- Fullscreen toggle buttons ---
    const expandBtn = document.createElement('button');
    expandBtn.setAttribute('data-testid', 'btn-map-expand');
    expandBtn.className =
      'absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 text-white rounded-lg w-9 h-9 flex items-center justify-center text-lg shadow-md transition-colors';
    expandBtn.textContent = '⛶';
    expandBtn.title = 'Enlarge map';

    const collapseBtn = document.createElement('button');
    collapseBtn.setAttribute('data-testid', 'btn-map-collapse');
    collapseBtn.className =
      'absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 text-white rounded-lg w-9 h-9 flex items-center justify-center text-lg shadow-md transition-colors hidden';
    collapseBtn.textContent = '✕';
    collapseBtn.title = 'Close fullscreen';

    // Ensure the container supports absolute positioning of child buttons
    if (
      !mapContainer.style.position &&
      !mapContainer.classList.contains('relative')
    ) {
      mapContainer.classList.add('relative');
    }
    mapContainer.appendChild(expandBtn);
    mapContainer.appendChild(collapseBtn);

    // --- Expand / collapse helpers ---

    /**
     * Schedule an `invalidateSize` + `fitBounds` after the CSS transition has
     * settled. Shared by `doExpand` / `doCollapse` so the resize logic and the
     * timeout-cancellation guard live in exactly one place.
     */
    function scheduleResizeRefit(): void {
      if (expandResizeTimeoutId !== null) {
        clearTimeout(expandResizeTimeoutId);
      }
      expandResizeTimeoutId = setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [20, 20] });
      }, RESIZE_DELAY_MS);
    }

    function doExpand(): void {
      if (destroyed || expanded) {
        return;
      }
      expanded = true;
      mapContainer.classList.remove(...INLINE_CLASSES);
      mapContainer.classList.add(...FULLSCREEN_CLASSES);
      expandBtn.classList.add('hidden');
      collapseBtn.classList.remove('hidden');
      scheduleResizeRefit();
      log.debug('Summary map expanded to fullscreen');
    }

    function doCollapse(): void {
      if (destroyed || !expanded) {
        return;
      }
      expanded = false;
      mapContainer.classList.remove(...FULLSCREEN_CLASSES);
      mapContainer.classList.add(...INLINE_CLASSES);
      collapseBtn.classList.add('hidden');
      expandBtn.classList.remove('hidden');
      scheduleResizeRefit();
      log.debug('Summary map collapsed to inline');
    }

    expandBtn.addEventListener('click', doExpand);
    collapseBtn.addEventListener('click', doCollapse);

    return {
      destroy: () => {
        if (destroyed) {
          return;
        }
        destroyed = true;
        clearTimeout(resizeTimeoutId);
        if (expandResizeTimeoutId !== null) {
          clearTimeout(expandResizeTimeoutId);
        }

        // Remove listeners explicitly before removing DOM nodes to avoid leaks
        expandBtn.removeEventListener('click', doExpand);
        collapseBtn.removeEventListener('click', doCollapse);
        expandBtn.remove();
        collapseBtn.remove();

        try {
          for (const layer of layers) {
            try {
              layer.remove();
            } catch (err) {
              log.warn('Ignoring error during layer cleanup:', err);
            }
          }
          map.remove();
          log.debug('Summary map destroyed');
        } catch (err) {
          log.warn('Error during map cleanup:', err);
        }
      },
      expand: doExpand,
      collapse: doCollapse,
      isExpanded: () => expanded,
    };
  } catch (err) {
    log.error('Failed to create summary map:', err);
    return null;
  }
}
