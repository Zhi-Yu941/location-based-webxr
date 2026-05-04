/**
 * Reference Point Visualizer (recorder-side)
 *
 * Thin composition over two `GpsAnchoredMeshManager` instances from the
 * framework — prior=green / current=red — adapted to the recorder's
 * `RefPointMark` shape. Iter 4 of the boundary cleanup moved this module
 * out of the framework so the framework's visualization layer is
 * recorder-agnostic.
 *
 * Behaviour is preserved exactly: same colors, same mesh-name prefixes
 * (`prior-ref-` / `current-ref-`), same shared-geometry/material lifecycle,
 * same warning logs when the zero reference or scene is missing.
 */

import type { LatLong } from 'gps-plus-slam-js';
import type { RefPointMark } from '../storage/ref-point-loader';
import {
  GpsAnchoredMeshManager,
  type GpsAnchoredItem,
} from 'gps-plus-slam-app-framework/visualization/gps-anchored-mesh-manager';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

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

export class RefPointVisualizer {
  private readonly prior = new GpsAnchoredMeshManager({
    color: VIS_COLORS.PRIOR_REF_POINT.hex,
    namePrefix: 'prior-ref',
    loggerLabel: 'RefPointVisualizer',
  });
  private readonly current = new GpsAnchoredMeshManager({
    color: VIS_COLORS.CURRENT_REF_POINT.hex,
    namePrefix: 'current-ref',
    loggerLabel: 'RefPointVisualizer',
  });

  setZeroRef(zero: LatLong): void {
    this.prior.setZeroRef(zero);
    this.current.setZeroRef(zero);
  }

  getZeroRef(): LatLong | null {
    return this.prior.getZeroRef();
  }

  displayPriorRefPoints(refPoints: readonly RefPointMark[]): void {
    if (!this.prior.getZeroRef()) {
      log.warn('No zero reference set');
      return;
    }
    const items = refPoints
      .map(refPointToItem)
      .filter((it): it is GpsAnchoredItem => it !== null);
    const skipped = refPoints.length - items.length;
    this.prior.setItems(items);
    if (skipped > 0) {
      log.info(
        `Displayed ${items.length}/${refPoints.length} prior reference points (${skipped} without GPS)`
      );
    }
  }

  addCurrentRefPoint(refPoint: RefPointMark): void {
    if (!this.current.getZeroRef() || !refPoint.gpsPosition) {
      log.warn(
        'Cannot add current ref point - missing zero ref or GPS position'
      );
      return;
    }
    const item = refPointToItem(refPoint);
    if (!item) return;
    this.current.addItem(item);
  }

  clearPriorRefPoints(): void {
    this.prior.clear();
  }

  clearCurrentRefPoints(): void {
    this.current.clear();
  }

  clearAll(): void {
    this.prior.dispose();
    this.current.dispose();
  }

  getCounts(): { prior: number; current: number } {
    return {
      prior: this.prior.getCount(),
      current: this.current.getCount(),
    };
  }
}

/** Singleton instance for global use. */
export const refPointVisualizer = new RefPointVisualizer();
