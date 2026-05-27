/**
 * Tests for the `gpsData/markReferencePoint` → `refPoints/addCurrentRefPointMark`
 * listener middleware. See [ref-point-mark-listener.ts](./ref-point-mark-listener.ts)
 * and F2 of
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).
 */

import { describe, expect, it } from 'vitest';
import { createRecorderStore } from './recorder-store';
import { markReferencePoint } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import type { Vector3, Quaternion } from 'gps-plus-slam-app-framework/core';

function buildStore() {
  return createRecorderStore({ storageBackend: new NullStorageBackend() });
}

const ID = 'ref-1';
const POSITION: Vector3 = [1, 2, -3];
const ROTATION: Quaternion = [0, 0, 0, 1];
const RAW_GPS = {
  id: 'gps-1',
  latitude: 50.7753,
  longitude: 6.0839,
  altitude: 220,
  timestamp: 1_700_000_000_000,
};

describe('ref-point-mark-listener', () => {
  // Why: F2 — markReferencePoint must produce exactly one
  // addCurrentRefPointMark so the red current-session sphere renders
  // both live and during replay (no double-dispatch from the legacy
  // visualizer path).
  it('appends a current ref-point mark with raw odom + raw GPS fallback', () => {
    const store = buildStore();

    store.dispatch(
      markReferencePoint({
        id: ID,
        position: POSITION,
        rotation: ROTATION,
        rawGpsPoint: RAW_GPS,
        timestamp: 1_700_000_001_000,
      })
    );

    const marks = store.getState().refPoints.currentMarks ?? [];
    expect(marks).toHaveLength(1);
    const mark = marks[0];
    expect(mark).toBeDefined();
    if (!mark) return;
    expect(mark.id).toBe(ID);
    expect(mark.odomPosition).toEqual(POSITION);
    expect(mark.odomRotation).toEqual(ROTATION);
    expect(mark.timestamp).toBe(1_700_000_001_000);
    // No alignment matrix available yet → raw GPS fallback.
    expect(mark.gpsPosition).toEqual({
      lat: RAW_GPS.latitude,
      lon: RAW_GPS.longitude,
      altitude: RAW_GPS.altitude,
    });
  });

  // Why: the listener fires once per markReferencePoint action; the
  // legacy explicit dispatch in `visualizeRefPoint` has been removed.
  // This guards against silently re-introducing double-dispatch.
  it('dispatches exactly one addCurrentRefPointMark per markReferencePoint', () => {
    const store = buildStore();

    store.dispatch(
      markReferencePoint({
        id: 'ref-a',
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        rawGpsPoint: { ...RAW_GPS, id: 'gps-a' },
      })
    );
    store.dispatch(
      markReferencePoint({
        id: 'ref-b',
        position: [1, 0, 0],
        rotation: [0, 0, 0, 1],
        rawGpsPoint: { ...RAW_GPS, id: 'gps-b' },
      })
    );

    const marks = store.getState().refPoints.currentMarks ?? [];
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.id)).toEqual(['ref-a', 'ref-b']);
  });

  // Why: timestamps default to Date.now() inside the reducer when the
  // caller omits one. The mark we synthesise must mirror whatever
  // timestamp the library stored, so we read it back from state.
  it('falls back to Date.now()-style timestamp when payload omits one', () => {
    const store = buildStore();
    const before = Date.now();
    store.dispatch(
      markReferencePoint({
        id: ID,
        position: POSITION,
        rotation: ROTATION,
        rawGpsPoint: RAW_GPS,
      })
    );
    const after = Date.now();
    const mark = (store.getState().refPoints.currentMarks ?? [])[0];
    expect(mark).toBeDefined();
    if (!mark) return;
    expect(mark.timestamp).toBeGreaterThanOrEqual(before);
    expect(mark.timestamp).toBeLessThanOrEqual(after);
  });
});
