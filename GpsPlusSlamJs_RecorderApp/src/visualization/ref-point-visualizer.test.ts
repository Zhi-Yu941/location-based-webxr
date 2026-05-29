/**
 * Reference Point Visualizer Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateLicenseKey } from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';
import { RefPointVisualizer } from './ref-point-visualizer';
import type { RefPointMark } from '../storage/ref-point-loader';
import type { LatLong } from 'gps-plus-slam-app-framework/core';
import type { RefPointEntry } from '../state/ref-points-slice';
import * as THREE from 'three';

// Activate the gps-plus-slam-js license once for this suite so calls into
// `calcRelativeCoordsInMeters` from `syncGpsAnchoredMeshes` succeed without
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

  describe('syncRefPoints', () => {
    it('does nothing if zero ref not set', () => {
      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
      ]);

      expect(mockScene.children).toHaveLength(0);
      expect(visualizer.getRefPointCount()).toBe(0);
    });

    /**
     * Why this test matters: `syncRefPoints` no-ops while `zeroRef` is
     * null. The class docstring promises "the next call once the AR
     * session is up will reconcile", but the only place a zero reference
     * arrives is `setZeroRef`. Without caching the last entries, points
     * pushed before GPS lock are silently dropped until an unrelated
     * store mutation re-triggers the subscriber. This codifies that
     * `setZeroRef` itself replays the cached entries so the visualizer
     * is self-healing and not dependent on subscriber ordering.
     */
    it('renders cached entries when zeroRef arrives after syncRefPoints', () => {
      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
        createMockReferencePoint('rp2', 48.8568, 2.3524),
      ]);

      // No zero ref yet — nothing rendered.
      expect(visualizer.getRefPointCount()).toBe(0);

      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      // setZeroRef replays the cached entries.
      expect(visualizer.getRefPointCount()).toBe(2);
      expect(mockScene.children).toHaveLength(2);
    });

    it('does not replay stale entries after clearAll', () => {
      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
      ]);
      visualizer.clearAll();

      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      expect(visualizer.getRefPointCount()).toBe(0);
      expect(mockScene.children).toHaveLength(0);
    });

    it('renders all marks uniformly with the same colour and name prefix', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
        createMockReferencePoint('rp2', 48.8568, 2.3524),
      ]);

      expect(mockScene.children).toHaveLength(2);
      expect(mockScene.children[0].name).toBe('ref-point-rp1');
      expect(mockScene.children[1].name).toBe('ref-point-rp2');

      const mesh1 = mockScene.children[0] as THREE.Mesh;
      const mesh2 = mockScene.children[1] as THREE.Mesh;
      const mat1 = mesh1.material as THREE.MeshBasicMaterial;
      const mat2 = mesh2.material as THREE.MeshBasicMaterial;
      expect(mat1.color.getHex()).toBe(mat2.color.getHex());
    });

    it('starts a transient insert animation on newly-inserted ids', async () => {
      const { runFrameUpdates, clearFrameUpdates } =
        await import('gps-plus-slam-app-framework/ar/frame-loop');
      clearFrameUpdates();
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
      ]);

      const mesh = mockScene.children[0] as THREE.Mesh;
      // Animation kicks off at 0.2 scale and exposes its tick callback so
      // tests can detect that it was scheduled without relying on wall clock.
      expect(mesh.scale.x).toBeCloseTo(0.2);
      expect(
        (mesh.userData as { refPointInsertAnimation?: unknown })
          .refPointInsertAnimation
      ).toBeDefined();

      // Drive the frame loop past the animation duration; mesh should
      // land on scale 1 and clear the in-progress marker.
      runFrameUpdates(1.0, 1.0);
      expect(mesh.scale.x).toBeCloseTo(1);
      expect(
        (mesh.userData as { refPointInsertAnimation?: unknown })
          .refPointInsertAnimation
      ).toBeUndefined();
    });

    it('does not restart the animation on re-render of the same id', async () => {
      const { runFrameUpdates, clearFrameUpdates } =
        await import('gps-plus-slam-app-framework/ar/frame-loop');
      clearFrameUpdates();
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const rp1 = createMockReferencePoint('rp1', 48.8567, 2.3523);
      visualizer.syncRefPoints([rp1]);
      runFrameUpdates(1.0, 1.0); // run animation to completion
      const mesh = mockScene.children[0] as THREE.Mesh;
      expect(mesh.scale.x).toBeCloseTo(1);

      // Re-call with the same id — the diff should treat rp1 as already
      // known and not kick the animation again.
      visualizer.syncRefPoints([rp1]);
      expect(mesh.scale.x).toBeCloseTo(1);
      expect(
        (mesh.userData as { refPointInsertAnimation?: unknown })
          .refPointInsertAnimation
      ).toBeUndefined();
    });

    it('only animates the newly-inserted id when appending to an existing set', async () => {
      const { runFrameUpdates, clearFrameUpdates } =
        await import('gps-plus-slam-app-framework/ar/frame-loop');
      clearFrameUpdates();
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

      const rp1 = createMockReferencePoint('rp1', 48.8567, 2.3523);
      visualizer.syncRefPoints([rp1]);
      runFrameUpdates(1.0, 1.0);
      const mesh1 = mockScene.children[0] as THREE.Mesh;
      expect(mesh1.scale.x).toBeCloseTo(1);

      const rp2 = createMockReferencePoint('rp2', 48.8568, 2.3524);
      visualizer.syncRefPoints([rp1, rp2]);

      const mesh2 = mockScene.children.find(
        (c) => c.name === 'ref-point-rp2'
      ) as THREE.Mesh;
      expect(mesh2).toBeDefined();
      expect(mesh1.scale.x).toBeCloseTo(1); // untouched
      expect(mesh2.scale.x).toBeCloseTo(0.2); // animating
    });

    /**
     * Why this test matters: when the user re-captures an already-known
     * H3 cell during a live session, `addRefPointEntry` appends a second
     * `RefPointEntry` that shares the cell `id` (the first being the
     * imported sidecar centroid, the second the fresh live tap). The
     * reconciler keys meshes by `id`, so the cell stays a single sphere —
     * but *which* GPS position wins is a deliberate product decision:
     * the **latest live observation supersedes the historical centroid**
     * (last-occurrence-wins), because the fresh fused fix is the better
     * estimate. This test pins that rule for the same-id-within-one-list
     * case; without it the behaviour was implicit and untested
     * (2026-05-29-refpoint-single-sphere-vs-multi-sphere-review.md §3.3).
     */
    it('renders one sphere at the LAST entry position when entries share an id', async () => {
      const { calcRelativeCoordsInMeters } = await import(
        'gps-plus-slam-app-framework/core'
      );
      const zeroRef: LatLong = { lat: 48.8566, lon: 2.3522 };
      visualizer.setZeroRef(zeroRef);

      // Imported centroid entry, then a live re-observation a few metres
      // away — both for the same H3 cell id 'cellX'.
      const imported = createMockReferencePoint('cellX', 48.85670, 2.35230);
      const liveTap = createMockReferencePoint('cellX', 48.85675, 2.35240);
      visualizer.syncRefPoints([imported, liveTap]);

      // Single sphere for the cell.
      expect(visualizer.getRefPointCount()).toBe(1);
      expect(mockScene.children).toHaveLength(1);

      // Positioned at the LAST (live) entry's coords, not the first.
      const mesh = mockScene.children[0] as THREE.Mesh;
      const expected = calcRelativeCoordsInMeters(
        zeroRef,
        { lat: 48.85675, lon: 2.35240 },
        100,
        0
      );
      expect(mesh.position.x).toBeCloseTo(expected[0], 5);
      expect(mesh.position.y).toBeCloseTo(expected[1], 5);
      expect(mesh.position.z).toBeCloseTo(expected[2], 5);
    });

    /**
     * Why this test matters: the same last-write-wins rule must also hold
     * across successive `syncRefPoints` calls (the real subscriber path —
     * each store mutation triggers a fresh call). Re-observing a cell
     * moves its existing sphere to the latest position in place; the mesh
     * instance is preserved (no insert animation re-fires) but its
     * coordinates track the newest live tap. Pins
     * 2026-05-29-refpoint-single-sphere-vs-multi-sphere-review.md §3.3.
     */
    it('moves an existing sphere to the latest position on re-observation', async () => {
      const { calcRelativeCoordsInMeters } = await import(
        'gps-plus-slam-app-framework/core'
      );
      const zeroRef: LatLong = { lat: 48.8566, lon: 2.3522 };
      visualizer.setZeroRef(zeroRef);

      const first = createMockReferencePoint('cellX', 48.85670, 2.35230);
      visualizer.syncRefPoints([first]);
      const mesh = mockScene.children[0] as THREE.Mesh;

      // Re-observe the same cell at a new position.
      const reobserved = createMockReferencePoint('cellX', 48.85680, 2.35250);
      visualizer.syncRefPoints([reobserved]);

      // Same mesh instance reused (still one sphere), moved to new coords.
      expect(visualizer.getRefPointCount()).toBe(1);
      expect(mockScene.children).toHaveLength(1);
      expect(mockScene.children[0]).toBe(mesh);
      const expected = calcRelativeCoordsInMeters(
        zeroRef,
        { lat: 48.85680, lon: 2.35250 },
        100,
        0
      );
      expect(mesh.position.x).toBeCloseTo(expected[0], 5);
      expect(mesh.position.y).toBeCloseTo(expected[1], 5);
      expect(mesh.position.z).toBeCloseTo(expected[2], 5);
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

function createMockReferencePoint(
  id: string,
  latitude: number,
  longitude: number
): RefPointEntry {
  return {
    id,
    timestamp: Date.now(),
    rawGpsPoint: {
      id: `gps-${id}`,
      latitude,
      longitude,
      altitude: 100,
      timestamp: Date.now(),
    },
  };
}
