/**
 * GPS-Anchored Mesh Manager
 *
 * Generic mechanism for placing Three.js meshes at GPS coordinates relative
 * to a configured GPS zero reference. This is the recorder-agnostic core
 * that was extracted in Iter 4 from the recorder-flavoured
 * `RefPointVisualizer` (which now lives in the RecorderApp and composes two
 * instances of this manager — prior=green, current=red).
 *
 * The manager is intentionally narrow: it knows how to convert
 * `{ lat, lon, altitude? }` into local meters via the framework's GPS zero
 * reference, allocate a single shared geometry + material per instance, and
 * keep the resulting mesh group in sync with caller-provided items. It does
 * not know anything about ref points, sessions, or recorder semantics.
 */

import * as THREE from 'three';
import type { LatLong } from 'gps-plus-slam-js';
import { calcRelativeCoordsInMeters } from 'gps-plus-slam-js';
import { getScene } from '../ar/webxr-session';
import { createLogger } from '../utils/logger';
import { disposeMeshArray } from './three-dispose';

/**
 * Plain GPS-anchored item consumed by the manager. Callers project their
 * domain types (ref points, POIs, anchors, …) onto this shape.
 */
export interface GpsAnchoredItem {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly altitude?: number;
}

export interface GpsAnchoredMeshManagerOptions {
  /** Hex color for the shared material (e.g. `0x00ff00`). */
  readonly color: number;
  /** Sphere radius in meters. Defaults to `0.1` (10 cm). */
  readonly radius?: number;
  /** Mesh `name` prefix. Mesh names become `${namePrefix}-${item.id}`. */
  readonly namePrefix: string;
  /** Logger label. Defaults to `'GpsAnchoredMeshManager'`. */
  readonly loggerLabel?: string;
}

const DEFAULT_RADIUS = 0.1;

/**
 * Manages a single colored mesh group anchored to GPS coordinates.
 * One instance == one color/group.
 */
export class GpsAnchoredMeshManager {
  private readonly color: number;
  private readonly radius: number;
  private readonly namePrefix: string;
  private readonly log: ReturnType<typeof createLogger>;

  private meshes: THREE.Mesh[] = [];
  private zeroRef: LatLong | null = null;
  private geometry: THREE.SphereGeometry | null = null;
  private material: THREE.MeshBasicMaterial | null = null;

  constructor(options: GpsAnchoredMeshManagerOptions) {
    this.color = options.color;
    this.radius = options.radius ?? DEFAULT_RADIUS;
    this.namePrefix = options.namePrefix;
    this.log = createLogger(
      options.loggerLabel ?? 'GpsAnchoredMeshManager'
    );
  }

  /** Set the GPS origin used to project items into local meters. */
  setZeroRef(zero: LatLong): void {
    this.zeroRef = zero;
  }

  getZeroRef(): LatLong | null {
    return this.zeroRef;
  }

  /**
   * Replace the entire mesh group with one mesh per provided item.
   * Items without GPS or before `setZeroRef` are skipped.
   */
  setItems(items: readonly GpsAnchoredItem[]): void {
    if (!this.zeroRef) {
      this.log.warn('No zero reference set');
      return;
    }
    const scene = getScene();
    if (!scene) {
      this.log.warn('Scene not available');
      return;
    }

    this.clear();

    const geometry = (this.geometry ??= new THREE.SphereGeometry(
      this.radius,
      16,
      16
    ));
    const material = (this.material ??= new THREE.MeshBasicMaterial({
      color: this.color,
    }));

    let visibleCount = 0;
    for (const item of items) {
      const coords = calcRelativeCoordsInMeters(
        this.zeroRef,
        { lat: item.lat, lon: item.lon },
        item.altitude ?? 0,
        0
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(coords[0], coords[1], coords[2]);
      mesh.name = `${this.namePrefix}-${item.id}`;
      scene.add(mesh);
      this.meshes.push(mesh);
      visibleCount++;
    }
    this.log.info(`Displayed ${visibleCount}/${items.length} anchored meshes`);
  }

  /** Append a single item to the existing mesh group. */
  addItem(item: GpsAnchoredItem): void {
    if (!this.zeroRef) {
      this.log.warn('Cannot add item — no zero reference');
      return;
    }
    const scene = getScene();
    if (!scene) {
      this.log.warn('Scene not available');
      return;
    }

    const geometry = (this.geometry ??= new THREE.SphereGeometry(
      this.radius,
      16,
      16
    ));
    const material = (this.material ??= new THREE.MeshBasicMaterial({
      color: this.color,
    }));
    const coords = calcRelativeCoordsInMeters(
      this.zeroRef,
      { lat: item.lat, lon: item.lon },
      item.altitude ?? 0,
      0
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(coords[0], coords[1], coords[2]);
    mesh.name = `${this.namePrefix}-${item.id}`;
    scene.add(mesh);
    this.meshes.push(mesh);
    this.log.info(`Added anchored mesh: ${item.id}`);
  }

  /** Remove all meshes and dispose the shared geometry/material. */
  clear(): void {
    const scene = getScene();
    disposeMeshArray(this.meshes, scene, {
      skipGeometry: true,
      skipMaterial: true,
    });
    this.geometry?.dispose();
    this.geometry = null;
    this.material?.dispose();
    this.material = null;
  }

  /** Number of meshes currently rendered. */
  getCount(): number {
    return this.meshes.length;
  }

  /** Convenience: clear and forget the zero reference. */
  dispose(): void {
    this.clear();
    this.zeroRef = null;
  }
}
