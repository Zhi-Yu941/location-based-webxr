import { describe, it, expect, vi } from 'vitest';
import { poseReceived } from 'gps-plus-slam-app-framework/state/tracking-slice';
import type { TrackingQualityReport } from 'gps-plus-slam-app-framework/state/tracking-quality';

import { createRecorderStore } from '../state/recorder-store';
import { createStoreRef } from '../state/store-ref';
import { subscribeHudToTrackingQuality } from './hud-tracking-quality-subscriber';

/**
 * F1 regression suite — see
 * `docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md`.
 * The HUD subscriber must follow the store swap that happens on
 * `Start Recording` / replay; otherwise the panel sits frozen at
 * `WARMING UP 0%` for the rest of the session.
 *
 * We exercise the real store (and the real `trackingQuality` slice + selector)
 * so that the test fails for the production reason, not just because of a
 * fake.
 */

function dispatchSyntheticPose(
  store: ReturnType<typeof createRecorderStore>,
  index: number
): void {
  // Offset values per index so the resulting `TrackingQualityReport`
  // reference changes from dispatch to dispatch (the slice only assigns
  // a fresh object when the report content actually differs).
  store.dispatch(
    poseReceived({
      pose: {
        position: { x: index * 0.1, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
      sensorOrientation: { alpha: index, beta: 0, gamma: 0, absolute: true },
    })
  );
}

describe('subscribeHudToTrackingQuality', () => {
  // Why: the original failure mode — the HUD only saw the boot store and
  // never re-attached. This test pins the new behaviour.
  it('re-subscribes when the store is swapped via storeRef.set', () => {
    const bootStore = createRecorderStore();
    const ref = createStoreRef(bootStore);
    const updateHud = vi.fn<(r: TrackingQualityReport) => void>();

    const dispose = subscribeHudToTrackingQuality({
      storeRef: ref,
      updateHud,
    });

    dispatchSyntheticPose(bootStore, 1);
    const callsAfterBoot = updateHud.mock.calls.length;
    expect(callsAfterBoot).toBeGreaterThan(0);

    // Swap to a brand-new store (mirrors Start Recording).
    const recordingStore = createRecorderStore();
    ref.set(recordingStore);

    // Dispatching on the OLD store must no longer reach the HUD.
    const callsBeforeOldDispatch = updateHud.mock.calls.length;
    dispatchSyntheticPose(bootStore, 99);
    expect(updateHud.mock.calls.length).toBe(callsBeforeOldDispatch);

    // Dispatching on the NEW store must reach the HUD.
    const callsBeforeNewDispatch = updateHud.mock.calls.length;
    dispatchSyntheticPose(recordingStore, 5);
    expect(updateHud.mock.calls.length).toBeGreaterThan(callsBeforeNewDispatch);

    dispose();
  });

  // Why: a typical session sees a soft reset (e.g. switch back to live, then
  // start another recording). The subscriber must survive multiple swaps.
  it('keeps tracking the active store across multiple swaps', () => {
    const s1 = createRecorderStore();
    const ref = createStoreRef(s1);
    const updateHud = vi.fn<(r: TrackingQualityReport) => void>();

    const dispose = subscribeHudToTrackingQuality({
      storeRef: ref,
      updateHud,
    });

    const s2 = createRecorderStore();
    ref.set(s2);
    const s3 = createRecorderStore();
    ref.set(s3);

    const before = updateHud.mock.calls.length;
    dispatchSyntheticPose(s3, 7);
    expect(updateHud.mock.calls.length).toBeGreaterThan(before);

    // None of the abandoned stores still drive the HUD.
    const afterS3 = updateHud.mock.calls.length;
    dispatchSyntheticPose(s1, 8);
    dispatchSyntheticPose(s2, 9);
    expect(updateHud.mock.calls.length).toBe(afterS3);

    dispose();
  });

  // Why: replay teardown disposes the subscriber. After dispose, no late
  // dispatches may sneak into the HUD.
  it('dispose() detaches all subscriptions', () => {
    const store = createRecorderStore();
    const ref = createStoreRef(store);
    const updateHud = vi.fn<(r: TrackingQualityReport) => void>();

    const dispose = subscribeHudToTrackingQuality({
      storeRef: ref,
      updateHud,
    });

    dispatchSyntheticPose(store, 1);
    expect(updateHud).toHaveBeenCalled();

    dispose();
    const beforeLate = updateHud.mock.calls.length;
    dispatchSyntheticPose(store, 2);
    ref.set(createRecorderStore());
    expect(updateHud.mock.calls.length).toBe(beforeLate);
  });

  // Why: the slice's `reportUpdated` reducer assigns a fresh object only
  // when the report changes. The subscriber must respect that selector
  // identity instead of spamming the HUD on every dispatch.
  it('does not invoke updateHud when the report reference is unchanged', () => {
    const store = createRecorderStore();
    const ref = createStoreRef(store);
    const updateHud = vi.fn<(r: TrackingQualityReport) => void>();

    const dispose = subscribeHudToTrackingQuality({
      storeRef: ref,
      updateHud,
    });

    // Dispatch a no-op action that doesn't touch the trackingQuality slice.
    // (Pick a recording-slice action; any non-tracking action works.)
    store.dispatch({ type: '__test/noop__' });
    store.dispatch({ type: '__test/noop__' });

    const callsAfterNoops = updateHud.mock.calls.length;
    expect(callsAfterNoops).toBeLessThanOrEqual(1); // at most the initial push

    dispose();
  });
});
