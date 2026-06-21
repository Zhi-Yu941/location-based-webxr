/**
 * Action Schema Tests
 *
 * Verifies that the Redux actions have the correct structure for replay.
 * This is important because the recorded actions will be used by GpsPlusSlamJs
 * for integration testing and parameter optimization.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * and docs/issue-library-integration.md
 *
 * The recordGpsEvent action uses the LIBRARY's format with:
 * - odomPosition/odomRotation (AR pose as tuples)
 * - gpsPoint (full GpsPoint with coordinates, weight, etc.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LatLong } from 'gps-plus-slam-app-framework/core';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  createRecorderStore,
  startSession,
  setZeroPos,
  recordGpsEvent,
  recordDepthSample,
  type RecordGpsEventPayload,
  type SessionMetadata,
  type RecorderStore,
  type DepthSample,
} from './recorder-store';

// Mock opfs-storage's writeAction to capture what would be written
// (ScenarioWrappingStorageBackend → opfs-storage; partial mock keeps the rest real).
const writtenActions: unknown[] = [];
let pendingWrites: Promise<void>[] = [];

vi.mock(
  'gps-plus-slam-app-framework/storage/opfs-storage',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    writeAction: vi.fn().mockImplementation((action) => {
      writtenActions.push(action);
      const p = Promise.resolve();
      pendingWrites.push(p);
      return p;
    }),
  })
);

/**
 * Flushes all pending writeAction calls.
 * This replaces the flaky setTimeout pattern with deterministic awaiting.
 */
async function flushWrites(): Promise<void> {
  await Promise.all(pendingWrites);
  pendingWrites = [];
}

