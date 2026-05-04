/**
 * Reference Point Visualizer Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateLicenseKey } from 'gps-plus-slam-js';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';
import { RefPointVisualizer } from './ref-point-visualizer';
import type { RefPointMark } from '../storage/ref-point-loader';
import type { LatLong } from 'gps-plus-slam-js';
import * as THREE from 'three';

// Activate the gps-plus-slam-js license once for this suite so calls into
// `calcRelativeCoordsInMeters` from `GpsAnchoredMeshManager` succeed without
// a store being constructed first.
validateLicenseKey(COMMUNITY_LICENSE_KEY);

// Mock the webxr-session module
vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  getScene: vi.fn(),
}));

import { getScene } from 'gps-plus-slam-app-framework/ar/webxr-session';

describe('RefPointVisualizer', () => {
  let visualizer: RefPointVisualizer;
  let mockScene: THREE.Scene;

  beforeEach(() => {
    visualizer = new RefPointVisualizer();
    mockScene = new THREE.Scene();
    vi.mocked(getScene).mockReturnValue(mockScene);
  });

  describe('setZeroRef / getZeroRef', () => {
    it('stores the zero reference', () => {
      const zero: LatLong = { lat: 48.8566, lon: 2.3522 };

      visualizer.setZeroRef(zero);

      expect(visualizer.getZeroRef()).toEqual(zero);
    });
  });

  describe('displayPriorRefPoints', () => {
    it('does not create meshes if zero ref not set', () => {
      const refPoints: RefPointMark[] = [
        createMockRefPoint('ref1', 48.8567, 2.3523),
      ];

      visualizer.displayPriorRefPoints(refPoints);

      expect(mockScene.children).toHaveLength(0);
    });

    it('does not create meshes if scene unavailable', () => {
      vi.mocked(getScene).mockReturnValue(null);
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const refPoints: RefPointMark[] = [
        createMockRefPoint('ref1', 48.8567, 2.3523),
      ];

      visualizer.displayPriorRefPoints(refPoints);

      expect(visualizer.getCounts().prior).toBe(0);
    });

    it('creates green sphere for each ref point with GPS position', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const refPoints: RefPointMark[] = [
        createMockRefPoint('ref1', 48.8567, 2.3523),
        createMockRefPoint('ref2', 48.8568, 2.3524),
      ];

      visualizer.displayPriorRefPoints(refPoints);

      expect(mockScene.children).toHaveLength(2);
      expect(mockScene.children[0].name).toBe('prior-ref-ref1');
      expect(mockScene.children[1].name).toBe('prior-ref-ref2');

      // Verify meshes are green
      const mesh1 = mockScene.children[0] as THREE.Mesh;
      const material1 = mesh1.material as THREE.MeshBasicMaterial;
      expect(material1.color.getHex()).toBe(0x00ff00); // Green
    });

    it('skips ref points without GPS position', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const refPoints: RefPointMark[] = [
        createMockRefPoint('ref1', 48.8567, 2.3523),
        {
          id: 'ref2',
          odomPosition: [1, 2, 3],
          odomRotation: [0, 0, 0, 1],
          timestamp: 2000,
          gpsPosition: undefined, // No GPS
        },
      ];

      visualizer.displayPriorRefPoints(refPoints);

      expect(mockScene.children).toHaveLength(1);
      expect(visualizer.getCounts().prior).toBe(1);
    });

    it('clears previous prior ref points before displaying new ones', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const firstBatch: RefPointMark[] = [
        createMockRefPoint('ref1', 48.8567, 2.3523),
      ];
      visualizer.displayPriorRefPoints(firstBatch);
      expect(mockScene.children).toHaveLength(1);

      const secondBatch: RefPointMark[] = [
        createMockRefPoint('ref2', 48.8568, 2.3524),
        createMockRefPoint('ref3', 48.8569, 2.3525),
      ];
      visualizer.displayPriorRefPoints(secondBatch);

      expect(mockScene.children).toHaveLength(2);
      expect(mockScene.children[0].name).toBe('prior-ref-ref2');
      expect(mockScene.children[1].name).toBe('prior-ref-ref3');
    });
  });

  describe('addCurrentRefPoint', () => {
    it('does not create mesh if zero ref not set', () => {
      const refPoint = createMockRefPoint('ref1', 48.8567, 2.3523);

      visualizer.addCurrentRefPoint(refPoint);

      expect(mockScene.children).toHaveLength(0);
    });

    it('does not create mesh if GPS position missing', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const refPoint: RefPointMark = {
        id: 'ref1',
        odomPosition: [1, 2, 3],
        odomRotation: [0, 0, 0, 1],
        timestamp: 1000,
        gpsPosition: undefined,
      };

      visualizer.addCurrentRefPoint(refPoint);

      expect(mockScene.children).toHaveLength(0);
    });

    it('creates red sphere for current ref point', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const refPoint = createMockRefPoint('ref1', 48.8567, 2.3523);

      visualizer.addCurrentRefPoint(refPoint);

      expect(mockScene.children).toHaveLength(1);
      expect(mockScene.children[0].name).toBe('current-ref-ref1');

      const mesh = mockScene.children[0] as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.color.getHex()).toBe(0xff0000); // Red
    });

    it('accumulates multiple current ref points', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref1', 48.8567, 2.3523)
      );
      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref2', 48.8568, 2.3524)
      );

      expect(mockScene.children).toHaveLength(2);
      expect(visualizer.getCounts().current).toBe(2);
    });

    /**
     * Why this test matters: R5 — addCurrentRefPoint was creating a new
     * SphereGeometry on every call, leaking GPU memory. The geometry
     * (and its parameters) should be shared across all current ref meshes,
     * matching how displayPriorRefPoints already works.
     */
    it('shares a single geometry across multiple current ref point meshes', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref1', 48.8567, 2.3523)
      );
      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref2', 48.8568, 2.3524)
      );
      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref3', 48.8569, 2.3525)
      );

      const mesh1 = mockScene.children[0] as THREE.Mesh;
      const mesh2 = mockScene.children[1] as THREE.Mesh;
      const mesh3 = mockScene.children[2] as THREE.Mesh;

      // All three meshes should share the same geometry instance
      expect(mesh1.geometry).toBe(mesh2.geometry);
      expect(mesh2.geometry).toBe(mesh3.geometry);
    });
  });

  describe('clearPriorRefPoints', () => {
    it('removes all prior ref meshes from scene', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const refPoints: RefPointMark[] = [
        createMockRefPoint('ref1', 48.8567, 2.3523),
        createMockRefPoint('ref2', 48.8568, 2.3524),
      ];
      visualizer.displayPriorRefPoints(refPoints);
      expect(mockScene.children).toHaveLength(2);

      visualizer.clearPriorRefPoints();

      expect(mockScene.children).toHaveLength(0);
      expect(visualizer.getCounts().prior).toBe(0);
    });
  });

  describe('clearCurrentRefPoints', () => {
    it('removes all current ref meshes from scene', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref1', 48.8567, 2.3523)
      );
      visualizer.addCurrentRefPoint(
        createMockRefPoint('ref2', 48.8568, 2.3524)
      );
      expect(mockScene.children).toHaveLength(2);

      visualizer.clearCurrentRefPoints();

      expect(mockScene.children).toHaveLength(0);
      expect(visualizer.getCounts().current).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('removes all meshes and resets zero ref', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.displayPriorRefPoints([
        createMockRefPoint('prior1', 48.8567, 2.3523),
      ]);
      visualizer.addCurrentRefPoint(
        createMockRefPoint('current1', 48.8568, 2.3524)
      );

      expect(mockScene.children).toHaveLength(2);
      expect(visualizer.getZeroRef()).not.toBeNull();

      visualizer.clearAll();

      expect(mockScene.children).toHaveLength(0);
      expect(visualizer.getZeroRef()).toBeNull();
      expect(visualizer.getCounts()).toEqual({ prior: 0, current: 0 });
    });
  });

  describe('getCounts', () => {
    it('returns correct counts for prior and current ref points', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.displayPriorRefPoints([
        createMockRefPoint('prior1', 48.8567, 2.3523),
        createMockRefPoint('prior2', 48.8568, 2.3524),
      ]);
      visualizer.addCurrentRefPoint(
        createMockRefPoint('current1', 48.8569, 2.3525)
      );

      const counts = visualizer.getCounts();

      expect(counts.prior).toBe(2);
      expect(counts.current).toBe(1);
    });
  });
});

// Test utilities

function createMockRefPoint(
  id: string,
  lat: number,
  lon: number
): RefPointMark {
  return {
    id,
    odomPosition: [1, 2, 3],
    odomRotation: [0, 0, 0, 1],
    gpsPosition: {
      lat,
      lon,
      altitude: 100,
    },
    timestamp: Date.now(),
  };
}
