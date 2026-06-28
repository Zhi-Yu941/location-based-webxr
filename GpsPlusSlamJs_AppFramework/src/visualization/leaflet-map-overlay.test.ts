/**
 * LeafletMapOverlay Tests
 *
 * TDD tests for the new Leaflet-in-CSS3DRenderer map overlay that replaces
 * the old single-tile MapOverlay. The new system uses a real Leaflet map
 * DOM element positioned in 3D space via CSS3DObject, enabling:
 * - Full Leaflet interactivity (pan, zoom)
 * - Live overlays (user dot, paths, ref points, alignment snapshots)
 * - Native tile loading (multi-tile, caching, zoom)
 *
 * Tests are structured by concern:
 * 1. Constructor / defaults — verifies configuration
 * 2. Show / hide / toggle — visibility lifecycle
 * 3. GPS position — setGpsPosition and map centering
 * 4. Live overlays — render(MapData) trajectory snapshots
 * 5. Dispose — resource cleanup
 * 6. Store subscriber compatibility — matches { setGpsPosition } interface
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
// Resolves to the mocked leaflet (see `vi.mock('leaflet')` below); used to
// inspect `divIcon` call args in the F5-A marker-prominence tests.
import L from 'leaflet';

// ---------------------------------------------------------------------------
// Mock Leaflet — same pattern as summary-map.test.ts
// ---------------------------------------------------------------------------

let lastMapInstance: ReturnType<typeof createMockMap>;
let polylineInstances: Array<ReturnType<typeof createMockPolyline>>;
let markerInstances: Array<ReturnType<typeof createMockMarker>>;
let lastTileLayerInstance: ReturnType<typeof createMockTileLayer>;

function createMockTileLayer() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const tl = {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    on: vi.fn((event: string, cb: (e: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return tl;
    }),
    /** Test helper: fire a registered event */
    _fire(event: string, payload: unknown) {
      for (const cb of listeners[event] ?? []) cb(payload);
    },
  };
  return tl;
}

function createMockPolyline() {
  const pl = {
    addTo: vi.fn().mockReturnThis(),
    addLatLng: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    getLatLngs: vi.fn(() => []),
    setStyle: vi.fn(),
  };
  return pl;
}

function createMockMarker() {
  const m: Record<string, ReturnType<typeof vi.fn>> = {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    bindPopup: vi.fn().mockReturnThis(),
    setLatLng: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  };
  return m;
}

function createMockCircle() {
  const c = {
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    setStyle: vi.fn(),
    setRadius: vi.fn().mockReturnThis(),
  };
  return c;
}

function createMockBounds() {
  const b = {
    extend: vi.fn().mockReturnThis(),
    isValid: vi.fn(() => false),
  };
  return b;
}

function createMockMap() {
  const layers: unknown[] = [];
  const map = {
    setView: vi.fn().mockReturnThis(),
    setZoom: vi.fn().mockReturnThis(),
    getZoom: vi.fn(() => 17),
    getCenter: vi.fn(() => ({ lat: 50.0, lng: 8.0 })),
    remove: vi.fn(),
    invalidateSize: vi.fn(),
    eachLayer: vi.fn((cb: (layer: unknown) => void) => {
      for (const l of layers) {
        cb(l);
      }
    }),
    _layers: layers,
    _addLayer(l: unknown) {
      layers.push(l);
    },
  };
  return map;
}

