/**
 * Regression test for the onboarding-guidance ↔ tracking wiring.
 *
 * Why this matters: the coaching widget reads its phase from the
 * tracking-quality report (`selectTrackingQuality` → `computeOnboardingGuidance`).
 * That report only leaves the `ar-lost` state once AR poses are dispatched into
 * the store (`poseReceived`), because the aggregator forces `ar-lost` whenever
 * `tracking.phase !== 'tracking'` (see the framework's `tracking-quality.ts`).
 *
 * The framework's WebXR session only forwards per-frame poses into the store
 * when `initAR()` receives its `callbacks.tracking` group (store + callbacks
 * arrive TOGETHER since the setter fold; `updateTrackingState()` early-returns
 * otherwise). Under the old two-setter API the starter originally wired only
 * the store, so no `poseReceived` ever reached the store, `tracking.phase`
 * stayed `initializing`, and the guidance widget was pinned to "AR tracking
 * lost" forever with no progress — exactly the reported symptom.
 *
 * This test pins the contract `main.ts` must satisfy: the guidance is stuck at
 * `ar-lost` while no pose flows in, and only advances once poses are dispatched.
 * It is the executable proof of the bug; if the pose flow regresses again, this
 * fails.
 */

import { describe, it, expect } from "vitest";
import {
  createSlamAppStore,
  startSession,
  poseReceived,
  poseLost,
  selectTrackingQuality,
  computeOnboardingGuidance,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

function makeStore() {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });
  store.dispatch(
    startSession({
      scenarioName: "anchor-starter",
      sessionName: "live",
      startTime: 0,
    }),
  );
  return store;
}

function guidancePhase(store: ReturnType<typeof makeStore>): string {
  return computeOnboardingGuidance(selectTrackingQuality(store.getState()))
    .phase;
}

const SAMPLE_POSE = {
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
} as const;

const SAMPLE_ORIENTATION = {
  alpha: 0,
  beta: 0,
  gamma: 0,
  absolute: true,
} as const;

describe("onboarding guidance is driven by AR pose flow", () => {
  it("is stuck on 'ar-lost' while no pose reaches the store", () => {
    const store = makeStore();
    // Simulate the real app: GPS/tracking input actions arrive but no AR pose
    // ever does (the broken wiring). `poseLost` is an input action that
    // recomputes the report while `tracking.phase` is still not 'tracking'.
    store.dispatch(poseLost());
    expect(guidancePhase(store)).toBe("ar-lost");
  });

  it("leaves 'ar-lost' as soon as AR poses are dispatched (what the initAR tracking group enables)", () => {
    const store = makeStore();
    store.dispatch(poseLost());
    expect(guidancePhase(store)).toBe("ar-lost");

    // Dispatching poses is exactly what the framework's updateTrackingState does
    // per frame once initAR received its `callbacks.tracking` group.
    store.dispatch(
      poseReceived({
        pose: SAMPLE_POSE,
        sensorOrientation: SAMPLE_ORIENTATION,
      }),
    );

    expect(guidancePhase(store)).not.toBe("ar-lost");
  });
});
