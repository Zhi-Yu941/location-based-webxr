/**
 * Persistent occlusion mesh — a depth-only `THREE.Mesh` of the occupancy grid.
 *
 * Wraps the pure {@link meshOccupiedCells} (face-culled voxel surface) into a
 * THREE object that **writes depth but no color** (`colorWrite = false`,
 * `depthWrite = true`), drawn before virtual content (low `renderOrder`) so real
 * geometry the camera saw earlier hides virtual objects placed behind it —
 * including out-of-view surfaces a single-frame live depth occluder cannot
 * remember (2026-06-13-occupancy-mesh-options-plan.md §4; complements the live
 * occluder in 2026-06-14-webxr-depth-occlusion-plan.md).
 *
 * Reusable across consumer apps (AnchorStarter / MinimalExample want occlusion
 * too); the recorder only owns the off-by-default toggle + scene wiring.
 *
 * Coordinate space: the grid cells (and therefore the mesh positions) are **raw
 * WebXR**, but the parent `arWorldGroup` is AR-odometry NUE. The mesh carries
 * the constant `WEBXR_TO_NUE` basis change as its own local matrix — identical
 * to `OccupancyCubesVisualizer` — so it rides the `alignment × WEBXR_TO_NUE`
 * chain. The parent node is injected (no `getArWorldGroup()`) to stay testable.
 *
 * Scope: this is a full-rebuild occluder (re-mesh the whole snapshot on
 * `update`). The chunked dirty-remesh perf layer (plan §7) is a follow-on.
 *
 * @see occlusion-mesh.ts.md for detailed documentation
 */

import * as THREE from 'three';
import type { GridCell } from '../ar/bresenham3d.js';
import { meshOccupiedCells, type Aabb } from '../ar/occupancy-mesher.js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';

const MESH_NAME = 'occupancy-occluder';

/** Default render order — well before virtual content (which is ≥ 0). */
const DEFAULT_RENDER_ORDER = -1;

export interface OcclusionMeshOptions {
  /**
   * Merge coplanar faces (fewer triangles, same occluded volume). Default
   * true — the occluder is invisible, so the coarser triangulation is free.
   */
  readonly greedy?: boolean;
  /**
   * `renderOrder` of the depth-only mesh. Must be below virtual content so the
   * occluder lays down depth first. Default −1. (The live occluder, when it
   * exists, sits between this and content — plan §5.)
   */
  readonly renderOrder?: number;
}

/**
 * A depth-only occlusion mesh that rebuilds from an occupancy-grid snapshot.
 * Mirrors {@link OccupancyCubesVisualizer}'s lifecycle (inject parent, `update`,
 * `clear`, `dispose`) so the recorder can wire it the same way as the cubes.
 */
export class OcclusionMesh {
  private readonly arSpaceNode: THREE.Object3D;
  private readonly greedy: boolean;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private lastAabbs: readonly Aabb[] = [];
  private disposed = false;

  /**
   * @param arSpaceNode the AR-odometry-NUE node that receives the alignment
   *   matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay).
   */
  constructor(arSpaceNode: THREE.Object3D, options: OcclusionMeshOptions = {}) {
    this.arSpaceNode = arSpaceNode;
    this.greedy = options.greedy ?? true;
    this.geometry = new THREE.BufferGeometry();
    // Invisible depth-writer: contributes only to the depth buffer, so virtual
    // content's normal depth test hides fragments behind the real surface.
    this.material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = MESH_NAME;
    this.mesh.renderOrder = options.renderOrder ?? DEFAULT_RENDER_ORDER;
    this.mesh.frustumCulled = false; // surface spans the whole room
    // Raw-WebXR positions; the mesh node converts to the parent's NUE frame.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(WEBXR_TO_NUE);
    this.arSpaceNode.add(this.mesh);
  }

  /** The number of triangles currently drawn. */
  getTriangleCount(): number {
    const index = this.geometry.getIndex();
    return index ? index.count / 3 : 0;
  }

  /** The AABB list from the most recent {@link update} (physics export hook). */
  getAabbs(): readonly Aabb[] {
    return this.lastAabbs;
  }

  /**
   * Re-mesh from a fresh occupied-cell snapshot. Pass
   * `grid.getOccupiedCells(occupancy.minConfidence)` so the occluder shares the
   * same noise floor as the cubes and the COLMAP export.
   */
  update(cells: Iterable<GridCell>, cellSizeM: number): void {
    if (this.disposed) return;
    const { positions, indices, aabbs } = meshOccupiedCells(cells, cellSizeM, {
      greedy: this.greedy,
    });
    this.lastAabbs = aabbs;
    // Replace the geometry wholesale — a full rebuild is the simple first cut;
    // dispose the old buffers to avoid leaking GPU memory across refreshes.
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    next.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
  }

  /** Empty the mesh (e.g. on store swap); the node stays in the scene. */
  clear(): void {
    if (this.disposed) return;
    const next = new THREE.BufferGeometry();
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
    this.lastAabbs = [];
  }

  /** Remove the mesh from its parent and release GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arSpaceNode.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.lastAabbs = [];
  }
}