vi.mock('leaflet', () => {
  return {
    default: {
      map: vi.fn(
        (
          _container: unknown,
          options?: { center?: number[]; zoom?: number }
        ) => {
          lastMapInstance = createMockMap();
          if (options?.center) {
            lastMapInstance.getCenter = vi.fn(() => ({
              lat: (options.center as number[])[0],
              lng: (options.center as number[])[1],
            }));
          }
          if (options?.zoom !== undefined) {
            lastMapInstance.getZoom = vi.fn(() => options.zoom as number);
          }
          // Override setView to update getCenter stub
          lastMapInstance.setView = vi.fn((latlng: number[], zoom?: number) => {
            lastMapInstance.getCenter = vi.fn(() => ({
              lat: latlng[0],
              lng: latlng[1],
            }));
            if (zoom !== undefined) {
              lastMapInstance.getZoom = vi.fn(() => zoom);
            }
            return lastMapInstance;
          });
          lastMapInstance.setZoom = vi.fn((z: number) => {
            lastMapInstance.getZoom = vi.fn(() => z);
            return lastMapInstance;
          });
          return lastMapInstance;
        }
      ),
      tileLayer: vi.fn(() => {
        lastTileLayerInstance = createMockTileLayer();
        return lastTileLayerInstance;
      }),
      polyline: vi.fn(() => {
        const pl = createMockPolyline();
        polylineInstances.push(pl);
        // Register with map layers for eachLayer
        if (lastMapInstance) {
          lastMapInstance._addLayer(pl);
        }
        return pl;
      }),
      marker: vi.fn(() => {
        const m = createMockMarker();
        markerInstances.push(m);
        // Register with map layers for eachLayer
        if (lastMapInstance) {
          lastMapInstance._addLayer(m);
        }
        return m;
      }),
      circle: vi.fn(() => {
        const c = createMockCircle();
        // Register with map layers for eachLayer
        if (lastMapInstance) {
          lastMapInstance._addLayer(c);
        }
        return c;
      }),
      latLngBounds: vi.fn(() => createMockBounds()),
      divIcon: vi.fn(() => ({})),
    },
  };
});

// Mock CSS3DObject — the addon expects a DOM element and creates a THREE.Object3D
vi.mock('three/addons/renderers/CSS3DRenderer.js', () => {
  class MockCSS3DObject extends THREE.Object3D {
    element: HTMLElement;
    constructor(element: HTMLElement) {
      super();
      this.element = element;
      Object.defineProperty(this, 'type', {
        value: 'CSS3DObject',
        writable: true,
      });
    }
  }
  class MockCSS3DRenderer {
    domElement: HTMLElement;
    constructor() {
      this.domElement = document.createElement('div');
    }
    setSize() {}
    render() {}
  }
  return {
    CSS3DObject: MockCSS3DObject,
    CSS3DRenderer: MockCSS3DRenderer,
  };
});

import {
  LeafletMapOverlay,
  DEFAULT_LEAFLET_MAP_SIZE_PX,
  DEFAULT_WORLD_SIZE,
  DEFAULT_HEIGHT_OFFSET,
  DEFAULT_Z_OFFSET,
  DEFAULT_ZOOM,
  type LeafletMapOverlayOptions,
} from './leaflet-map-overlay';
import type { MapData } from './map-data';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createScene(): THREE.Scene {
  return new THREE.Scene();
}

function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
}

function createOverlay(options?: Partial<LeafletMapOverlayOptions>): {
  overlay: LeafletMapOverlay;
  scene: THREE.Scene;
  camera: THREE.Camera;
} {
  const scene = createScene();
  const camera = createCamera();
  const overlay = new LeafletMapOverlay(scene, camera, options);
  return { overlay, scene, camera };
}

// ---------------------------------------------------------------------------
// 1. Constructor / defaults
// ---------------------------------------------------------------------------

