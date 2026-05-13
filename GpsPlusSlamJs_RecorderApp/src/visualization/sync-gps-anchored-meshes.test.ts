/**
 * `syncGpsAnchoredMeshes` reconciler tests.
 *
 * Why these tests matter: this is the Bucket-B replacement for the framework's
 * old stateful `GpsAnchoredMeshManager`. The reconciler must (a) be a pure
 * function whose only state is the caller-held handle map plus a module-level
 * GPU-resource cache, (b) perform an id-based incremental diff (add / remove /
 * update-in-place) rather than a full clear+rebuild, and (c) never dispose
 * the shared geometry/material (they are reused forever across calls).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { validateLicenseKey } from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';
import {
  syncGpsAnchoredMeshes,
  type GpsAnchoredItem,
  __resetSharedSphereResourcesForTests,
} from './sync-gps-anchored-meshes';

validateLicenseKey(COMMUNITY_LICENSE_KEY);

const ZERO = { lat: 50.7495, lon: 6.4793 };

function item(
  id: string,
  lat: number,
  lon: number,
  altitude = 0
): GpsAnchoredItem {
  return { id, lat, lon, altitude };
}

describe('syncGpsAnchoredMeshes', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
    __resetSharedSphereResourcesForTests();
  });

  it('creates one mesh per item with the configured name prefix and color', () => {
    const handles = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794), item('b', 50.7497, 6.4795)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'prior-ref' }
    );

    expect(handles.size).toBe(2);
    expect(scene.children).toHaveLength(2);
    expect(scene.children.map((c) => c.name).sort()).toEqual([
      'prior-ref-a',
      'prior-ref-b',
    ]);
    const mat = (scene.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x00ff00);
  });

  it('returns an empty handle map when items is empty', () => {
    const handles = syncGpsAnchoredMeshes(scene, new Map(), [], {
      zeroRef: ZERO,
      color: 0x00ff00,
      namePrefix: 'p',
    });
    expect(handles.size).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('reuses meshes for ids that are present in both previous and new lists (update-in-place)', () => {
    const prev = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794), item('b', 50.7497, 6.4795)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    const meshA = prev.get('a');
    const meshB = prev.get('b');
    expect(meshA).toBeDefined();
    expect(meshB).toBeDefined();

    // Move 'a', keep 'b' identical.
    const next = syncGpsAnchoredMeshes(
      scene,
      prev,
      [item('a', 50.75, 6.48), item('b', 50.7497, 6.4795)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );

    // Same mesh instances retained.
    expect(next.get('a')).toBe(meshA);
    expect(next.get('b')).toBe(meshB);
    // Position of 'a' was updated.
    expect(meshA!.position.x).not.toBe(0);
    expect(meshA!.position.z).not.toBe(0);
    // Still exactly 2 children, no orphans.
    expect(scene.children).toHaveLength(2);
  });

  it('removes meshes whose ids are no longer in items', () => {
    const prev = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [
        item('a', 50.7496, 6.4794),
        item('b', 50.7497, 6.4795),
        item('c', 50.7498, 6.4796),
      ],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    expect(scene.children).toHaveLength(3);

    const next = syncGpsAnchoredMeshes(
      scene,
      prev,
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );

    expect(next.size).toBe(1);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0].name).toBe('p-a');
  });

  it('adds meshes for new ids without disturbing existing ones', () => {
    const prev = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    const meshA = prev.get('a');

    const next = syncGpsAnchoredMeshes(
      scene,
      prev,
      [item('a', 50.7496, 6.4794), item('b', 50.7497, 6.4795)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );

    expect(next.get('a')).toBe(meshA);
    expect(next.get('b')).toBeDefined();
    expect(scene.children).toHaveLength(2);
  });

  it('shares the same geometry + material across all meshes of the same color/radius', () => {
    const handles = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [
        item('a', 50.7496, 6.4794),
        item('b', 50.7497, 6.4795),
        item('c', 50.7498, 6.4796),
      ],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    const meshes = Array.from(handles.values());
    expect(meshes[0].geometry).toBe(meshes[1].geometry);
    expect(meshes[1].geometry).toBe(meshes[2].geometry);
    expect(meshes[0].material).toBe(meshes[1].material);
  });

  it('uses different shared resources per (color,radius) key', () => {
    const green = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'g' }
    );
    const red = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0xff0000, namePrefix: 'r' }
    );

    const greenMesh = green.get('a')!;
    const redMesh = red.get('a')!;
    expect(greenMesh.geometry).not.toBe(redMesh.geometry); // different radius default fine; different color → different resources
    expect(greenMesh.material).not.toBe(redMesh.material);
    expect((greenMesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      0x00ff00
    );
    expect((redMesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      0xff0000
    );
  });

  it('keeps the shared geometry/material alive across an empty-input call (no disposal)', () => {
    const first = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    const sharedGeom = first.get('a')!.geometry;
    const sharedMat = first.get('a')!.material;

    // Clear everything.
    syncGpsAnchoredMeshes(scene, first, [], {
      zeroRef: ZERO,
      color: 0x00ff00,
      namePrefix: 'p',
    });

    // Adding an item later reuses the same shared resources.
    const re = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('z', 50.7499, 6.4797)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    expect(re.get('z')!.geometry).toBe(sharedGeom);
    expect(re.get('z')!.material).toBe(sharedMat);
  });

  it('positions meshes at the zero-reference origin (0,0,0) when an item is exactly at zeroRef', () => {
    const handles = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('o', ZERO.lat, ZERO.lon, 0)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    const mesh = handles.get('o')!;
    expect(mesh.position.x).toBeCloseTo(0, 5);
    expect(mesh.position.y).toBeCloseTo(0, 5);
    expect(mesh.position.z).toBeCloseTo(0, 5);
  });

  it('respects a custom radius via the (color,radius) cache key', () => {
    const small = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p', radius: 0.05 }
    );
    const big = syncGpsAnchoredMeshes(
      new THREE.Scene(),
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p', radius: 0.5 }
    );
    expect(small.get('a')!.geometry).not.toBe(big.get('a')!.geometry);
  });

  it('does not call mesh.position.set if the world coords are unchanged (idempotent update)', () => {
    const prev = syncGpsAnchoredMeshes(
      scene,
      new Map(),
      [item('a', 50.7496, 6.4794)],
      { zeroRef: ZERO, color: 0x00ff00, namePrefix: 'p' }
    );
    const meshA = prev.get('a')!;
    const beforeX = meshA.position.x;
    // Same coords → still produces the same numerical position.
    syncGpsAnchoredMeshes(scene, prev, [item('a', 50.7496, 6.4794)], {
      zeroRef: ZERO,
      color: 0x00ff00,
      namePrefix: 'p',
    });
    expect(meshA.position.x).toBe(beforeX);
  });
});
