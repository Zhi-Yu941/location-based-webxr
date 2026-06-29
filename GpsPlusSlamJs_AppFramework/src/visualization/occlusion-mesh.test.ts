/**
 * OcclusionMesh — unit tests.
 *
 * Why this test matters:
 * OcclusionMesh is the THREE adapter that turns the pure `meshOccupiedCells`
 * output into a depth-only occluder Mesh parented under `arWorldGroup`. These
 * tests pin the things that make it an *occluder* and not a visible mesh: the
 * material writes depth but not color, the node carries the WEBXR_TO_NUE basis
 * (so it rides alignment like the cubes), `update` rebuilds geometry from a
 * snapshot, `clear` empties it, and `dispose` detaches + frees. The geometry
 * counts come straight from the mesher's proven invariants.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { GridCell } from '../ar/bresenham3d';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis';
import { OcclusionMesh } from './occlusion-mesh';

function findMesh(parent: THREE.Object3D): THREE.Mesh | undefined {
  return parent.children.find((c) => c instanceof THREE.Mesh) as
    | THREE.Mesh
    | undefined;
}

describe('OcclusionMesh', () => {
  it('attaches a depth-only mesh under the injected node with the NUE basis', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const mesh = findMesh(parent);
    expect(mesh).toBeDefined();
    const material = mesh!.material as THREE.MeshBasicMaterial;
    // Invisible depth-writer: this is what makes it occlude rather than show.
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    // Drawn before virtual content (renderOrder ≥ 0).
    expect(mesh!.renderOrder).toBeLessThan(0);
    // Carries the raw-WebXR → NUE basis change as its local matrix.
    expect(mesh!.matrixAutoUpdate).toBe(false);
    expect(mesh!.matrix.elements).toEqual(WEBXR_TO_NUE.elements);
    occluder.dispose();
  });

  it('starts empty and meshes a snapshot on update', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    expect(occluder.getTriangleCount()).toBe(0);

    // Single isolated voxel → 6 faces → 12 triangles (greedy can't merge one).
    occluder.update([[0, 0, 0]], 0.15);
    expect(occluder.getTriangleCount()).toBe(12);
    expect(occluder.getAabbs()).toHaveLength(1);
    occluder.dispose();
  });

  it('greedy-merges a flat slab (default greedy=true) to fewer triangles', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) cells.push([x, y, 0]);

    const greedy = new OcclusionMesh(new THREE.Group());
    greedy.update(cells, 0.15);
    const perFace = new OcclusionMesh(new THREE.Group(), { greedy: false });
    perFace.update(cells, 0.15);

    // 5×5×1 slab: greedy → 6 quads (12 tris); per-face → 70 quads (140 tris).
    expect(greedy.getTriangleCount()).toBe(12);
    expect(perFace.getTriangleCount()).toBe(140);
    // AABB list is unaffected by greedy — one box per cell either way.
    expect(greedy.getAabbs()).toHaveLength(25);
    expect(perFace.getAabbs()).toHaveLength(25);
    greedy.dispose();
    perFace.dispose();
  });

  it('clear() empties the geometry but keeps the node attached', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update([[0, 0, 0]], 0.15);
    occluder.clear();
    expect(occluder.getTriangleCount()).toBe(0);
    expect(occluder.getAabbs()).toHaveLength(0);
    expect(findMesh(parent)).toBeDefined(); // still in scene
    occluder.dispose();
  });

  it('dispose() removes the mesh and is idempotent', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update([[0, 0, 0]], 0.15);
    occluder.dispose();
    expect(findMesh(parent)).toBeUndefined();
    // No-op after dispose (no throw, no re-mesh).
    occluder.update([[1, 1, 1]], 0.15);
    expect(() => occluder.dispose()).not.toThrow();
  });
});
