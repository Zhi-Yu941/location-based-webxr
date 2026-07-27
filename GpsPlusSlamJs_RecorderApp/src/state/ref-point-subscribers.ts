/**
 * Recorder-app subscriber for the 3D ref-point visualizer.
 *
 * Step 5.3 of 2026-05-27-collapse-refpoint-and-frame-slices-plan.md
 * migrated this wiring from the library's `selectReferencePoints`
 * (over `state.gpsData.referencePoints`) onto the recorder-side flat
 * `selectRefPointEntries` selector (over `state.refPoints.entries`).
 * The visualizer's `syncRefPoints` method now consumes `RefPointEntry`
 * directly and renders all entries uniformly, animating newly-inserted
 * ids via an id-based diff.
 */

import type { RecorderStore } from './recorder-store';
import { selectRefPointEntries } from './ref-points-slice';
import { selectZeroReference } from 'gps-plus-slam-app-framework/state';
import type { RefPointVisualizer } from '../visualization/ref-point-visualizer';

/**
 * Wire the 3D visualizer to the recorder's flat `refPoints` slice.
 * Returns an unsubscribe function that detaches the store listener.
 *
 * Tolerates a missing visualizer (e.g. in headless replay paths) by
 * returning a no-op unsubscribe.
 *
 * ## Zero reference (single source of truth — audit F2)
 *
 * The store is the single source of truth for the GPS zero reference. The
 * visualizer caches it AND uses it for lat/lon → metres conversion, so a
 * stale cache offsets every ref-point marker. This wirer therefore pushes the
 * current store zero into the visualizer on attach and again whenever it
 * changes (a re-zero / QR-origin override). `setZeroRef` replays the
 * visualizer's cached entries, so the markers re-render at the new origin
 * automatically — no extra `syncRefPoints` call is needed for a zero-only
 * change. This replaces the previous "set the origin exactly once and ignore
 * later store changes" wiring, which left the visualizer pinned to a stale
 * origin if the store ever re-zeroed.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-18-1846-state-outside-store-audit.md (F2)
 */
export function wireRefPointSubscribers(
  store: RecorderStore,
  visualizer: Pick<RefPointVisualizer, 'syncRefPoints' | 'setZeroRef'> | null
): () => void {
  if (!visualizer) return () => {};

  // Push the store's zero reference first so the initial sync below places
  // entries at the correct origin. `setZeroRef` replays cached entries, but
  // the visualizer's cache is still empty at this point, so it is a no-op
  // until `syncRefPoints` runs.
  let lastZero = selectZeroReference(store.getState());
  if (lastZero) visualizer.setZeroRef(lastZero);

  let last = selectRefPointEntries(store.getState().refPoints);
  // Initial sync on attach so any already-present entries (e.g. imported
  // via the OPFS sidecar fast-path before the subscriber attached) render
  // immediately.
  visualizer.syncRefPoints(last);

  return store.subscribe(() => {
    const state = store.getState();

    // Re-push a changed origin BEFORE re-syncing entries: `setZeroRef` replays
    // the cached entries at the new origin, and the entry diff below then
    // reconciles any list change on top of the already-correct positions.
    const zero = selectZeroReference(state);
    if (zero !== lastZero) {
      lastZero = zero;
      if (zero) visualizer.setZeroRef(zero);
    }

    const next = selectRefPointEntries(state.refPoints);
    if (next === last) return;
    last = next;
    visualizer.syncRefPoints(next);
  });
}
