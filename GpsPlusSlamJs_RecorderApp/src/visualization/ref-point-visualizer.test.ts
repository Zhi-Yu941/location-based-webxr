/**
 * Reference Point Visualizer Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateLicenseKey } from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';
import { RefPointVisualizer } from './ref-point-visualizer';
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

  describe('clearAll', () => {
    // Why this test matters: clearAll is the session-reset hook — leftover
    // meshes or a stale zeroRef would leak markers into the next session.
    // (Rewritten over syncRefPoints when the legacy prior/current pipeline
    // was removed — quality-review D-1.)
    it('removes all synced meshes and resets zero ref', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
        createMockReferencePoint('rp2', 48.8568, 2.3524),
      ]);
      expect(mockScene.children.length).toBeGreaterThan(0);

      visualizer.clearAll();

      expect(mockScene.children).toHaveLength(0);
      expect(visualizer.getZeroRef()).toBeNull();
      expect(visualizer.getRefPointCount()).toBe(0);
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
     * Why this test matters (D5, 2026-06-16 user feedback): the field tester
     * "barely saw" the ref-point marker amid the compass + point-cloud cubes.
     * The decision keeps those cubes ON and instead makes the ref-point marker
     * the ONLY sphere that grows — to double the `syncGpsAnchoredMeshes`
     * default radius (0.1 → 0.2) — while the other GPS-anchored debug spheres
     * halve. Lock the *rendered geometry radius* (not just the opts literal) so
     * a future refactor of `REF_POINT_OPTS` can't silently drop it.
     */
    it('renders the ref-point marker at the doubled 0.2 m radius so it stays spottable', () => {
      visualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });
      visualizer.syncRefPoints([
        createMockReferencePoint('rp1', 48.8567, 2.3523),
      ]);

      const mesh = mockScene.children[0] as THREE.Mesh;
      const geo = mesh.geometry as THREE.SphereGeometry;
      expect(geo.parameters.radius).toBeCloseTo(0.2);
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
      const { calcRelativeCoordsInMeters } =
        await import('gps-plus-slam-app-framework/core');
      const zeroRef: LatLong = { lat: 48.8566, lon: 2.3522 };
      visualizer.setZeroRef(zeroRef);

      // Imported centroid entry, then a live re-observation a few metres
      // away — both for the same H3 cell id 'cellX'.
      const imported = createMockReferencePoint('cellX', 48.8567, 2.3523);
      const liveTap = createMockReferencePoint('cellX', 48.85675, 2.3524);
      visualizer.syncRefPoints([imported, liveTap]);

      // Single sphere for the cell.
      expect(visualizer.getRefPointCount()).toBe(1);
      expect(mockScene.children).toHaveLength(1);

      // Positioned at the LAST (live) entry's coords, not the first.
      const mesh = mockScene.children[0] as THREE.Mesh;
      const expected = calcRelativeCoordsInMeters(
        zeroRef,
        { lat: 48.85675, lon: 2.3524 },
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
      const { calcRelativeCoordsInMeters } =
        await import('gps-plus-slam-app-framework/core');
      const zeroRef: LatLong = { lat: 48.8566, lon: 2.3522 };
      visualizer.setZeroRef(zeroRef);

      const first = createMockReferencePoint('cellX', 48.8567, 2.3523);
      visualizer.syncRefPoints([first]);
      const mesh = mockScene.children[0] as THREE.Mesh;

      // Re-observe the same cell at a new position.
      const reobserved = createMockReferencePoint('cellX', 48.8568, 2.3525);
      visualizer.syncRefPoints([reobserved]);

      // Same mesh instance reused (still one sphere), moved to new coords.
      expect(visualizer.getRefPointCount()).toBe(1);
      expect(mockScene.children).toHaveLength(1);
      expect(mockScene.children[0]).toBe(mesh);
      const expected = calcRelativeCoordsInMeters(
        zeroRef,
        { lat: 48.8568, lon: 2.3525 },
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
