/**
 * Wire the AR-space occupancy grid to the recorder store.
 *
 * Background — 2026-06-11 depth occupancy-grid port plan §3: the
 * persisted `recording/recordDepthSample` action stream is the source of
 * truth; the grid is DERIVED state living outside Redux (same pattern as
 * `wire-frame-tile-subscribers.ts`). The framework's recording slice
 * stores the latest sample in `state.recording.latestDepthSample`; this
 * wirer observes it by reference comparison, folds each new sample into
 * the injected grid, and refreshes the injected cube visualizer at a
 * throttled ~1 Hz (replay re-dispatches samples much faster than live).
 *
 * Following the F1 store-swap pattern, the wirer uses a {@link StoreRef}
 * so it re-attaches after the recorder swaps stores (Start Recording /
 * Replay); on every swap both the grid and the visualizer are cleared.
 *
 * Best-effort: grid and visualizer calls are wrapped so a failure can
 * never break the AR session or the store subscription (errors surface
 * via `onError`).
 */

import type { DepthSample } from '../state/recorder-store';
import type { RecorderStore } from '../state/recorder-store';
import type { StoreRef } from '../state/store-ref';
import type { ViewerPose } from './occupancy-cubes-visualizer';

/** Default minimum delay between two visualizer refreshes. */
const DEFAULT_REFRESH_INTERVAL_MS = 1000;

/** The part of `OccupancyGrid` this wirer feeds. */
export interface OccupancyGridSink {
  addSample(sample: DepthSample): number;
  clear(): void;
}

export interface WireOccupancyGridSubscribersOptions<
  TGrid extends OccupancyGridSink,
> {
  readonly storeRef: StoreRef<RecorderStore>;
  readonly grid: TGrid;
  // NoInfer: TGrid must be inferred from `grid` alone — otherwise TS
  // widens it to the OccupancyGridSink constraint and rejects visualizers
  // whose refresh() needs the richer concrete grid type.
  readonly visualizer: {
    // viewerPose: the latest depth sample's head pose (raw WebXR), so the
    // visualizer can draw the cells nearest the user when over its instance
    // cap (Issue B1). Optional — a sink/visualizer that ignores it still
    // satisfies the type (fewer params is assignable).
    refresh(grid: NoInfer<TGrid>, viewerPose?: ViewerPose): void;
    clear(): void;
  };
  /** Defaults to {@link DEFAULT_REFRESH_INTERVAL_MS}. */
  readonly refreshIntervalMs?: number;
  readonly onError?: (err: unknown) => void;
}

/**
 * Attach the wiring. Returns a dispose function that detaches the
 * per-store subscription, the swap listener and any pending refresh.
 */
export function wireOccupancyGridSubscribers<TGrid extends OccupancyGridSink>(
  options: WireOccupancyGridSubscribersOptions<TGrid>
): () => void {
  const {
    storeRef,
    grid,
    visualizer,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    onError,
  } = options;

  let disposed = false;
  let lastRefreshTime = -Infinity;
  let pendingRefresh: ReturnType<typeof setTimeout> | null = null;
  // The most recent depth sample's head pose (raw WebXR), forwarded to the
  // visualizer so an over-cap refresh can pick the cells nearest the user
  // (Issue B1). Null until the first sample, and reset on every store swap.
  let lastViewerPose: ViewerPose | null = null;

  const cancelPendingRefresh = (): void => {
    if (pendingRefresh !== null) {
      clearTimeout(pendingRefresh);
      pendingRefresh = null;
    }
  };

  const refreshNow = (): void => {
    lastRefreshTime = Date.now();
    try {
      visualizer.refresh(grid, lastViewerPose ?? undefined);
    } catch (err) {
      onError?.(err);
    }
  };

  /**
   * Leading-edge + trailing-edge throttle: the first sample after a quiet
   * period refreshes immediately; bursts (replay) coalesce into one
   * trailing refresh per interval so the final state is always rendered.
   */
  const scheduleRefresh = (): void => {
    if (pendingRefresh !== null) {
      return;
    }
    const elapsed = Date.now() - lastRefreshTime;
    if (elapsed >= refreshIntervalMs) {
      refreshNow();
      return;
    }
    pendingRefresh = setTimeout(() => {
      pendingRefresh = null;
      if (!disposed) {
        refreshNow();
      }
    }, refreshIntervalMs - elapsed);
  };

  const handleSample = (sample: DepthSample): void => {
    try {
      grid.addSample(sample);
    } catch (err) {
      onError?.(err);
      return;
    }
    // Remember where the camera was for this sample so the next refresh can
    // rank cells by distance to the viewer (Issue B1). Updated even when the
    // refresh is throttled, so the trailing refresh uses the freshest pose.
    lastViewerPose = {
      cameraPos: sample.cameraPos,
      cameraRot: sample.cameraRot,
    };
    scheduleRefresh();
  };

  const attach = (store: RecorderStore): (() => void) => {
    let lastSample = store.getState().recording.latestDepthSample;
    // Seed: a sample dispatched before wiring (or surviving in the
    // attached store) is folded in once.
    if (lastSample) {
      handleSample(lastSample);
    }
    return store.subscribe(() => {
      const next = store.getState().recording.latestDepthSample;
      if (next === lastSample || disposed) {
        return;
      }
      lastSample = next;
      if (next) {
        handleSample(next);
      }
    });
  };

  let detach = attach(storeRef.get());
  const unsubscribeSwap = storeRef.subscribe((nextStore) => {
    detach();
    cancelPendingRefresh();
    lastRefreshTime = -Infinity;
    // Drop the stale pose: the new store's samples carry their own, and the
    // old recording's head pose is meaningless for the new one.
    lastViewerPose = null;
    // Independent best-effort: a throwing grid.clear() must not skip
    // visualizer.clear(), or the cube view keeps rendering the stale grid.
    try {
      grid.clear();
    } catch (err) {
      onError?.(err);
    }
    try {
      visualizer.clear();
    } catch (err) {
      onError?.(err);
    }
    detach = attach(nextStore);
  });

  return () => {
    disposed = true;
    cancelPendingRefresh();
    detach();
    unsubscribeSwap();
  };
}
