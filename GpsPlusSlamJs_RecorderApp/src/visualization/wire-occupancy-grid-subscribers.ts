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

/**
 * Minimum delay between two `onGridSize` telemetry reports (Step 0 of the
 * 2026-07-03 long-session fps plan): frequent enough to draw a cells-over-time
 * curve, sparse enough not to spam the log export at the 2 Hz sample stream.
 */
const GRID_SIZE_TELEMETRY_INTERVAL_MS = 30_000;

/** The part of `OccupancyGrid` this wirer feeds. */
export interface OccupancyGridSink {
  addSample(sample: DepthSample): number;
  clear(): void;
  /**
   * Optional occupied-set version (see `OccupancyGrid.getRevision`). When
   * present, the wirer **skips** a throttled refresh whose revision matches the
   * last one it rendered — so re-observing an already-settled scene costs no
   * cube re-build / occluder re-mesh (the dominant idle saving over a long
   * session). A sink without it always refreshes (prior behaviour).
   */
  getRevision?(): number;
  /**
   * Optional occupied-cell count (O(1) on `OccupancyGrid`), read for the
   * ~30 s `onGridSize` telemetry. A sink without it reports nothing.
   */
  readonly size?: number;
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
  /**
   * Optional persistent depth-only occluder (the `OccupancyMesh` adapter),
   * refreshed on the **same** throttle as the cube visualizer. `refresh` gets
   * the live grid so the adapter can snapshot `getOccupiedCells(minConfidence)`;
   * `clear` empties it on store swap. Absent unless the
   * `occupancy.persistentOcclusion` setting is on (on by default).
   */
  readonly occluder?: {
    refresh(grid: NoInfer<TGrid>): void;
    clear(): void;
  };
  /** Defaults to {@link DEFAULT_REFRESH_INTERVAL_MS}. */
  readonly refreshIntervalMs?: number;
  readonly onError?: (err: unknown) => void;
  /**
   * Grid-size telemetry (Step 0 of the 2026-07-03 long-session fps plan):
   * called with `grid.size` for the first folded sample and then at most once
   * per ~30 s, so a log export correlates cells-over-time with fps-over-time.
   * Requires the sink to expose {@link OccupancyGridSink.size}. Best-effort:
   * a throwing callback surfaces via `onError` and never breaks the wiring.
   */
  readonly onGridSize?: (cells: number) => void;
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
    occluder,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    onError,
    onGridSize,
  } = options;

  let disposed = false;
  let lastRefreshTime = -Infinity;
  // Grid-size telemetry throttle; -Infinity so the first sample reports the
  // t0 baseline of the cells-over-time curve.
  let lastGridSizeTime = -Infinity;
  // Occupied-set revision last actually rendered. `null` forces the next refresh
  // (start / after a store swap). Lets a settled grid skip the O(cells) refresh.
  let lastRenderedRevision: number | null = null;
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
    // Skip the whole O(cells) re-derive when the occupied set is unchanged since
    // the last render (a settled scene being re-observed) — cube re-build and
    // occluder re-mesh both produce identical output. Cheap O(1) guard.
    const revision = grid.getRevision?.();
    if (revision !== undefined && revision === lastRenderedRevision) {
      return;
    }
    lastRefreshTime = Date.now();
    // Only mark this revision rendered once the sinks actually succeed. Advancing
    // it up front means a single throwing refresh (caught below) would leave the
    // revision recorded as rendered, so every later same-revision sample (a
    // settled scene) short-circuits at the guard above forever — a transient
    // failure becomes permanently sticky. On failure we keep the previous
    // revision so the next throttled sample retries.
    let rendered = true;
    try {
      visualizer.refresh(grid, lastViewerPose ?? undefined);
    } catch (err) {
      rendered = false;
      onError?.(err);
    }
    // Independent best-effort: a throwing visualizer must not skip the
    // occluder re-mesh, and vice versa.
    if (occluder) {
      try {
        occluder.refresh(grid);
      } catch (err) {
        rendered = false;
        onError?.(err);
      }
    }
    if (rendered) {
      lastRenderedRevision = revision ?? null;
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
    // Cells-over-time telemetry (~30 s cadence). Best-effort like the sinks:
    // a broken callback must never break the store subscription.
    if (onGridSize && typeof grid.size === 'number') {
      const now = Date.now();
      if (now - lastGridSizeTime >= GRID_SIZE_TELEMETRY_INTERVAL_MS) {
        lastGridSizeTime = now;
        try {
          onGridSize(grid.size);
        } catch (err) {
          onError?.(err);
        }
      }
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
    // New session logs its cells-over-time curve from t0 again.
    lastGridSizeTime = -Infinity;
    // Force the first refresh of the new store's grid (its revision restarts).
    lastRenderedRevision = null;
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
    if (occluder) {
      try {
        occluder.clear();
      } catch (err) {
        onError?.(err);
      }
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
