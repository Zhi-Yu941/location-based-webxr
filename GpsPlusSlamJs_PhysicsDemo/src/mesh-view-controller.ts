/**
 * Mesh-view controller — live visibility + Cubes/Detailed toggle for the
 * reconstructed occupancy mesh.
 *
 * Built demo-local (2026-07-15 interview decision): promote to the framework only
 * once its shape is validated by this first consumer. It owns the two framework
 * visualizers `startReplaySession` exposes and flips them live and cheaply:
 *   - cubes → `OccupancyCubesVisualizer.setVisible` (O(1) instanced-mesh flip),
 *   - detailed → `OcclusionMesh.setDebugStyle` (the occluder geometry is always
 *     depth-only; the *visible* skin is the debug style).
 *
 * Design principle (from the physics-demo design): the visible style mirrors the
 * collider type the balls hit — Cubes ↔ AABB-compound, Detailed ↔ trimesh — so
 * the developer literally sees the surface physics uses. This controller owns the
 * *visible* half; the collider half is wired alongside it when physics lands.
 */

import type { OccluderDebugStyle } from "gps-plus-slam-app-framework/visualization";

/** Which visible representation of the reconstructed mesh is shown. */
export type MeshStyle = "cubes" | "detailed";

/** The cube-visualizer surface this controller drives (structural for testing). */
interface CubeTarget {
  setVisible(visible: boolean): void;
}

/** The occlusion-mesh surface this controller drives (structural for testing). */
interface OcclusionTarget {
  setDebugStyle(style: OccluderDebugStyle): void;
}

export interface MeshViewTargets {
  readonly cubes: CubeTarget | null;
  readonly occlusionMesh: OcclusionTarget | null;
}

export interface MeshViewOptions {
  /** Whether the mesh is shown at all. Default `true`. */
  readonly visible?: boolean;
  /** Initial style. Default `'cubes'` (the robust first-paint choice). */
  readonly style?: MeshStyle;
  /** Which occluder debug skin represents "detailed". Default `'wireframe'`. */
  readonly detailedStyle?: OccluderDebugStyle;
}

export interface MeshViewController {
  /** Show or hide the whole reconstructed mesh (both styles). */
  setVisible(visible: boolean): void;
  /** Switch between the cube and detailed representations. */
  setStyle(style: MeshStyle): void;
  getVisible(): boolean;
  getStyle(): MeshStyle;
}

/**
 * Create the controller and apply the initial state immediately, so the visible
 * mesh matches `options` from the first frame.
 */
export function createMeshViewController(
  targets: MeshViewTargets,
  options: MeshViewOptions = {},
): MeshViewController {
  let visible = options.visible ?? true;
  let style: MeshStyle = options.style ?? "cubes";
  const detailedStyle: OccluderDebugStyle =
    options.detailedStyle ?? "wireframe";

  const apply = (): void => {
    const showCubes = visible && style === "cubes";
    const showDetailed = visible && style === "detailed";
    // Exactly one representation is visible at a time; the other is fully off,
    // so cubes and the detailed skin never double up on the same surface.
    targets.cubes?.setVisible(showCubes);
    targets.occlusionMesh?.setDebugStyle(showDetailed ? detailedStyle : "off");
  };

  apply();

  return {
    setVisible(next: boolean): void {
      visible = next;
      apply();
    },
    setStyle(next: MeshStyle): void {
      style = next;
      apply();
    },
    getVisible(): boolean {
      return visible;
    },
    getStyle(): MeshStyle {
      return style;
    },
  };
}
