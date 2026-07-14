/**
 * HUD subscriber for the tracking-quality reporter.
 *
 * Background — F1 from
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * the recorder app swaps the Redux store on every `Start Recording`
 * (and on replay). The previous inline implementation subscribed to
 * the boot store directly, capturing it in a closure; after a swap the
 * HUD silently froze at `WARMING UP 0%` because it kept reading the
 * orphaned old store.
 *
 * This module re-subscribes whenever the active store identity
 * changes (via a {@link StoreRef}). On every swap it (i) detaches
 * from the old store, (ii) reads the new store's current report and
 * pushes it through `updateHud` so the panel never sits stale across
 * a swap, (iii) attaches a fresh `store.subscribe` to the new store.
 */

import {
  selectTrackingQuality,
  type TrackingQualityReport,
} from 'gps-plus-slam-app-framework/state/tracking-quality';
import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';
import { followStore } from '../state/store-ref';

export interface SubscribeHudToTrackingQualityOptions {
  readonly storeRef: StoreRef<RecorderStore>;
  readonly updateHud: (report: TrackingQualityReport) => void;
}

/**
 * Wire the HUD to receive `TrackingQualityReport` updates from whichever
 * store is currently active in `storeRef`. Returns a `dispose` function
 * that detaches both the per-store subscription and the swap listener.
 */
export function subscribeHudToTrackingQuality(
  options: SubscribeHudToTrackingQualityOptions
): () => void {
  const { storeRef, updateHud } = options;
  let lastReport: TrackingQualityReport | null = null;

  const attach = (store: RecorderStore): (() => void) => {
    // Push the current state immediately so the HUD reflects the post-swap
    // store without having to wait for the next dispatch on the new store.
    const initial = selectTrackingQuality(store.getState());
    if (initial && initial !== lastReport) {
      lastReport = initial;
      updateHud(initial);
    } else {
      lastReport = initial;
    }

    return store.subscribe(() => {
      const report = selectTrackingQuality(store.getState());
      if (report && report !== lastReport) {
        lastReport = report;
        updateHud(report);
      }
    });
  };

  // Store-swap following via the shared helper (quality-review G-11).
  return followStore(storeRef, attach);
}
