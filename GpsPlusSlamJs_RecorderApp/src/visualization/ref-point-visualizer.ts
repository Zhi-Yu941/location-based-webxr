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
import { registerFrameUpdate } from 'gps-plus-slam-app-framework/ar/frame-loop';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { RefPointMark } from '../storage/ref-point-loader';
import type { RefPointEntry } from '../state/ref-points-slice';
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

// Used by `syncRefPoints`, the unified entry point that consumes the
// recorder's flat `selectRefPointEntries` selector (Step 5.3 of
// 2026-05-27-collapse-refpoint-and-frame-slices-plan.md). Renders all
// entries in one colour. When an alignment matrix was in effect at
// mark-time the entry's `gpsPoint` carries the fused snapshot, so we
// prefer it over the raw GPS sample for the visual anchor.
const REF_POINT_OPTS = {
  color: VIS_COLORS.CURRENT_REF_POINT.hex,
  namePrefix: 'ref-point',
} as const;

/** Duration of the brief scale-up animation played when a new ref point appears. */
const INSERT_ANIMATION_DURATION_SEC = 0.4;
const INSERT_ANIMATION_START_SCALE = 0.2;

/**
 * Register a per-frame scale-up animation for a newly-inserted mesh.
 * Plays once over `INSERT_ANIMATION_DURATION_SEC`, then unregisters
 * itself. Exposed via `mesh.userData.refPointInsertAnimation` so tests
 * can detect that the animation was started without depending on the
 * frame loop wall-clock.
 */
function startInsertAnimation(mesh: THREE.Mesh): void {
  let elapsed = 0;
  mesh.scale.setScalar(INSERT_ANIMATION_START_SCALE);
  const tick = (dt: number): void => {
    elapsed += dt;
    const t = Math.min(elapsed / INSERT_ANIMATION_DURATION_SEC, 1);
    const s =
      INSERT_ANIMATION_START_SCALE + (1 - INSERT_ANIMATION_START_SCALE) * t;
    mesh.scale.setScalar(s);
    if (t >= 1) {
      mesh.scale.setScalar(1);
      delete (mesh.userData as { refPointInsertAnimation?: unknown })
        .refPointInsertAnimation;
      unregister();
    }
  };
  const unregister = registerFrameUpdate(tick);
  (
    mesh.userData as { refPointInsertAnimation?: unknown }
  ).refPointInsertAnimation = tick;
}

function refPointEntryToItem(entry: RefPointEntry): GpsAnchoredItem {
  // Prefer the fused snapshot when it was captured (alignment matrix
  // was in effect at mark-time); otherwise fall back to the raw GPS
  // sample. The visualizer only needs lat/lon/altitude and both shapes
  // expose them under the same field names (`RawGpsPoint`).
  const src = entry.gpsPoint ?? entry.rawGpsPoint;
  return {
    id: entry.id,
    lat: src.latitude,
    lon: src.longitude,
    altitude: src.altitude ?? 0,
  };
}

export class RefPointVisualizer {
  private zeroRef: LatLong | null = null;
  private priorHandles = new Map<string, THREE.Mesh>();
  private currentItems: GpsAnchoredItem[] = [];
  private currentHandles = new Map<string, THREE.Mesh>();
  /**
   * Handles for the unified `syncRefPoints` pipeline (Step 4 of
   * 2026-05-27-collapse-refpoint-and-frame-slices-plan.md). Parallel to
   * `priorHandles` / `currentHandles` during the transition; those two
   * fields and their methods are removed in Step 5 along with the
   * recorder-local `refPoints` slice.
   */
  private refPointHandles = new Map<string, THREE.Mesh>();
  /**
   * Last entries handed to `syncRefPoints`, retained so that `setZeroRef`
   * can replay them once a zero reference becomes available. Without this,
   * any entries pushed while `zeroRef` was still null are silently dropped
   * until an unrelated store mutation re-triggers the subscriber — the
   * visualizer relied on subscriber ordering rather than being
   * self-healing.
   */
  private lastRefPoints: readonly RefPointEntry[] = [];

  setZeroRef(zero: LatLong): void {
    this.zeroRef = zero;
    // Replay the most recent entries now that we can place them. Entries
    // pushed before GPS lock were cached but no-op'd; this renders them
    // without waiting for the next store mutation.
    if (this.lastRefPoints.length > 0) {
      this.syncRefPoints(this.lastRefPoints);
    }
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

  /**
   * Unified entry point that mirrors the recorder's local
   * `selectAllRefPoints` selector from the `refPoints` slice. Renders all
   * marks in a single colour and animates newly-inserted ids with a brief
   * scale-up. Subscribers should call this with the full selector result
   * on every change; an id-based diff inside the visualizer keeps the
   * scene-graph stable and triggers the animation exactly once per insert
   * (it does not fire when the same id stays in the result on the next
   * subscription tick).
   *
   * Tolerates missing zero ref or scene by no-op'ing — the next call once
   * the AR session is up will reconcile.
   *
   * Position rule for shared ids: multiple entries can carry the same H3
   * cell `id` (the imported sidecar centroid plus one entry per live
   * re-capture). They collapse to a single mesh; the position follows
   * last-occurrence / last-write-wins, so the most recent live tap
   * supersedes the historical centroid. See
   * 2026-05-29-refpoint-single-sphere-vs-multi-sphere-review.md §3.3.
   */
  syncRefPoints(refPoints: readonly RefPointEntry[]): void {
    // Cache first so `setZeroRef` can replay these even when we bail out
    // below because the zero reference or scene is not available yet.
    this.lastRefPoints = refPoints;
    if (!this.zeroRef) return;
    const scene = getScene();
    if (!scene) return;
    const items = refPoints.map(refPointEntryToItem);
    const prev = this.refPointHandles;
    const next = syncGpsAnchoredMeshes(scene, prev, items, {
      zeroRef: this.zeroRef,
      ...REF_POINT_OPTS,
    });
    for (const [id, mesh] of next) {
      if (!prev.has(id)) {
        startInsertAnimation(mesh);
      }
    }
    this.refPointHandles = next;
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
    const scene = getScene();
    if (scene) {
      this.refPointHandles = syncGpsAnchoredMeshes(
        scene,
        this.refPointHandles,
        [],
        { zeroRef: this.zeroRef ?? { lat: 0, lon: 0 }, ...REF_POINT_OPTS }
      );
    }
    this.zeroRef = null;
    this.lastRefPoints = [];
  }

  getCounts(): { prior: number; current: number } {
    return {
      prior: this.priorHandles.size,
      current: this.currentHandles.size,
    };
  }

  /**
   * Number of meshes currently managed by the unified `syncRefPoints`
   * pipeline. Separate from `getCounts` so the legacy `{prior,current}`
   * contract stays intact until Step 5 of
   * 2026-05-27-collapse-refpoint-and-frame-slices-plan.md removes the
   * old prior/current API entirely.
   */
  getRefPointCount(): number {
    return this.refPointHandles.size;
  }
}

/** Singleton instance for global use. */
export const refPointVisualizer = new RefPointVisualizer();