describe('LeafletMapOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    polylineInstances = [];
    markerInstances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    // Why: Ensures defaults are applied when no options are provided
    it('should use default constants when no options are provided', () => {
      const { overlay } = createOverlay();
      expect(overlay.getWorldSize()).toBe(DEFAULT_WORLD_SIZE);
      expect(overlay.getHeightOffset()).toBe(DEFAULT_HEIGHT_OFFSET);
      expect(overlay.getZoomLevel()).toBe(DEFAULT_ZOOM);
      expect(overlay.getMapSizePx()).toBe(DEFAULT_LEAFLET_MAP_SIZE_PX);
      overlay.dispose();
    });

    // Why: Ensures custom options override defaults
    it('should accept custom options', () => {
      const { overlay } = createOverlay({
        worldSize: 15,
        heightOffset: -3,
        zoomLevel: 14,
        mapSizePx: 800,
      });
      expect(overlay.getWorldSize()).toBe(15);
      expect(overlay.getHeightOffset()).toBe(-3);
      expect(overlay.getZoomLevel()).toBe(14);
      expect(overlay.getMapSizePx()).toBe(800);
      overlay.dispose();
    });

    // Why: mapParent allows GPS-world-aligned positioning via CameraFollower
    it('should use mapParent when provided instead of camera', () => {
      const scene = createScene();
      const camera = createCamera();
      const parent = new THREE.Object3D();
      const overlay = new LeafletMapOverlay(scene, camera, {
        mapParent: parent,
      });

      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      // The CSS3DObject should be a child of mapParent, not camera
      expect(parent.children.length).toBeGreaterThan(0);
      expect(camera.children.length).toBe(0);

      overlay.dispose();
    });

    // Why: Backward compat — attaches to camera by default
    it('should attach to camera when mapParent is not provided', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      expect(camera.children.length).toBeGreaterThan(0);
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Show / hide / toggle
  // ---------------------------------------------------------------------------

  describe('show/hide/toggle', () => {
    // Why: show() requires GPS position to know where to center the map
    it('should not show without GPS position', () => {
      const { overlay, camera } = createOverlay();
      overlay.show();
      expect(overlay.isVisible()).toBe(false);
      expect(camera.children.length).toBe(0);
      overlay.dispose();
    });

    // Why: Basic show lifecycle — sets visibility and adds to parent
    it('should show when GPS position is set', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      expect(overlay.isVisible()).toBe(true);
      overlay.dispose();
    });

    // Why: hide() removes the CSS3DObject from parent
    it('should hide and remove from parent', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      expect(overlay.isVisible()).toBe(true);

      overlay.hide();
      expect(overlay.isVisible()).toBe(false);
      expect(camera.children.length).toBe(0);
      overlay.dispose();
    });

    // Why: toggle alternates visibility
    it('should toggle visibility', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);

      overlay.toggle();
      expect(overlay.isVisible()).toBe(true);

      overlay.toggle();
      expect(overlay.isVisible()).toBe(false);
      overlay.dispose();
    });

    // Why: Regression test — mesh persists across hide→show cycles
    it('should re-add to parent after hide→show cycle', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      overlay.hide();
      overlay.show();
      expect(overlay.isVisible()).toBe(true);
      expect(camera.children.length).toBeGreaterThan(0);
      overlay.dispose();
    });

    // Why: show() is idempotent — no duplicates
    it('should not create duplicate children on repeated show()', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      const count = camera.children.length;
      overlay.show();
      expect(camera.children.length).toBe(count);
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. GPS position
  // ---------------------------------------------------------------------------

  describe('setGpsPosition', () => {
    // Why: GPS position drives map centering
    it('should store and return the GPS position', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.1234, 8.5678);
      const pos = overlay.getGpsPosition();
      expect(pos).toEqual({ lat: 50.1234, lon: 8.5678 });
      overlay.dispose();
    });

    // Why: Leaflet map should center on the GPS position
    it('should center the Leaflet map when visible', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      const center = overlay.getLeafletMap()?.getCenter();
      expect(center).toBeDefined();
      expect(center!.lat).toBeCloseTo(50.0, 3);
      expect(center!.lng).toBeCloseTo(8.0, 3);
      overlay.dispose();
    });

    // Why: Updating position should re-center the map
    it('should re-center map on subsequent GPS updates', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      overlay.setGpsPosition(51.0, 9.0);
      const center = overlay.getLeafletMap()?.getCenter();
      expect(center!.lat).toBeCloseTo(51.0, 3);
      expect(center!.lng).toBeCloseTo(9.0, 3);
      overlay.dispose();
    });

    // Why: GPS position set before show should be applied when showing
    it('should apply position set before show()', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(48.5, 7.5);
      overlay.show();

      const center = overlay.getLeafletMap()?.getCenter();
      expect(center!.lat).toBeCloseTo(48.5, 3);
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Live overlays (render(MapData))
  // ---------------------------------------------------------------------------

  describe('live overlays', () => {
    function sampleMapData(): MapData {
      return {
        userPosition: { lat: 50.0, lng: 8.0 },
        rawGpsPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
          { lat: 50.002, lng: 8.002 },
        ],
        fusedPath: [
          { lat: 50.0, lng: 8.0 },
          { lat: 50.001, lng: 8.001 },
        ],
        alignmentSnapshots: [
          { lat: 50.001, lng: 8.001 },
          { lat: 50.002, lng: 8.002 },
        ],
      };
    }

    // Why: User position dot should be shown on the map
    it('should show user position marker at current GPS location', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.render(sampleMapData());
      overlay.show();

      // User dot should exist on the map
      const map = overlay.getLeafletMap()!;
      let markerCount = 0;
      map.eachLayer((layer) => {
        if ('getLatLng' in layer) {
          markerCount++;
        }
      });
      // At least the user position marker
      expect(markerCount).toBeGreaterThanOrEqual(1);
      overlay.dispose();
    });

    // Why: Finding 2 (2026-06-28) — the live overlay AND replay both call
    // render(), which forwards the MapData straight to drawMapData with
    // showUserPosition: true. A MapData carrying a userHeadingDeg must therefore
    // produce the rotated view-direction line in the user-position divIcon for
    // both modes. (Replay re-dispatches recorded odom rotations through the same
    // store → rebuildMap → render path, so this one assertion covers it.)
    it('renders the view-direction heading line when MapData carries a userHeadingDeg', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      vi.mocked(L.divIcon).mockClear();
      overlay.render({ ...sampleMapData(), userHeadingDeg: 123 });

      const opts = vi.mocked(L.divIcon).mock.calls.at(-1)?.[0] as {
        html?: string;
      };
      expect(String(opts.html)).toContain('map-overlay-user-heading');
      expect(String(opts.html)).toContain('rotate(123');
      overlay.dispose();
    });

    // Why: render() draws the trajectory polylines (raw/fused/snapshot)
    it('should draw trajectory polylines from a MapData snapshot', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      overlay.render(sampleMapData());

      // Should have polyline layers (raw + fused + snapshot)
      const map = overlay.getLeafletMap()!;
      let polylineCount = 0;
      map.eachLayer((layer) => {
        if ('getLatLngs' in layer && 'setStyle' in layer) {
          polylineCount++;
        }
      });
      expect(polylineCount).toBeGreaterThanOrEqual(3);
      overlay.dispose();
    });

    // Why: A fresh render must replace the previous layers, not accumulate them
    it('should replace previous layers on a subsequent render', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      overlay.render(sampleMapData());
      const map = overlay.getLeafletMap()!;
      const countPolylines = () => {
        let n = 0;
        map.eachLayer((layer) => {
          if ('getLatLngs' in layer && 'setStyle' in layer) {
            n++;
          }
        });
        return n;
      };
      const firstBatch = polylineInstances.slice();
      expect(countPolylines()).toBeGreaterThanOrEqual(3);

      // Second render with the same shape — previous polylines must be removed
      overlay.render(sampleMapData());
      for (const pl of firstBatch) {
        expect(pl.remove).toHaveBeenCalled();
      }
      overlay.dispose();
    });

    // Why: A MapData snapshot supplied before show() should appear on show()
    it('should buffer a MapData snapshot supplied before show()', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);

      // Render before showing
      overlay.render(sampleMapData());

      overlay.show();

      const map = overlay.getLeafletMap()!;
      let layerCount = 0;
      map.eachLayer(() => layerCount++);
      // Tile layer + user marker + raw polyline + fused polyline +
      // snapshot polyline = at least 4 layers
      expect(layerCount).toBeGreaterThanOrEqual(4);
      overlay.dispose();
    });

    // Why: Overlay data should survive hide→show cycles
    it('should preserve overlay data across hide→show cycles', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      overlay.render(sampleMapData());

      overlay.hide();
      overlay.show();

      const map = overlay.getLeafletMap()!;
      let polylineCount = 0;
      map.eachLayer((layer) => {
        if ('getLatLngs' in layer && 'setStyle' in layer) {
          polylineCount++;
        }
      });
      expect(polylineCount).toBeGreaterThanOrEqual(1);
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. CSS3DObject positioning
  // ---------------------------------------------------------------------------

  describe('3D positioning', () => {
    // Why: The CSS3DObject must be positioned identically to the old MapOverlay mesh
    it('should position the CSS3DObject at (0, heightOffset, DEFAULT_Z_OFFSET)', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      const obj = camera.children[0];
      expect(obj).toBeDefined();
      expect(obj.position.x).toBe(0);
      expect(obj.position.y).toBe(DEFAULT_HEIGHT_OFFSET);
      expect(obj.position.z).toBe(DEFAULT_Z_OFFSET);
      overlay.dispose();
    });

    // Why: Map must face up (XZ plane) — rotation -90Â° on X
    it('should rotate the CSS3DObject to face up', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      const obj = camera.children[0];
      expect(obj.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Dispose
  // ---------------------------------------------------------------------------

  describe('dispose', () => {
    // Why: dispose must clean up the Leaflet map and CSS3DObject
    it('should remove from parent and clean up', () => {
      const { overlay, camera } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      expect(camera.children.length).toBeGreaterThan(0);

      overlay.dispose();
      expect(camera.children.length).toBe(0);
      expect(overlay.isVisible()).toBe(false);
      expect(overlay.getLeafletMap()).toBeNull();
    });

    // Why: dispose is idempotent
    it('should be safe to call multiple times', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();
      overlay.dispose();
      overlay.dispose(); // No error
      expect(overlay.isVisible()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Store subscriber interface compatibility
  // ---------------------------------------------------------------------------

  describe('store subscriber compatibility', () => {
    // Why: The store subscriber proxy requires exactly { setGpsPosition(lat, lon) }
    it('should satisfy the StoreSubscriberDeps mapOverlay interface', () => {
      const { overlay } = createOverlay();

      // This is the shape expected by store-subscribers.ts
      const mapOverlayDep: {
        setGpsPosition: (lat: number, lon: number) => void;
      } = overlay;

      expect(typeof mapOverlayDep.setGpsPosition).toBe('function');
      mapOverlayDep.setGpsPosition(50.0, 8.0);
      expect(overlay.getGpsPosition()).toEqual({ lat: 50.0, lon: 8.0 });
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Zoom controls
  // ---------------------------------------------------------------------------

  describe('zoom controls', () => {
    // Why: Users need to zoom in/out on the map
    it('should change zoom level via setZoomLevel()', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      overlay.setZoomLevel(15);
      expect(overlay.getZoomLevel()).toBe(15);

      const map = overlay.getLeafletMap()!;
      expect(map.getZoom()).toBe(15);
      overlay.dispose();
    });

    // Why: Zoom should be clamped to valid range
    it('should clamp zoom level to valid range (0–19)', () => {
      const { overlay } = createOverlay();
      overlay.setZoomLevel(25);
      expect(overlay.getZoomLevel()).toBeLessThanOrEqual(19);
      overlay.setZoomLevel(-5);
      expect(overlay.getZoomLevel()).toBeGreaterThanOrEqual(0);
      overlay.dispose();
    });

    // Why: HUD zoom buttons need a simple zoomIn() method that increments by 1
    it('should increment zoom level by 1 via zoomIn()', () => {
      const { overlay } = createOverlay({ zoomLevel: 15 });
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      overlay.zoomIn();
      expect(overlay.getZoomLevel()).toBe(16);

      overlay.zoomIn();
      expect(overlay.getZoomLevel()).toBe(17);
      overlay.dispose();
    });

    // Why: HUD zoom buttons need a simple zoomOut() method that decrements by 1
    it('should decrement zoom level by 1 via zoomOut()', () => {
      const { overlay } = createOverlay({ zoomLevel: 15 });
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      overlay.zoomOut();
      expect(overlay.getZoomLevel()).toBe(14);

      overlay.zoomOut();
      expect(overlay.getZoomLevel()).toBe(13);
      overlay.dispose();
    });

    // Why: zoomIn() at MAX_ZOOM should be a safe no-op (clamped)
    it('should not exceed MAX_ZOOM when calling zoomIn()', () => {
      const { overlay } = createOverlay({ zoomLevel: 19 });
      overlay.zoomIn();
      expect(overlay.getZoomLevel()).toBe(19);
      overlay.dispose();
    });

    // Why: zoomOut() at MIN_ZOOM should be a safe no-op (clamped)
    it('should not go below MIN_ZOOM when calling zoomOut()', () => {
      const { overlay } = createOverlay({ zoomLevel: 0 });
      overlay.zoomOut();
      expect(overlay.getZoomLevel()).toBe(0);
      overlay.dispose();
    });

    // Why: zoomIn()/zoomOut() should work before show() — changes buffered zoom level
    it('should update zoom level before show() is called', () => {
      const { overlay } = createOverlay({ zoomLevel: 15 });
      overlay.zoomIn();
      overlay.zoomIn();
      expect(overlay.getZoomLevel()).toBe(17);

      overlay.zoomOut();
      expect(overlay.getZoomLevel()).toBe(16);
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Backward compatibility with old MapOverlay API
  // ---------------------------------------------------------------------------

  describe('backward compat', () => {
    // Why: updatePosition() is called in the frame loop — must be a safe no-op
    it('should have updatePosition() as a no-op', () => {
      const { overlay } = createOverlay();
      expect(() => overlay.updatePosition()).not.toThrow();
      overlay.dispose();
    });

    // Why: getMapSize/getHeightOffset are used in tests — equivalent accessors needed
    it('should expose getWorldSize() and getHeightOffset()', () => {
      const { overlay } = createOverlay();
      expect(typeof overlay.getWorldSize()).toBe('number');
      expect(typeof overlay.getHeightOffset()).toBe('number');
      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Tile error callback
  // ---------------------------------------------------------------------------

  describe('tile error callback', () => {
    /**
     * Why this test matters (Issue #10 - Field Test Readiness):
     * When the device is offline or the tile server is unreachable, tile
     * loading fails silently. Users see a blank map with no indication of
     * the problem. This test ensures the onTileError callback is invoked
     * so the UI can notify the user about map tile failures.
     */
    it('should call onTileError callback when tile loading fails', () => {
      const onTileError = vi.fn();
      const { overlay } = createOverlay({ onTileError });
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      // Simulate a tile load error via the mock tile layer
      const fakeError = new Error('tile unavailable');
      lastTileLayerInstance._fire('tileerror', { error: fakeError });

      expect(onTileError).toHaveBeenCalledTimes(1);
      expect(onTileError).toHaveBeenCalledWith(fakeError);
    });

    /**
     * Why this test matters:
     * When no onTileError callback is provided, the map should still work
     * (errors are logged but don't crash). Ensures backward compatibility.
     */
    it('should handle tile error gracefully when no callback provided', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      // Should not throw when firing tileerror without a callback
      expect(() => {
        lastTileLayerInstance._fire('tileerror', {
          error: new Error('tile unavailable'),
        });
      }).not.toThrow();

      expect(overlay.isVisible()).toBe(true);
      overlay.dispose();
    });

    /**
     * Why this test matters:
     * Multiple tile loads can fail (e.g. entire region offline).
     * Each failure should invoke the callback independently.
     */
    it('should call onTileError for each failed tile', () => {
      const onTileError = vi.fn();
      const { overlay } = createOverlay({ onTileError });
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      lastTileLayerInstance._fire('tileerror', { error: new Error('err1') });
      lastTileLayerInstance._fire('tileerror', { error: new Error('err2') });
      lastTileLayerInstance._fire('tileerror', { error: new Error('err3') });

      expect(onTileError).toHaveBeenCalledTimes(3);
      overlay.dispose();
    });
  });

  describe('CSS3DObject compatibility', () => {
    // Why: CSS3DRenderer positions elements via CSS transforms, which are visual-only
    // offsets from the element's layout position. If the mapContainer retains
    // position:fixed + left/top:-9999px from createLeafletMap(), the CSS3D
    // transform applies on top of that extreme offset, pushing the element
    // far off-screen. The off-screen styles MUST be cleared before CSS3D takes over.
    it('should clear off-screen positioning styles after show()', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      // The container must NOT have position:fixed or left/top:-9999px
      // after show() because CSS3DRenderer handles placement via transforms.
      const leafletMap = overlay.getLeafletMap();
      expect(leafletMap).not.toBeNull();

      // Find the mapContainer — it's the div with our specific size
      const allDivs = document.querySelectorAll('div');
      let mapContainer: HTMLElement | null = null;
      for (const div of allDivs) {
        if (div.style.width === '600px' && div.style.height === '600px') {
          mapContainer = div;
          break;
        }
      }
      expect(mapContainer).not.toBeNull();

      // These assertions verify the bug fix: off-screen positioning must be cleared
      expect(mapContainer!.style.position).not.toBe('fixed');
      expect(mapContainer!.style.left).not.toBe('-9999px');
      expect(mapContainer!.style.top).not.toBe('-9999px');

      overlay.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // DOM hardcoding audit — regression tests
  // ---------------------------------------------------------------------------

  describe('ref-point marker prominence (F5-A)', () => {
    /**
     * Why this test matters (F5-A, 2026-06-16 user feedback): the field tester
     * reported the in-AR minimap "showed the user but not the marker". The
     * markers were rendered but the 12 px dot was too small to notice on the
     * small CSS3D minimap. The marker is now drawn large enough to see; this
     * locks the rendered `divIcon` size so a future tweak can't shrink it back
     * below a visible threshold.
     */
    it('draws current ref-point markers large enough to see on the minimap', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.1234, 8.5678);
      overlay.show();
      vi.mocked(L.divIcon).mockClear();

      overlay.addCurrentMarker(50.1234, 8.5678, 'Bench');

      expect(L.divIcon).toHaveBeenCalled();
      const opts = vi.mocked(L.divIcon).mock.calls.at(-1)?.[0] as {
        iconSize: [number, number];
        html: string;
      };
      // Clearly larger than the old 12 px dot and at least as prominent as the
      // 14 px user-position marker.
      expect(opts.iconSize[0]).toBeGreaterThanOrEqual(18);
      expect(opts.iconSize[1]).toBeGreaterThanOrEqual(18);
      // The coloured dot in the html matches the icon box.
      expect(opts.html).toContain(`width:${opts.iconSize[0]}px`);
    });

    it('draws prior ref-point markers at the same prominent size', () => {
      const { overlay } = createOverlay();
      overlay.setGpsPosition(50.2, 8.6);
      overlay.show();
      vi.mocked(L.divIcon).mockClear();

      overlay.addPriorMarker(50.2, 8.6, 'Door');

      const opts = vi.mocked(L.divIcon).mock.calls.at(-1)?.[0] as {
        iconSize: [number, number];
      };
      expect(opts.iconSize[0]).toBeGreaterThanOrEqual(18);
      expect(opts.iconSize[1]).toBeGreaterThanOrEqual(18);
    });
  });

  describe('DOM hardcoding audit regressions', () => {
    /**
     * Why this test matters:
     * Leaflet divIcon className values that nothing consumes are leaky
     * abstractions — they could collide with host-app CSS rules.
     * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 2 (P5).
     */
    it('divIcon markers do not set hardcoded CSS class names', async () => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const source = readFileSync(
        resolve(process.cwd(), 'src/visualization/leaflet-map-overlay.ts'),
        'utf-8'
      );
      expect(source).not.toContain("className: 'leaflet-user-position'");
      expect(source).not.toContain("className: 'leaflet-refpoint-marker'");
    });

    /**
     * Why this test matters:
     * The user-position marker must use VIS_COLORS.USER_POSITION.css instead
     * of a hardcoded hex color. Since Phase 3 the marker is drawn by the
     * shared `map-overlay-draw` module, so the overlay itself must NOT
     * re-introduce a hardcoded color, and the shared module must use the
     * VIS_COLORS token.
     * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 4 (P6).
     */
    it('user marker uses VIS_COLORS instead of hardcoded color', async () => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const overlaySource = readFileSync(
        resolve(process.cwd(), 'src/visualization/leaflet-map-overlay.ts'),
        'utf-8'
      );
      // The overlay no longer draws the user marker itself.
      expect(overlaySource).not.toMatch(/background:#3b82f6/);

      const drawSource = readFileSync(
        resolve(process.cwd(), 'src/visualization/map-overlay-draw.ts'),
        'utf-8'
      );
      expect(drawSource).not.toMatch(/background:#3b82f6/);
      expect(drawSource).toContain('VIS_COLORS.USER_POSITION.css');
    });

    /**
     * Why this test matters:
     * The off-screen Leaflet container should be appended to an optional
     * offscreenRoot element rather than always to document.body. This
     * prevents DOM leakage in multi-instance/shadow-DOM scenarios.
     * See: 2026-04-01-code-review-dom-hardcoding-audit.md, Finding 10 (P9).
     */
    it('appends off-screen container to offscreenRoot instead of body', () => {
      const customRoot = document.createElement('div');
      document.body.appendChild(customRoot);

      const { overlay } = createOverlay({ offscreenRoot: customRoot });
      overlay.setGpsPosition(50.0, 8.0);
      overlay.show();

      // The off-screen map container should be inside customRoot, not body
      expect(customRoot.children.length).toBeGreaterThanOrEqual(1);
      const offscreenDiv = customRoot.querySelector('div');
      expect(offscreenDiv).not.toBeNull();

      overlay.dispose();
      document.body.removeChild(customRoot);
    });
  });
});
