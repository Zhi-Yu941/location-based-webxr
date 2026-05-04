/**
 * Reference Point Visualizer
 *
 * Creates and manages Three.js meshes for visualizing reference points
 * in GPS-aligned 3D space.
 *
 * ARCHITECTURE NOTE:
 * - Prior reference points (green) are added to scene root (GPS world space)
 * - Current session points (red) are also in GPS world space
 * - Spheres stay in GPS coordinates, independent of alignment matrix
 */

import * as THREE from 'three';
import { getScene } from '../ar/webxr-session';
import type { LatLong, Quaternion, Vector3 } from 'gps-plus-slam-js';
import { calcRelativeCoordsInMeters } from 'gps-plus-slam-js';
import { createLogger } from '../utils/logger';
import { disposeMeshArray } from './three-dispose';
import { VIS_COLORS } from './vis-colors';

/**
 * Structural type for the marks consumed by this visualizer. Mirrors the
 * shape of the recorder app's `RefPointMark` (Iter 3 of the AppFramework /
 * RecorderApp boundary migration extracted the canonical type into the
 * recorder package). The framework keeps a local structural alias so this
 * generic GPS-anchored mesh manager does not depend on recorder modules.
 *
 * Iter 4 will rename this file to a generic `gps-anchored-mesh-manager`
 * and lift the alias into a shared geo-types module.
 */
export interface RefPointMark {
  readonly id: string;
  readonly odomPosition: Vector3;
  readonly odomRotation: Quaternion;
  readonly gpsPosition: { readonly lat: number; readonly lon: number; readonly altitude?: number };
  readonly timestamp: number;
}

const log = createLogger('RefPointVisualizer');

/** Sphere radius in meters (10cm) */
const REF_POINT_RADIUS = 0.1;

/**
 * Manager for reference point visualization
 */
export class RefPointVisualizer {
  private priorRefMeshes: THREE.Mesh[] = [];
  private currentRefMeshes: THREE.Mesh[] = [];
  private zeroRef: LatLong | null = null;
  /** Shared geometry for prior-session ref point meshes (lazy-created) */
  private priorRefGeometry: THREE.SphereGeometry | null = null;
  /** Shared material for prior-session ref point meshes (lazy-created) */
  private priorRefMaterial: THREE.MeshBasicMaterial | null = null;
  /** Shared geometry for current-session ref point meshes (lazy-created) */
  private currentRefGeometry: THREE.SphereGeometry | null = null;

  /**
   * Set the GPS zero reference (origin for coordinate conversion).
   * Must be called before displaying reference points.
   *
   * @param zero - GPS coordinates of the origin
   */
  setZeroRef(zero: LatLong): void {
    this.zeroRef = zero;
  }

  /**
   * Get the current zero reference
   */
  getZeroRef(): LatLong | null {
    return this.zeroRef;
  }

  /**
   * Display reference points from prior sessions.
   * Clears any existing prior ref points first.
   *
   * @param refPoints - Array of reference point marks to visualize
   */
  displayPriorRefPoints(refPoints: readonly RefPointMark[]): void {
    if (!this.zeroRef) {
      log.warn('No zero reference set');
      return;
    }

    const scene = getScene();
    if (!scene) {
      log.warn('Scene not available');
      return;
    }

    // Clear existing prior ref meshes
    this.clearPriorRefPoints();

    // Create shared sphere geometry and material for prior ref points
    const geometry = (this.priorRefGeometry ??= new THREE.SphereGeometry(
      REF_POINT_RADIUS,
      16,
      16
    ));
    const material = (this.priorRefMaterial ??= new THREE.MeshBasicMaterial({
      color: VIS_COLORS.PRIOR_REF_POINT.hex,
    }));

    let visibleCount = 0;
    for (const refPoint of refPoints) {
      if (!refPoint.gpsPosition) {
        continue;
      }

      // Convert GPS to local coordinates (meters from zero)
      const coords = calcRelativeCoordsInMeters(
        this.zeroRef,
        { lat: refPoint.gpsPosition.lat, lon: refPoint.gpsPosition.lon },
        refPoint.gpsPosition.altitude ?? 0,
        0 // origin altitude
      );

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(coords[0], coords[1], coords[2]);
      mesh.name = `prior-ref-${refPoint.id}`;

      scene.add(mesh);
      this.priorRefMeshes.push(mesh);
      visibleCount++;
    }

    log.info(
      `Displayed ${visibleCount}/${refPoints.length} prior reference points`
    );
  }

  /**
   * Add a reference point from the current session.
   *
   * @param refPoint - Reference point mark to visualize
   */
  addCurrentRefPoint(refPoint: RefPointMark): void {
    if (!this.zeroRef || !refPoint.gpsPosition) {
      log.warn(
        'Cannot add current ref point - missing zero ref or GPS position'
      );
      return;
    }

    const scene = getScene();
    if (!scene) {
      log.warn('Scene not available');
      return;
    }

    const coords = calcRelativeCoordsInMeters(
      this.zeroRef,
      { lat: refPoint.gpsPosition.lat, lon: refPoint.gpsPosition.lon },
      refPoint.gpsPosition.altitude ?? 0,
      0
    );

    const geometry = (this.currentRefGeometry ??= new THREE.SphereGeometry(
      REF_POINT_RADIUS,
      16,
      16
    ));
    const material = new THREE.MeshBasicMaterial({
      color: VIS_COLORS.CURRENT_REF_POINT.hex,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(coords[0], coords[1], coords[2]);
    mesh.name = `current-ref-${refPoint.id}`;

    scene.add(mesh);
    this.currentRefMeshes.push(mesh);

    log.info(`Added current ref point: ${refPoint.id}`);
  }

  /**
   * Clear all prior reference point meshes from the scene.
   */
  clearPriorRefPoints(): void {
    const scene = getScene();
    disposeMeshArray(this.priorRefMeshes, scene, {
      skipGeometry: true,
      skipMaterial: true,
    });
    // Dispose the shared geometry and material once, not per-mesh
    this.priorRefGeometry?.dispose();
    this.priorRefGeometry = null;
    this.priorRefMaterial?.dispose();
    this.priorRefMaterial = null;
  }

  /**
   * Clear current session reference point meshes from the scene.
   */
  clearCurrentRefPoints(): void {
    const scene = getScene();
    disposeMeshArray(this.currentRefMeshes, scene, { skipGeometry: true });
    // Dispose the shared geometry once, not per-mesh
    this.currentRefGeometry?.dispose();
    this.currentRefGeometry = null;
  }

  /**
   * Clear all visualizations and reset state.
   */
  clearAll(): void {
    this.clearPriorRefPoints();
    this.clearCurrentRefPoints();
    this.zeroRef = null;
  }

  /**
   * Get count of visible reference points.
   */
  getCounts(): { prior: number; current: number } {
    return {
      prior: this.priorRefMeshes.length,
      current: this.currentRefMeshes.length,
    };
  }
}

/**
 * Singleton instance for global use.
 * Import this to visualize reference points.
 */
export const refPointVisualizer = new RefPointVisualizer();
