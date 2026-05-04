/**
 * Recorder-app subscribers for the ref-points slice.
 *
 * Iter 3 of the AppFramework / RecorderApp boundary cleanup moved ref-point
 * ownership out of the framework. The framework's `wireStoreSubscribers` no
 * longer touches the visualizer, so the recorder wires those subscriptions
 * locally with the same invariants that were previously enforced inside the
 * framework's `store-subscribers.ts`:
 *
 *  - prior marks → exactly one `displayPriorRefPoints` call per `priorMarks`
 *    state change.
 *  - current marks → exactly one `addCurrentRefPoint` call per appended mark.
 *  - clear semantics: when `currentMarks` shrinks, the high-water mark resets
 *    so the next dispatched mark renders a fresh sphere.
 *
 * See gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md
 */

import type { RecorderStore } from './recorder-store';
import type { RefPointMark } from '../storage/ref-point-loader';
import type { RefPointVisualizer } from '../visualization/ref-point-visualizer';

/**
 * Wire the visualizer to the ref-points slice. Returns an unsubscribe
 * function that detaches the subscription.
 *
 * Tolerates a missing visualizer (e.g. in headless replay paths) by
 * returning a no-op unsubscribe.
 */
export function wireRefPointSubscribers(
  store: RecorderStore,
  visualizer: Pick<
    RefPointVisualizer,
    'displayPriorRefPoints' | 'addCurrentRefPoint'
  > | null
): () => void {
  if (!visualizer) return () => {};

  let lastPriorMarks: readonly RefPointMark[] | null = null;
  let lastCurrentMarksLen = 0;

  const handleChange = () => {
    const refPoints = store.getState().refPoints;
    const priorMarks = refPoints?.priorMarks ?? [];
    const currentMarks = refPoints?.currentMarks ?? [];

    if (priorMarks !== lastPriorMarks) {
      lastPriorMarks = priorMarks;
      const withGps = priorMarks.filter(
        (m): m is RefPointMark & { gpsPosition: NonNullable<RefPointMark['gpsPosition']> } =>
          m.gpsPosition !== undefined
      );
      visualizer.displayPriorRefPoints(withGps);
    }

    if (currentMarks.length < lastCurrentMarksLen) {
      // Slice shrunk → caller cleared (e.g. scenario reset). Reset
      // the high-water mark so the next dispatched mark renders a sphere.
      lastCurrentMarksLen = 0;
    }
    while (lastCurrentMarksLen < currentMarks.length) {
      const next = currentMarks[lastCurrentMarksLen];
      lastCurrentMarksLen++;
      if (!next || !next.gpsPosition) continue;
      visualizer.addCurrentRefPoint(next);
    }
  };

  return store.subscribe(handleChange);
}
