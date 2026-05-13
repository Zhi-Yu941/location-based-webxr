/**
 * Reference Point Visualizer (recorder-side)
 *
 * Adapts the recorder's `RefPointMark` onto the pure-function
 * `syncGpsAnchoredMeshes` reconciler (prior=green, current=red). Holds one
 * `Map<id, THREE.Mesh>` per colour as the handle store between calls; all
 * other state (zero reference + the running list of current items) is in a
 * handful of fields.
 *
 * Replaces the previous implementation that delegated to the framework's
 * stateful `GpsAnchoredMeshManager` (now removed) — see
 * `2026-05-07-csharp-features-not-yet-ported.md` § P2.
 */

import type * as THREE from 'three';
import type { LatLong } from 'gps-plus-slam-app-framework/core';
import { getScene } from 'gps-plus-slam-app-framework/ar/webxr-session';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { RefPointMark } from '../storage/ref-point-loader';
import {
  syncGpsAnchoredMeshes,
  type GpsAnchoredItem,
} from './sync-gps-anchored-meshes';

const log = createLogger('RefPointVisualizer');

function refPointToItem(refPoint: RefPointMark): GpsAnchoredItem | null {
  if (!refPoint.gpsPosition) return null;
  return {
    id: refPoint.id,
    lat: refPoint.gpsPosition.lat,
    lon: refPoint.gpsPosition.lon,
    altitude: refPoint.gpsPosition.altitude ?? 0,
  };
}

const PRIOR_OPTS = {
  color: VIS_COLORS.PRIOR_REF_POINT.hex,
  namePrefix: 'prior-ref',
} as const;

const CURRENT_OPTS = {
  color: VIS_COLORS.CURRENT_REF_POINT.hex,
  namePrefix: 'current-ref',
} as const;

export class RefPointVisualizer {
  private zeroRef: LatLong | null = null;
  private priorHandles = new Map<string, THREE.Mesh>();
  private currentItems: GpsAnchoredItem[] = [];
  private currentHandles = new Map<string, THREE.Mesh>();

  setZeroRef(zero: LatLong): void {
    this.zeroRef = zero;
  }

  getZeroRef(): LatLong | null {
    return this.zeroRef;
  }

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
    const items = refPoints
      .map(refPointToItem)
      .filter((it): it is GpsAnchoredItem => it !== null);
    const skipped = refPoints.length - items.length;
    this.priorHandles = syncGpsAnchoredMeshes(scene, this.priorHandles, items, {
      zeroRef: this.zeroRef,
      ...PRIOR_OPTS,
    });
    if (skipped > 0) {
      log.info(
        `Displayed ${items.length}/${refPoints.length} prior reference points (${skipped} without GPS)`
      );
    }
  }

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
    const item = refPointToItem(refPoint);
    if (!item) return;
    // Append (or replace on duplicate id) and re-sync. The reconciler
    // does an id-based diff so existing meshes are preserved.
    const existingIdx = this.currentItems.findIndex((i) => i.id === item.id);
    if (existingIdx >= 0) this.currentItems[existingIdx] = item;
    else this.currentItems.push(item);
    this.currentHandles = syncGpsAnchoredMeshes(
      scene,
      this.currentHandles,
      this.currentItems,
      { zeroRef: this.zeroRef, ...CURRENT_OPTS }
    );
  }

  clearPriorRefPoints(): void {
    const scene = getScene();
    if (!scene) return;
    this.priorHandles = syncGpsAnchoredMeshes(scene, this.priorHandles, [], {
      zeroRef: this.zeroRef ?? { lat: 0, lon: 0 },
      ...PRIOR_OPTS,
    });
  }

  clearCurrentRefPoints(): void {
    const scene = getScene();
    if (!scene) return;
    this.currentItems = [];
    this.currentHandles = syncGpsAnchoredMeshes(
      scene,
      this.currentHandles,
      [],
      { zeroRef: this.zeroRef ?? { lat: 0, lon: 0 }, ...CURRENT_OPTS }
    );
  }

  clearAll(): void {
    this.clearPriorRefPoints();
    this.clearCurrentRefPoints();
    this.zeroRef = null;
  }

  getCounts(): { prior: number; current: number } {
    return {
      prior: this.priorHandles.size,
      current: this.currentHandles.size,
    };
  }
}

/** Singleton instance for global use. */
export const refPointVisualizer = new RefPointVisualizer();
