/**
 * `syncGpsAnchoredMeshes` — pure-function reconciler for a set of small
 * `THREE.Mesh` markers anchored at GPS coordinates.
 *
 * Replaces the framework's old stateful `GpsAnchoredMeshManager` class.
 *
 * Design (see
 * GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md
 * sections P2 and "Next implementation step"):
 *
 * - **Caller owns the handle map** (`Map<id, THREE.Mesh>`). The reconciler
 *   accepts the previous map, produces a new one, and never holds state
 *   between calls.
 * - **Scene is injected explicitly.** No `getScene()` call (P3 rule 1).
 * - **Id-based incremental diff.** Items present only in the new list are
 *   created and added to the scene; items present only in the previous map
 *   are removed from the scene; items present in both have their position
 *   updated in place — the existing `THREE.Mesh` instance is preserved.
 * - **Shared GPU resources (`SphereGeometry`, `MeshBasicMaterial`) are
 *   cached at module scope** keyed by `"{color}|{radius}"`, allocated
 *   lazily on first use, and **never disposed**. They represent true
 *   external-resource ownership of a small, finite set of marker styles;
 *   the next caller with the same style reuses them.
 */

import * as THREE from 'three';
import type { LatLong } from 'gps-plus-slam-app-framework/core';
import { calcRelativeCoordsInMeters } from 'gps-plus-slam-app-framework/core';

/**
 * Plain GPS-anchored item consumed by the reconciler. Callers project their
 * domain types (ref points, POIs, anchors, …) onto this shape.
 */
export interface GpsAnchoredItem {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly altitude?: number;
}

export interface SyncGpsAnchoredMeshesOptions {
  /** GPS origin used to project items into local meters via `calcRelativeCoordsInMeters`. */
  readonly zeroRef: LatLong;
  /** Hex color for the shared `MeshBasicMaterial` (e.g. `0x00ff00`). */
  readonly color: number;
  /** Sphere radius in meters. Defaults to `0.1` (10 cm). */
  readonly radius?: number;
  /** Mesh `name` prefix. Mesh names become `${namePrefix}-${item.id}`. */
  readonly namePrefix: string;
}

const DEFAULT_RADIUS = 0.1;

interface SharedSphereResources {
  readonly geometry: THREE.SphereGeometry;
  readonly material: THREE.MeshBasicMaterial;
}

const sharedResourceCache = new Map<string, SharedSphereResources>();

function resourceKey(color: number, radius: number): string {
  return `${color}|${radius}`;
}

function getSharedResources(
  color: number,
  radius: number
): SharedSphereResources {
  const key = resourceKey(color, radius);
  let entry = sharedResourceCache.get(key);
  if (!entry) {
    entry = {
      geometry: new THREE.SphereGeometry(radius, 16, 16),
      material: new THREE.MeshBasicMaterial({ color }),
    };
    sharedResourceCache.set(key, entry);
  }
  return entry;
}

/**
 * Reconcile `scene` so it contains exactly one `THREE.Mesh` per element in
 * `items`, reusing meshes from `prevHandles` where the id matches.
 *
 * Pure with respect to its inputs; the only "state" outside the returned
 * map is the module-level shared-resource cache, which is intentional and
 * never disposed.
 *
 * @returns the new handle map (do **not** mutate `prevHandles`).
 */
export function syncGpsAnchoredMeshes(
  scene: THREE.Scene,
  prevHandles: ReadonlyMap<string, THREE.Mesh>,
  items: readonly GpsAnchoredItem[],
  options: SyncGpsAnchoredMeshesOptions
): Map<string, THREE.Mesh> {
  const { zeroRef, color, namePrefix } = options;
  const radius = options.radius ?? DEFAULT_RADIUS;
  const { geometry, material } = getSharedResources(color, radius);

  const next = new Map<string, THREE.Mesh>();
  const wantedIds = new Set<string>();

  for (const it of items) {
    wantedIds.add(it.id);
    const coords = calcRelativeCoordsInMeters(
      zeroRef,
      { lat: it.lat, lon: it.lon },
      it.altitude ?? 0,
      0
    );
    let mesh = prevHandles.get(it.id);
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${namePrefix}-${it.id}`;
      scene.add(mesh);
    }
    mesh.position.set(coords[0], coords[1], coords[2]);
    next.set(it.id, mesh);
  }

  // Remove meshes whose ids are no longer present.
  for (const [id, mesh] of prevHandles) {
    if (!wantedIds.has(id)) {
      scene.remove(mesh);
      // Shared geometry/material are NOT disposed — they live forever in
      // the module-level cache and are reused by subsequent calls.
    }
  }

  return next;
}

/**
 * Test-only: drop the module-level shared-resource cache so each test
 * starts with a fresh `(geometry, material)` pair per `(color, radius)`.
 * Production code never calls this; the cache is intentionally retained
 * for the lifetime of the page.
 */
export function __resetSharedSphereResourcesForTests(): void {
  for (const { geometry, material } of sharedResourceCache.values()) {
    geometry.dispose();
    material.dispose();
  }
  sharedResourceCache.clear();
}
