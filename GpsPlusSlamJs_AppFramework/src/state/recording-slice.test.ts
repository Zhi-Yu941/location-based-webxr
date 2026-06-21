/**
 * Recording Slice Tests — latestDepthSample observation hook.
 *
 * Why this test matters:
 * The recordDepthSample reducer was a deliberate no-op (the action stream
 * is the persisted source of truth). The AR-space occupancy grid changed
 * that minimally: the reducer now stores the LATEST sample so the
 * established `store.subscribe` + reference-comparison wiring pattern can
 * observe new samples (2026-06-11 port plan §1.1). The action type and
 * persistence behavior stay unchanged so existing recordings replay
 * identically.
 */

import { describe, it, expect } from 'vitest';
import type { DepthSample } from '../types/ar-types';
import {
  recordingReducer,
  recordDepthSample,
  startSession,
} from './recording-slice';

const SAMPLE: DepthSample = {
  timestamp: 1000,
  cameraPos: [1, 2, 3],
  cameraRot: [0, 0, 0, 1],
  points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
};

describe('recording-slice latestDepthSample', () => {
  it('starts with no latest sample', () => {
    const state = recordingReducer(undefined, { type: '@@INIT' });
    expect(state.latestDepthSample).toBeNull();
  });

  it('stores the latest depth sample payload by reference', () => {
    const initial = recordingReducer(undefined, { type: '@@INIT' });
    const state = recordingReducer(initial, recordDepthSample(SAMPLE));
    expect(state.latestDepthSample).toBe(SAMPLE);
  });

  it('replaces the previous sample on each dispatch', () => {
    const second: DepthSample = { ...SAMPLE, timestamp: 2000 };
    let state = recordingReducer(undefined, { type: '@@INIT' });
    state = recordingReducer(state, recordDepthSample(SAMPLE));
    state = recordingReducer(state, recordDepthSample(second));
    expect(state.latestDepthSample).toBe(second);
  });

  it('startSession clears the latest sample (sessions start clean)', () => {
    let state = recordingReducer(undefined, { type: '@@INIT' });
    state = recordingReducer(state, recordDepthSample(SAMPLE));
    state = recordingReducer(
      state,
      startSession({ contextTag: 's', sessionName: 'n', startTime: 1 })
    );
    expect(state.latestDepthSample).toBeNull();
  });

  it('keeps the recording/recordDepthSample action type (replay compatibility)', () => {
    expect(recordDepthSample(SAMPLE).type).toBe('recording/recordDepthSample');
  });
});

describe('recording-slice startSession contextTag', () => {
  it('stores contextTag from a current-format payload', () => {
    const state = recordingReducer(
      undefined,
      startSession({ contextTag: 'Park Walk', sessionName: 'n', startTime: 1 })
    );
    expect(state.sessionMetadata?.contextTag).toBe('Park Walk');
  });

  it('maps the legacy scenarioName onto contextTag (replay of pre-rename recordings)', () => {
    // Why: recordings made before the 2026-06-21 rename persist
    // `recording/startSession` with `scenarioName`, not `contextTag`. Replaying
    // such an action must still populate `contextTag` so old recordings keep
    // working without a separate migration step. This is the backward-compat
    // contract that lets the field be renamed safely.
    const state = recordingReducer(
      undefined,
      startSession({ scenarioName: 'Old Tour', sessionName: 'n', startTime: 1 })
    );
    expect(state.sessionMetadata?.contextTag).toBe('Old Tour');
    // The stored metadata must NOT carry the legacy field forward.
    expect(
      (state.sessionMetadata as unknown as Record<string, unknown>).scenarioName
    ).toBeUndefined();
  });

  it('prefers contextTag when both are present', () => {
    const state = recordingReducer(
      undefined,
      startSession({
        contextTag: 'New',
        scenarioName: 'Legacy',
        sessionName: 'n',
        startTime: 1,
      })
    );
    expect(state.sessionMetadata?.contextTag).toBe('New');
  });
});