describe('Action Schema Validation', () => {
  let store: RecorderStore;

  beforeEach(() => {
    writtenActions.length = 0;
    pendingWrites = [];
    store = createRecorderStore();
  });

  describe('startSession action', () => {
    it('should have correct type and payload structure', async () => {
      const metadata: SessionMetadata = {
        contextTag: 'Test Scenario',
        sessionName: 'recording-2025-01-01_12-00-00utc',
        startTime: 1704110400000,
        deviceInfo: 'Pixel 7',
        notes: 'Sunny weather',
      };

      store.dispatch(startSession(metadata));
      await flushWrites();

      expect(writtenActions).toHaveLength(1);
      const action = writtenActions[0] as {
        type: string;
        payload: SessionMetadata;
      };

      expect(action.type).toBe('recording/startSession');
      expect(action.payload).toEqual(metadata);
      expect(typeof action.payload.startTime).toBe('number');
    });
  });

  describe('setZeroPos action (library)', () => {
    it('should set the zero reference position', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );

      store.dispatch(setZeroPos({ lat: 48.8566, lon: 2.3522 }));
      await flushWrites();

      const zeroAction = writtenActions.find(
        (a) => (a as RecordedAction).type === 'gpsData/setZeroPos'
      ) as { type: string; payload: LatLong };

      expect(zeroAction).toBeDefined();
      expect(zeroAction.payload.lat).toBeCloseTo(48.8566);
      expect(zeroAction.payload.lon).toBeCloseTo(2.3522);
    });
  });

  describe('recordGpsEvent action (library)', () => {
    const zeroRef = { lat: 48.8566, lon: 2.3522 };

    it('should have correct structure with library payload format', async () => {
      // Set up recording session and zero pos
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );
      store.dispatch(setZeroPos(zeroRef));

      const timestamp = 1704110401000;
      const payload: RecordGpsEventPayload = {
        odomPosition: [1.5, 0.2, -3.0],
        odomRotation: [0.0, 0.707, 0.0, 0.707], // quaternion [x, y, z, w]
        rawGpsPoint: {
          id: 'gps-1',
          latitude: 48.8567,
          longitude: 2.3523,
          altitude: 35.5,
          latLongAccuracy: 5.0,
          timestamp,
        },
      };

      store.dispatch(recordGpsEvent(payload));
      await flushWrites();

      const gpsEventAction = writtenActions.find(
        (a) => (a as RecordedAction).type === 'gpsData/recordGpsEvent'
      ) as { type: string; payload: RecordGpsEventPayload };

      expect(gpsEventAction).toBeDefined();

      // Verify odometry pose structure (library format)
      expect(gpsEventAction.payload.odomPosition).toHaveLength(3);
      expect(gpsEventAction.payload.odomRotation).toHaveLength(4);

      // Verify RawGpsPoint structure (raw-storage pattern)
      expect(typeof gpsEventAction.payload.rawGpsPoint.id).toBe('string');
      expect(typeof gpsEventAction.payload.rawGpsPoint.latitude).toBe('number');
      expect(typeof gpsEventAction.payload.rawGpsPoint.longitude).toBe(
        'number'
      );
      // Derived fields must not be in the payload
      expect(gpsEventAction.payload.rawGpsPoint).not.toHaveProperty(
        'coordinates'
      );
      expect(gpsEventAction.payload.rawGpsPoint).not.toHaveProperty('zeroRef');
      expect(gpsEventAction.payload.rawGpsPoint).not.toHaveProperty('weight');
    });

    it('should preserve latLongAccuracy for reducer weight computation', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );
      store.dispatch(setZeroPos(zeroRef));

      store.dispatch(
        recordGpsEvent({
          odomPosition: [0, 0, 0],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: 'gps-1',
            latitude: 48.8567,
            longitude: 2.3523,
            latLongAccuracy: 5.0,
            timestamp: Date.now(),
          },
        })
      );
      await flushWrites();

      const action = writtenActions.find(
        (a) => (a as RecordedAction).type === 'gpsData/recordGpsEvent'
      ) as { type: string; payload: RecordGpsEventPayload };

      // Accuracy preserved for the reducer to compute weight
      expect(action.payload.rawGpsPoint.latLongAccuracy).toBeCloseTo(5.0);
    });
  });

  describe('recordDepthSample action', () => {
    it('should have correct structure with camera pose and depth points', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );

      const depthPayload: DepthSample = {
        timestamp: 1704110401000,
        cameraPos: [1.5, 0.2, -3.0],
        cameraRot: [0.0, 0.707, 0.0, 0.707],
        points: [
          { screenX: 0.25, screenY: 0.25, depthM: 1.5 },
          { screenX: 0.5, screenY: 0.5, depthM: 2.3 },
          { screenX: 0.75, screenY: 0.75, depthM: 3.1 },
        ],
      };

      store.dispatch(recordDepthSample(depthPayload));
      await flushWrites();

      const depthAction = writtenActions.find(
        (a) => (a as RecordedAction).type === 'recording/recordDepthSample'
      ) as { type: string; payload: DepthSample };

      expect(depthAction).toBeDefined();
      expect(depthAction.payload.timestamp).toBe(1704110401000);
      expect(depthAction.payload.cameraPos).toHaveLength(3);
      expect(depthAction.payload.cameraRot).toHaveLength(4);
      expect(depthAction.payload.points).toHaveLength(3);
      expect(depthAction.payload.points[0]).toHaveProperty('screenX');
      expect(depthAction.payload.points[0]).toHaveProperty('screenY');
      expect(depthAction.payload.points[0]).toHaveProperty('depthM');
    });

    /**
     * Why this test matters:
     * New recordings carry the capturing view's projectionMatrix (camera
     * intrinsics for unprojection into the AR-space occupancy grid). The
     * field is optional/additive — the previous test (no matrix) proves old
     * payload shapes still persist unchanged; this one proves the matrix
     * survives persistence as a plain 16-number array.
     */
    it('should persist the optional projectionMatrix on new recordings', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );

      const projectionMatrix = [
        0.97, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1.0004, -1, 0, 0, -0.02, 0,
      ] as const;
      store.dispatch(
        recordDepthSample({
          timestamp: Date.now(),
          cameraPos: [0, 0, 0],
          cameraRot: [0, 0, 0, 1],
          points: [{ screenX: 0.5, screenY: 0.5, depthM: 2.0 }],
          projectionMatrix,
        })
      );
      await flushWrites();

      const depthAction = writtenActions.find(
        (a) => (a as RecordedAction).type === 'recording/recordDepthSample'
      ) as { type: string; payload: DepthSample };

      expect(depthAction.payload.projectionMatrix).toHaveLength(16);
      const json = JSON.stringify(depthAction);
      const parsed = JSON.parse(json) as typeof depthAction;
      expect(parsed.payload.projectionMatrix).toEqual([...projectionMatrix]);
    });

    /**
     * Why this test matters (occupancy-grid port plan Iter 8):
     * Per-point `rgb` is an additive persisted field — a colored point must
     * survive persistence + JSON round-trip with its 0–255 triple intact,
     * and a color-less point in the same sample must stay WITHOUT the key
     * (old-format byte-compatibility).
     */
    it('should persist the optional per-point rgb (and omit it when absent)', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );

      store.dispatch(
        recordDepthSample({
          timestamp: Date.now(),
          cameraPos: [0, 0, 0],
          cameraRot: [0, 0, 0, 1],
          points: [
            { screenX: 0.25, screenY: 0.5, depthM: 2.0, rgb: [120, 45, 200] },
            { screenX: 0.75, screenY: 0.5, depthM: 3.0 },
          ],
        })
      );
      await flushWrites();

      const depthAction = writtenActions.find(
        (a) => (a as RecordedAction).type === 'recording/recordDepthSample'
      ) as { type: string; payload: DepthSample };

      const json = JSON.stringify(depthAction);
      const parsed = JSON.parse(json) as typeof depthAction;
      expect(parsed.payload.points[0]?.rgb).toEqual([120, 45, 200]);
      expect(parsed.payload.points[1]).not.toHaveProperty('rgb');
    });

    it('should be JSON-serializable for replay', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );

      store.dispatch(
        recordDepthSample({
          timestamp: Date.now(),
          cameraPos: [0, 0, 0],
          cameraRot: [0, 0, 0, 1],
          points: [{ screenX: 0.5, screenY: 0.5, depthM: 2.0 }],
        })
      );
      await flushWrites();

      const depthAction = writtenActions.find(
        (a) => (a as RecordedAction).type === 'recording/recordDepthSample'
      );
      expect(depthAction).toBeDefined();

      // Verify JSON serialization works
      const json = JSON.stringify(depthAction);
      const parsed = JSON.parse(json) as typeof depthAction;
      expect(parsed).toEqual(depthAction);
    });
  });

  describe('action serialization', () => {
    it('all actions should be JSON-serializable', async () => {
      const zeroRef = { lat: 48.8566, lon: 2.3522 };

      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );

      store.dispatch(setZeroPos(zeroRef));

      store.dispatch(
        recordGpsEvent({
          odomPosition: [1, 2, 3],
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: 'gps-1',
            latitude: 48.8567,
            longitude: 2.3523,
            latLongAccuracy: 5,
            timestamp: Date.now(),
          },
        })
      );
      await flushWrites();

      for (const action of writtenActions) {
        // Should not throw
        const json = JSON.stringify(action);
        const parsed = JSON.parse(json) as typeof action;
        expect(parsed).toEqual(action);
      }
    });
  });

  describe('type-contract: RecordedAction usage', () => {
    // Why this test matters: All action-finding casts in this file should use
    // the canonical RecordedAction type from zip-reader, not ad-hoc inline
    // `{ type: string }` shapes. This test verifies the structural compatibility.
    it('RecordedAction should be assignable from dispatched actions', async () => {
      store.dispatch(
        startSession({
          scenarioName: 'Test',
          sessionName: 'test',
          startTime: Date.now(),
        })
      );
      await flushWrites();

      // Every written action must conform to RecordedAction shape
      for (const action of writtenActions) {
        const recorded = action as RecordedAction;
        expect(typeof recorded.type).toBe('string');
        expect(recorded.type.length).toBeGreaterThan(0);
      }
    });
  });
});
