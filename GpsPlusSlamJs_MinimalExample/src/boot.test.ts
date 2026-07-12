import { describe, expect, it } from 'vitest';
import {
  createSlamAppStore,
  selectGpsPositions,
} from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';

// Why this test matters (Decision-A smoke-test follow-up, §5 Step 0):
// The original hardware-free coverage of the minimal example was "run `pnpm dev`
// and watch the bundle boot a `createSlamAppStore({ NullStorageBackend })`".
// That check needed a browser and a human. Before the example is reshaped into
// an AR hit-test demo (Step 2) — whose XR glue is only verifiable on-device —
// we codify the one thing that CAN run headlessly: that the framework + closed
// core packages resolve and a store boots with a sane initial state. If a
// future framework refactor breaks the public store/storage entry points this
// fails in CI without any AR hardware.
//
// See: GpsPlusSlamJs_Docs/docs/2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md §5 Step 0.

describe('minimal example boot (headless smoke test)', () => {
  it('creates a slam app store with the NullStorageBackend', () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });

    expect(store).toBeDefined();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });

  it('boots into an idle, empty recording state', () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });

    const recording = store.getState().recording;
    expect(recording.isRecording).toBe(false);
    expect(recording.actionCount).toBe(0);
    expect(recording.failedWriteCount).toBe(0);
  });

  it('exposes the GPS-positions selector with an empty initial fix list', () => {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });

    // Structural cast mirrors src/main.ts: selectGpsPositions is typed against
    // the framework's internal CombinedRootState, but only reads `gpsData`.
    const state = store.getState() as unknown as Parameters<
      typeof selectGpsPositions
    >[0];
    expect(selectGpsPositions(state)).toEqual([]);
  });
});
