/**
 * AR-scoped wiring for BOTH ref-point views (3D spheres + live-map markers).
 *
 * Round-3 feedback (2026-07-05,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-2349-recorder-ar-ready-ref-point-views-user-feedback.md):
 * these view subscribers used to be owned by the RECORDING session, so in
 * the AR_READY phase (after Enter AR, before the first recording) the Redux
 * store filled with imported ref points and no view reacted. Ownership now
 * matches the views' actual lifecycle:
 *
 * - wired once at Enter AR against the current store,
 * - RE-WIRED on every store swap via the app's `storeRef` (the canonical
 *   swap-survival mechanism — see state/store-ref.ts; a recording start
 *   swaps in a fresh store),
 * - torn down at reset / AR end.
 *
 * The recording handlers no longer wire any ref-point view. Replay keeps its
 * own controller-scoped wiring (its store never swaps mid-replay).
 */

import type { StoreRef } from '../state/store-ref';
import { followStore } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';
import type { Map as LeafletMap } from 'leaflet';
import type { RefPointVisualizer } from '../visualization/ref-point-visualizer';
import { wireRefPointSubscribers } from '../state/ref-point-subscribers';
import { wireRefPointMapMarkers } from './ref-point-map-markers';

/** Dependencies of {@link wireRefPointViews}. */
export interface RefPointViewWiringDeps {
  /** The 3D ref-point visualizer (zeroRef-gated; renders once GPS arrives). */
  visualizer: Pick<RefPointVisualizer, 'syncRefPoints' | 'setZeroRef'> | null;
  /**
   * Late-binding accessor for the live minimap's Leaflet map (created lazily
   * on the first map toggle — call `refreshMapMarkers()` right after).
   */
  getMap: () => LeafletMap | null;
}

/** Handle returned by {@link wireRefPointViews}. */
export interface RefPointViewWiring {
  /** Re-render the map markers — call after the lazily-created map appears. */
  refreshMapMarkers(): void;
  /** Tear down the active pair and stop following store swaps. */
  unsubscribe(): void;
}

/**
 * Wire the 3D ref-point visualizer and the live-map marker wirer against the
 * CURRENT store, re-attaching on every `storeRef` swap so neither view ever
 * freezes against an orphaned store.
 */
export function wireRefPointViews(
  storeRef: StoreRef<RecorderStore>,
  deps: RefPointViewWiringDeps
): RefPointViewWiring {
  let mapMarkers: ReturnType<typeof wireRefPointMapMarkers> | null = null;

  // Store-swap following via the shared helper (quality-review G-11): the
  // attach wires both views against the given store and returns the pair
  // teardown the helper invokes before every re-attach and on dispose.
  const stopFollowing = followStore(storeRef, (store: RecorderStore) => {
    const unsubscribe3d = wireRefPointSubscribers(store, deps.visualizer);
    const markers = wireRefPointMapMarkers(store, {
      getMap: deps.getMap,
      // Lazy session start from the CURRENT store: before a session starts
      // everything classifies prior/green; the startSession dispatch (or the
      // swap to a recording store) re-renders with the real start so
      // this-session captures turn red — identical to the summary map.
      getStartTime: () =>
        storeRef.get().getState().recording.sessionMetadata?.startTime ??
        Number.MAX_SAFE_INTEGER,
      // F5-A (2026-06-05): in-AR map markers are enlarged for readability.
      dotSizePx: 20,
    });
    mapMarkers = markers;
    return () => {
      unsubscribe3d();
      markers.unsubscribe();
      mapMarkers = null;
    };
  });

  return {
    refreshMapMarkers: () => mapMarkers?.refresh(),
    unsubscribe: stopFollowing,
  };
}
