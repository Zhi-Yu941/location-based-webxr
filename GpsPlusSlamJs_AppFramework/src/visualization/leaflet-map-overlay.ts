/**
 * Leaflet Map Overlay Module
 *
 * Replaces the old single-tile MapOverlay with a full Leaflet map
 * embedded in 3D space via Three.js CSS3DObject. The Leaflet map
 * provides native multi-tile rendering, pan/zoom, and overlay support.
 *
 * The Leaflet map container (a real DOM element) is wrapped in a
 * CSS3DObject and positioned as a child of the camera or CameraFollower.
 * A CSS3DRenderer (managed externally) composites it with the WebGL scene.
 *
 * Live overlays:
 * - User position: blue pulsing dot at current GPS location
 * - Raw GPS path: yellow polyline (same color as 3D GPS spheres)
 * - Fused path: cyan polyline (same color as 3D fused spheres)
 * - Alignment snapshots: red polyline connecting snapshot positions
 * - Reference points: colored circle markers with label popups
 *
 * ARCHITECTURE:
 * - CSS3DObject is a child of mapParent (CameraFollower or camera)
 * - Position: (0, heightOffset, DEFAULT_Z_OFFSET) in parent-local space
 * - Rotation: -π/2 on X axis (faces up, XZ plane)
 * - Leaflet map handles all tile loading, caching, multi-tile rendering
 * - Store subscribers call setGpsPosition(lat, lon) for automatic centering
 */

import type * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import L from 'leaflet';
import type { LatLong } from 'gps-plus-slam-js';
import { VIS_COLORS } from './vis-colors';
import { createLogger } from '../utils/logger';

const log = createLogger('LeafletMapOverlay');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default pixel size of the Leaflet map container */
export const DEFAULT_LEAFLET_MAP_SIZE_PX = 600;

/** Default world-space size in meters (matches old MapOverlay) */
export const DEFAULT_WORLD_SIZE = 10;

/** Default height offset below camera (negative = below) */
export const DEFAULT_HEIGHT_OFFSET = -4;

/** Default forward offset from parent (negative = forward in parent-local Z) */
export const DEFAULT_Z_OFFSET = -1.0;

/** Default zoom level for the Leaflet map */
export const DEFAULT_ZOOM = 17;

/** Minimum allowed zoom level */
const MIN_ZOOM = 0;

/** Maximum allowed zoom level */
const MAX_ZOOM = 19;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration options for the Leaflet map overlay.
 */
export interface LeafletMapOverlayOptions {
  /** Pixel dimensions of the Leaflet map container (default: 600). */
  readonly mapSizePx?: number;
  /** World-space size in meters (default: 10). */
  readonly worldSize?: number;
  /** Height offset below parent in meters (default: -4). */
  readonly heightOffset?: number;
  /** Initial Leaflet zoom level (default: 17). */
  readonly zoomLevel?: number;
  /** Tile server URL template (default: OSM). */
  readonly tileServerUrl?: string;
  /**
   * Object3D to attach the CSS3DObject to instead of the camera.
   * Use CameraFollower.object3D for GPS-world-aligned map.
   */
  readonly mapParent?: THREE.Object3D;
  /** Called when a map tile fails to load (e.g., offline, server error). */
  readonly onTileError?: (error: unknown) => void;
  /**
   * DOM element to append the off-screen Leaflet container to.
   * Defaults to `document.body`. In multi-instance or shadow-DOM scenarios
   * pass a scoped element to avoid injecting nodes into `<body>`.
   */
  readonly offscreenRoot?: HTMLElement;
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class LeafletMapOverlay {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private readonly mapParent: THREE.Object3D;
  private readonly worldSize: number;
  private readonly heightOffset: number;
  private readonly mapSizePx: number;
  private readonly tileServerUrl: string;
  private readonly onTileError?: (error: unknown) => void;
  private readonly offscreenRoot: HTMLElement;

  private zoomLevel: number;
  private gpsPosition: LatLong | null = null;
  private visible = false;

  // Leaflet state
  private mapContainer: HTMLDivElement | null = null;
  private leafletMap: L.Map | null = null;
  private tileLayer: L.TileLayer | null = null;

  // CSS3D state
  private cssObject: CSS3DObject | null = null;

  // Live overlay state (buffered — data can arrive before show())
  private rawGpsPoints: L.LatLngExpression[] = [];
  private fusedPoints: L.LatLngExpression[] = [];
  private snapshotPoints: L.LatLngExpression[] = [];

  // Leaflet overlay layers
  private userMarker: L.Marker | null = null;
  private rawGpsPolyline: L.Polyline | null = null;
  private fusedPolyline: L.Polyline | null = null;
  private snapshotPolyline: L.Polyline | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    options: LeafletMapOverlayOptions = {}
  ) {
    this.scene = scene;
    this.camera = camera;
    this.mapParent = options.mapParent ?? camera;
    this.worldSize = options.worldSize ?? DEFAULT_WORLD_SIZE;
    this.heightOffset = options.heightOffset ?? DEFAULT_HEIGHT_OFFSET;
    this.mapSizePx = options.mapSizePx ?? DEFAULT_LEAFLET_MAP_SIZE_PX;
    this.zoomLevel = options.zoomLevel ?? DEFAULT_ZOOM;
    this.tileServerUrl =
      options.tileServerUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.onTileError = options.onTileError;
    this.offscreenRoot = options.offscreenRoot ?? document.body;
  }

