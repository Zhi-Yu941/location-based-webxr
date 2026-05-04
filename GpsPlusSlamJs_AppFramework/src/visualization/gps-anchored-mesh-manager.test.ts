/**
 * GpsAnchoredMeshManager tests.
 *
 * Why these tests matter: this is the generic core extracted from
 * `RefPointVisualizer` in Iter 4. Together with the recorder-side composition
 * tests in `ref-point-visualizer.test.ts`, they prove the behaviour is the
 * same as before the split.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import type { LatLong } from 'gps-plus-slam-js';
import { GpsAnchoredMeshManager } from './gps-anchored-mesh-manager';

vi.mock('../ar/webxr-session', () => ({
  getScene: vi.fn(),
}));

import { getScene } from '../ar/webxr-session';

describe('GpsAnchoredMeshManager', () => {
  let mgr: GpsAnchoredMeshManager;
  let scene: THREE.Scene;

  beforeEach(() => {
    mgr = new GpsAnchoredMeshManager({
      color: 0x00ff00,
      namePrefix: 'anchor',
    });
    scene = new THREE.Scene();
    vi.mocked(getScene).mockReturnValue(scene);
  });

  it('stores and reads back the zero reference', () => {
    const zero: LatLong = { lat: 50.7495, lon: 6.4793 };
    mgr.setZeroRef(zero);
    expect(mgr.getZeroRef()).toEqual(zero);
  });

  it('setItems is a no-op without a zero reference', () => {
    mgr.setItems([{ id: 'a', lat: 50.7496, lon: 6.4794 }]);
    expect(scene.children).toHaveLength(0);
    expect(mgr.getCount()).toBe(0);
  });

  it('setItems is a no-op when no scene is available', () => {
    vi.mocked(getScene).mockReturnValue(null);
    mgr.setZeroRef({ lat: 50.7495, lon: 6.4793 });
    mgr.setItems([{ id: 'a', lat: 50.7496, lon: 6.4794 }]);
    expect(mgr.getCount()).toBe(0);
  });

  it('setItems creates one mesh per item with the configured color', () => {
    mgr.setZeroRef({ lat: 50.7495, lon: 6.4793 });
    mgr.setItems([
      { id: 'a', lat: 50.7496, lon: 6.4794 },
      { id: 'b', lat: 50.7497, lon: 6.4795 },
    ]);
    expect(scene.children).toHaveLength(2);
    expect(scene.children[0].name).toBe('anchor-a');
    expect(scene.children[1].name).toBe('anchor-b');
    const mesh = scene.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x00ff00);
  });

  it('setItems replaces the previous mesh set', () => {
    mgr.setZeroRef({ lat: 50.7495, lon: 6.4793 });
    mgr.setItems([{ id: 'a', lat: 50.7496, lon: 6.4794 }]);
    mgr.setItems([
      { id: 'b', lat: 50.7497, lon: 6.4795 },
      { id: 'c', lat: 50.7498, lon: 6.4796 },
    ]);
    expect(scene.children.map((c) => c.name)).toEqual([
      'anchor-b',
      'anchor-c',
    ]);
  });

  it('addItem appends meshes and shares a single geometry', () => {
    mgr.setZeroRef({ lat: 50.7495, lon: 6.4793 });
    mgr.addItem({ id: 'a', lat: 50.7496, lon: 6.4794 });
    mgr.addItem({ id: 'b', lat: 50.7497, lon: 6.4795 });
    mgr.addItem({ id: 'c', lat: 50.7498, lon: 6.4796 });
    expect(mgr.getCount()).toBe(3);
    const m0 = scene.children[0] as THREE.Mesh;
    const m1 = scene.children[1] as THREE.Mesh;
    const m2 = scene.children[2] as THREE.Mesh;
    expect(m0.geometry).toBe(m1.geometry);
    expect(m1.geometry).toBe(m2.geometry);
  });

  it('clear removes all meshes and resets count', () => {
    mgr.setZeroRef({ lat: 50.7495, lon: 6.4793 });
    mgr.setItems([
      { id: 'a', lat: 50.7496, lon: 6.4794 },
      { id: 'b', lat: 50.7497, lon: 6.4795 },
    ]);
    mgr.clear();
    expect(scene.children).toHaveLength(0);
    expect(mgr.getCount()).toBe(0);
  });

  it('honors a custom namePrefix and color', () => {
    const red = new GpsAnchoredMeshManager({
      color: 0xff0000,
      namePrefix: 'current',
    });
    red.setZeroRef({ lat: 50.7495, lon: 6.4793 });
    red.setItems([{ id: 'x', lat: 50.7496, lon: 6.4794 }]);
    expect(scene.children[0].name).toBe('current-x');
    const mat = (scene.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0xff0000);
  });
});