  // -------------------------------------------------------------------------
  // GPS position
  // -------------------------------------------------------------------------

  setGpsPosition(lat: number, lon: number): void {
    this.gpsPosition = { lat, lon };

    if (this.leafletMap) {
      this.leafletMap.setView([lat, lon], this.zoomLevel);
      this.updateUserMarker();
    }
  }

  getGpsPosition(): LatLong | null {
    return this.gpsPosition;
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  show(): void {
    if (!this.gpsPosition) {
      log.warn('Cannot show map — no GPS position set');
      return;
    }

    if (this.visible) {
      return;
    }

    this.createLeafletMap();
    this.createCssObject();
    this.applyBufferedOverlays();
    this.visible = true;
    log.info('Leaflet map overlay shown');
  }

  hide(): void {
    if (!this.visible) {
      return;
    }
    this.removeCssObject();
    this.visible = false;
    log.info('Leaflet map overlay hidden');
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  // -------------------------------------------------------------------------
  // Live overlay methods
  // -------------------------------------------------------------------------

  addRawGpsPoint(lat: number, lon: number): void {
    this.rawGpsPoints.push([lat, lon]);
    if (this.leafletMap) {
      if (!this.rawGpsPolyline) {
        this.rawGpsPolyline = L.polyline([], {
          color: VIS_COLORS.RAW_GPS.css,
          weight: 3,
          opacity: 0.8,
        }).addTo(this.leafletMap);
      }
      this.rawGpsPolyline.addLatLng([lat, lon]);
    }
  }

  addFusedPoint(lat: number, lon: number): void {
    this.fusedPoints.push([lat, lon]);
    if (this.leafletMap) {
      if (!this.fusedPolyline) {
        this.fusedPolyline = L.polyline([], {
          color: VIS_COLORS.FUSED_VIO.css,
          weight: 3,
          opacity: 0.8,
        }).addTo(this.leafletMap);
      }
      this.fusedPolyline.addLatLng([lat, lon]);
    }
  }

  addAlignmentSnapshot(lat: number, lon: number): void {
    this.snapshotPoints.push([lat, lon]);
    if (this.leafletMap) {
      if (!this.snapshotPolyline) {
        this.snapshotPolyline = L.polyline([], {
          color: VIS_COLORS.ALIGNMENT_SNAPSHOT.css,
          weight: 3,
          opacity: 0.8,
        }).addTo(this.leafletMap);
      }
      this.snapshotPolyline.addLatLng([lat, lon]);
    }
  }

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  setZoomLevel(zoom: number): void {
    this.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    if (this.leafletMap) {
      this.leafletMap.setZoom(this.zoomLevel);
    }
  }

  getZoomLevel(): number {
    return this.zoomLevel;
  }

  /** Increment zoom level by 1 (clamped at MAX_ZOOM). */
  zoomIn(): void {
    this.setZoomLevel(this.zoomLevel + 1);
  }

  /** Decrement zoom level by 1 (clamped at MIN_ZOOM). */
  zoomOut(): void {
    this.setZoomLevel(this.zoomLevel - 1);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getWorldSize(): number {
    return this.worldSize;
  }

  getHeightOffset(): number {
    return this.heightOffset;
  }

  getMapSizePx(): number {
    return this.mapSizePx;
  }

  /** Expose the Leaflet map instance for testing and advanced usage. */
  getLeafletMap(): L.Map | null {
    return this.leafletMap;
  }

  /**
   * No-op — kept for backward compatibility with the frame-loop call
   * in main.ts. The CSS3DObject is a child of the parent, so Three.js
   * scene graph propagation handles positioning automatically.
   */
  updatePosition(): void {
    // No-op
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  dispose(): void {
    this.hide();
    this.destroyLeafletMap();

    // Clear buffered data
    this.rawGpsPoints = [];
    this.fusedPoints = [];
    this.snapshotPoints = [];

    this.cssObject = null;

    log.info('Leaflet map overlay disposed');
  }

  // -------------------------------------------------------------------------
  // Private — Leaflet map lifecycle
  // -------------------------------------------------------------------------

  private createLeafletMap(): void {
    if (this.leafletMap) {
      return;
    }

    // Create off-screen container for Leaflet
    this.mapContainer = document.createElement('div');
    this.mapContainer.style.width = `${this.mapSizePx}px`;
    this.mapContainer.style.height = `${this.mapSizePx}px`;
    this.mapContainer.style.background = 'white';

    // Leaflet needs the container in the DOM for sizing
    // Position it off-screen; the CSS3DRenderer handles actual placement
    this.mapContainer.style.position = 'fixed';
    this.mapContainer.style.left = '-9999px';
    this.mapContainer.style.top = '-9999px';
    this.mapContainer.style.pointerEvents = 'none';
    this.offscreenRoot.appendChild(this.mapContainer);

    // Create Leaflet map
    const pos = this.gpsPosition!;
    this.leafletMap = L.map(this.mapContainer, {
      center: [pos.lat, pos.lon],
      zoom: this.zoomLevel,
      zoomControl: false,
      attributionControl: false,
    });

    // Add tile layer
    this.tileLayer = L.tileLayer(this.tileServerUrl, {
      maxZoom: MAX_ZOOM,
    });
    this.tileLayer.on('tileerror', (e: L.TileErrorEvent) => {
      log.error('Failed to load map tile:', e.error);
      this.onTileError?.(e.error);
    });
    this.tileLayer.addTo(this.leafletMap);
  }

  private destroyLeafletMap(): void {
    // Remove all overlay layers
    this.userMarker?.remove();
    this.userMarker = null;
    this.rawGpsPolyline?.remove();
    this.rawGpsPolyline = null;
    this.fusedPolyline?.remove();
    this.fusedPolyline = null;
    this.snapshotPolyline?.remove();
    this.snapshotPolyline = null;

    // Destroy Leaflet map
    if (this.leafletMap) {
      this.leafletMap.remove();
      this.leafletMap = null;
    }

    // Remove container from DOM
    if (this.mapContainer?.parentElement) {
      this.mapContainer.parentElement.removeChild(this.mapContainer);
    }
    this.mapContainer = null;
    this.tileLayer = null;
  }

  // -------------------------------------------------------------------------
  // Private — CSS3DObject lifecycle
  // -------------------------------------------------------------------------

  private createCssObject(): void {
    if (!this.mapContainer) {
      return;
    }

    if (this.cssObject) {
      // Re-add existing object
      this.mapParent.add(this.cssObject);
      return;
    }

    // Clear the off-screen positioning set during createLeafletMap().
    // CSS3DRenderer handles placement via CSS transforms, which are
    // visual-only offsets from the element's layout position. Retaining
    // position:fixed + left/top:-9999px would push the element off-screen
    // because the transform applies on top of that extreme offset.
    this.mapContainer.style.position = '';
    this.mapContainer.style.left = '';
    this.mapContainer.style.top = '';

    this.cssObject = new CSS3DObject(this.mapContainer);

    // Scale: the DOM element is mapSizePx pixels wide, but should appear
    // as worldSize meters in 3D space. CSS3DRenderer maps 1 px = 1 unit,
    // so we scale by worldSize / mapSizePx.
    const scale = this.worldSize / this.mapSizePx;
    this.cssObject.scale.set(scale, scale, scale);

    // Position in parent-local space
    this.cssObject.position.set(0, this.heightOffset, DEFAULT_Z_OFFSET);

    // Rotate to face up (XZ plane)
    this.cssObject.rotation.x = -Math.PI / 2;

    this.mapParent.add(this.cssObject);
  }

  private removeCssObject(): void {
    if (this.cssObject) {
      this.mapParent.remove(this.cssObject);
    }
  }

  // -------------------------------------------------------------------------
  // Private — Overlay rendering
  // -------------------------------------------------------------------------

  private applyBufferedOverlays(): void {
    if (!this.leafletMap) {
      return;
    }

    // User position
    this.updateUserMarker();

    // Raw GPS polyline
    if (this.rawGpsPoints.length > 0) {
      this.rawGpsPolyline = L.polyline(this.rawGpsPoints, {
        color: VIS_COLORS.RAW_GPS.css,
        weight: 3,
        opacity: 0.8,
      }).addTo(this.leafletMap);
    }

    // Fused polyline
    if (this.fusedPoints.length > 0) {
      this.fusedPolyline = L.polyline(this.fusedPoints, {
        color: VIS_COLORS.FUSED_VIO.css,
        weight: 3,
        opacity: 0.8,
      }).addTo(this.leafletMap);
    }

    // Alignment snapshot polyline
    if (this.snapshotPoints.length > 0) {
      this.snapshotPolyline = L.polyline(this.snapshotPoints, {
        color: VIS_COLORS.ALIGNMENT_SNAPSHOT.css,
        weight: 3,
        opacity: 0.8,
      }).addTo(this.leafletMap);
    }
  }

  private updateUserMarker(): void {
    if (!this.gpsPosition || !this.leafletMap) {
      return;
    }

    if (this.userMarker) {
      this.userMarker.setLatLng([this.gpsPosition.lat, this.gpsPosition.lon]);
    } else {
      this.userMarker = L.marker([this.gpsPosition.lat, this.gpsPosition.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${VIS_COLORS.USER_POSITION.css};width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 6px rgba(59,130,246,0.6);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(this.leafletMap);
    }
  }
}
