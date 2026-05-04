/**
 * Recording Migration Tests
 *
 * Why these tests matter:
 * The migration system handles four recording eras:
 *
 * Era 1 (pre-2026-03-15, no odomCoordVersion): Positions are raw WebXR (already
 * correct for the current reducer which applies webxrToNUE). GPS payloads use
 * old `gpsPoint` with derived fields â€” rename to `rawGpsPoint` and strip.
 *
 * Era 2 (2026-03-15 â†’ 2026-04, odomCoordVersion: 2): Positions were converted
 * to NUE at dispatch time. They must be reversed back to raw WebXR so the
 * reducer's webxrToNUE() produces correct NUE state. GPS payloads also get
 * the gpsPointâ†’rawGpsPoint migration.
 *
 * Era 3 (2026-04, odomCoordVersion: 3): Positions are raw WebXR (correct).
 * GPS payloads use old `gpsPoint` with derived fields â€” rename + strip.
 *
 * Era 4 (current, odomCoordVersion: 4): No migration needed.
 *
 * Related docs: docs/2026-04-09-raw-storage-convert-on-read.md
 */

import { describe, it, expect } from 'vitest';
import {
  migrateActionsIfNeeded,
  ODOM_COORD_VERSION,
} from './recording-migration';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';

// Minimal session metadata shapes for testing
type Era1Metadata = Record<string, unknown>; // no odomCoordVersion field
type Era2Metadata = Record<string, unknown> & { odomCoordVersion: 2 };
type Era3Metadata = Record<string, unknown> & { odomCoordVersion: 3 };
type Era4Metadata = Record<string, unknown> & { odomCoordVersion: 4 };

describe('recording-migration', () => {
  describe('ODOM_COORD_VERSION', () => {
    /**
     * Why this test matters:
     * The constant is used at both write-time (session metadata) and read-time
     * (migration guard). A typo would silently disable migration or trigger
     * wrong-era logic.
     */
    it('equals 5', () => {
      expect(ODOM_COORD_VERSION).toBe(5);
    });
  });

  describe('migrateActionsIfNeeded', () => {
    // =======================================================================
    // Era 4: no migration needed (odomCoordVersion >= 4)
    // =======================================================================

    describe('era 4 â€” no migration (odomCoordVersion >= 4)', () => {
      /**
       * Why this test matters:
       * Era-4 recordings store raw WebXR positions and rawGpsPoint payloads.
       * No migration needed â€” the original array reference must be returned.
       */
      it('returns actions unchanged (same reference) for odomCoordVersion = 4', () => {
        const metadata: Era4Metadata = { odomCoordVersion: 4 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              rawGpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        expect(result).toBe(actions); // same reference
      });

      /**
       * Why this test matters:
       * Future versions (5, 6, â€¦) must also skip migration.
       */
      it('returns actions unchanged for odomCoordVersion > 4', () => {
        const metadata = { odomCoordVersion: 5 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: { odomPosition: [1, 2, 3] },
          },
        ];

        expect(migrateActionsIfNeeded(actions, metadata)).toBe(actions);
      });
    });

    // =======================================================================
    // Era 3: gpsPointâ†’rawGpsPoint migration only (positions already correct)
    // =======================================================================

    describe('era 3 â€” gpsPointâ†’rawGpsPoint (odomCoordVersion = 3)', () => {
      /**
       * Why this test matters:
       * Era-3 recordings have raw WebXR positions (correct) but use the old
       * `gpsPoint` field with derived fields. Migration renames to `rawGpsPoint`
       * and strips coordinates, weight, zeroRef, deviceRotation.
       */
      it('renames gpsPoint to rawGpsPoint and strips derived fields', () => {
        const metadata: Era3Metadata = { odomCoordVersion: 3 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                altitude: 100,
                latLongAccuracy: 5,
                zeroRef: { lat: 49, lon: 8 },
                coordinates: [10, 0, 5],
                weight: 0.2,
                deviceRotation: [0, 0, 0, 1],
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        // odomPosition unchanged (already raw WebXR)
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
        // gpsPoint renamed to rawGpsPoint, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['id']).toBe('gps-1');
        expect(raw['latitude']).toBe(49);
        expect(raw['longitude']).toBe(8);
        expect(raw['altitude']).toBe(100);
        expect(raw['latLongAccuracy']).toBe(5);
        expect(raw['timestamp']).toBe(1000);
        // Derived fields must be gone
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
        expect(raw['deviceRotation']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint payloads also need gpsPointâ†’rawGpsPoint migration.
       */
      it('renames gpsPoint to rawGpsPoint in markReferencePoint payload', () => {
        const metadata: Era3Metadata = { odomCoordVersion: 3 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'bench',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'gps-ref-1',
                latitude: 49,
                longitude: 8,
                zeroRef: { lat: 49, lon: 8 },
                coordinates: [0, 0, 0],
                weight: 1,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['id']).toBe('gps-ref-1');
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
      });
    });

    // =======================================================================
    // Era 2: reverse NUE positions â†’ raw WebXR
    // =======================================================================

    describe('era 2 â€” reverse NUEâ†’WebXR (odomCoordVersion = 2)', () => {
      /**
       * Why this test matters:
       * Era-2 recordGpsEvent.odomPosition is already NUE [-z,y,x].
       * Reverse: NUE [n,u,e] â†’ WebXR [e,u,-n] = [v[2],v[1],-v[0]].
       * Example: NUE [-3,2,1] â†’ WebXR [1,2,3].
       */
      it('reverses recordGpsEvent.odomPosition from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [-3, 2, 1], // NUE (era-2 format)
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                zeroRef: { lat: 49, lon: 8 },
                coordinates: [10, 0, 5],
                weight: 0.2,
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        // reversed: [e, u, -n] = [1, 2, 3]
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
        // gpsPoint renamed to rawGpsPoint, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint.position in era-2 is NUE â€” must be reversed.
       */
      it('reverses markReferencePoint.position from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'bench',
              position: [-3, 2, 1], // NUE
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'gps-ref',
                latitude: 49,
                longitude: 8,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]);
        // non-position fields unchanged
        expect(payload['id']).toBe('bench');
        expect(payload['rotation']).toEqual([0, 0, 0, 1]);
        // gpsPoint â†’ rawGpsPoint
        expect(payload['gpsPoint']).toBeUndefined();
        expect(
          (payload['rawGpsPoint'] as Record<string, unknown>)['latitude']
        ).toBe(49);
      });

      /**
       * Why this test matters:
       * add2dImage.position in era-2 is NUE â€” must be reversed.
       */
      it('reverses add2dImage.position from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/add2dImage',
            payload: {
              imageFile: 'frames/frame-000001.jpg',
              position: [-3, 2, 1], // NUE
              rotation: [0, 0, 0, 1],
              screenRotation: 0,
              capturedAt: 1704110400000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]);
        expect(payload['imageFile']).toBe('frames/frame-000001.jpg');
      });

      /**
       * Why this test matters:
       * odometryTrackingRestarted positions in era-2 are NUE â€” both
       * lastValidOdomPos and newOdomPos must be reversed.
       */
      it('reverses odometryTrackingRestarted positions from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/odometryTrackingRestarted',
            payload: {
              lastValidOdomPos: [-3, 2, 1], // NUE
              lastValidOdomRot: [0, 0, 0, 1],
              lastSensorRot: [0, 0, 0, 1],
              newOdomRot: [0, 0.1, 0, 0.995],
              newSensorRot: [0, 0, 0, 1],
              newOdomPos: [0.3, 1.0, 0.5], // NUE
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastValidOdomPos']).toEqual([1, 2, 3]);
        expect(payload['newOdomPos']).toEqual([0.5, 1.0, -0.3]);
        // rotations unchanged
        expect(payload['lastValidOdomRot']).toEqual([0, 0, 0, 1]);
      });

      /**
       * Why this test matters:
       * odometryTrackingRestarted without newOdomPos (optional) must not crash.
       */
      it('handles odometryTrackingRestarted without optional newOdomPos', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/odometryTrackingRestarted',
            payload: {
              lastValidOdomPos: [-3, 2, 1],
              lastValidOdomRot: [0, 0, 0, 1],
              lastSensorRot: [0, 0, 0, 1],
              newOdomRot: [0, 0, 0, 1],
              newSensorRot: [0, 0, 0, 1],
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastValidOdomPos']).toEqual([1, 2, 3]);
        expect(payload['newOdomPos']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * recordDepthSample.cameraPos was not handled by the old migration.
       * Era-2 depth samples have NUE cameraPos that must be reversed.
       */
      it('reverses recordDepthSample.cameraPos from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'recording/recordDepthSample',
            payload: {
              cameraPos: [-3, 2, 1], // NUE
              cameraRot: [0, 0, 0, 1],
              timestamp: 12345,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['cameraPos']).toEqual([1, 2, 3]);
        expect(payload['cameraRot']).toEqual([0, 0, 0, 1]);
      });

      /**
       * Why this test matters:
       * arLoopClosureDetected carries lastPos/newPos. In era-2 C# replay
       * recordings these are NUE and must be reversed.
       */
      it('reverses arLoopClosureDetected positions from NUE to raw WebXR', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/arLoopClosureDetected',
            payload: {
              lastPos: [-3, 2, 1], // NUE
              newPos: [5, 0, -2], // NUE
              lastRot: [0, 0, 0, 1],
              newRot: [0, 0, 0, 1],
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastPos']).toEqual([1, 2, 3]);
        expect(payload['newPos']).toEqual([-2, 0, -5]);
      });

      /**
       * Why this test matters:
       * Non-position actions (startSession, stopSession) must pass through.
       */
      it('leaves non-position actions untouched', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          { type: 'recording/startSession', payload: { scenarioName: 'test' } },
          { type: 'recording/stopSession', payload: undefined },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        expect(result[0]).toEqual(actions[0]);
        expect(result[1]).toEqual(actions[1]);
      });
    });

    // =======================================================================
    // Era 1: GPS coord swap only (no position migration)
    // =======================================================================

    describe('era 1 â€” gpsPointâ†’rawGpsPoint + strip derived fields (no odomCoordVersion)', () => {
      /**
       * Why this test matters:
       * Era-1 odomPosition is raw WebXR â€” correct for the current reducer.
       * GPS payload gets renamed from gpsPointâ†’rawGpsPoint with derived fields stripped.
       * The old ENU coordinates field is removed entirely (reducer recomputes).
       */
      it('renames gpsPoint to rawGpsPoint and strips derived fields, leaves odomPosition unchanged', () => {
        const metadata: Era1Metadata = {}; // no odomCoordVersion
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3], // raw WebXR â€” must stay as-is
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [5, 0, 10], // old ENU â€” should be stripped
                weight: 0.2,
                zeroRef: { lat: 49, lon: 8 },
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        // odomPosition unchanged (already raw WebXR)
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
        // gpsPoint â†’ rawGpsPoint, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['id']).toBe('gps-1');
        expect(raw['latitude']).toBe(49);
        expect(raw['longitude']).toBe(8);
        expect(raw['timestamp']).toBe(1000);
        expect(raw['coordinates']).toBeUndefined();
        expect(raw['weight']).toBeUndefined();
        expect(raw['zeroRef']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * Walking north: position stays as-is. GPS gpsPointâ†’rawGpsPoint strip.
       */
      it('keeps walking-north WebXR position unchanged, strips GPS derived fields', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [0, 0, -5], // raw WebXR 5m north
              gpsPoint: {
                id: 'gps-2',
                latitude: 49.001,
                longitude: 8,
                coordinates: [0, 0, 100], // old ENU
                weight: 1,
                timestamp: 2000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual([0, 0, -5]); // unchanged
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49.001);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * Walking east: position stays as-is. GPS gpsPointâ†’rawGpsPoint strip.
       */
      it('keeps walking-east WebXR position unchanged, strips GPS derived fields', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [3, 0, 0], // raw WebXR 3m east
              gpsPoint: {
                id: 'gps-3',
                latitude: 49,
                longitude: 8.001,
                coordinates: [50, 0, 0], // old ENU
                weight: 1,
                timestamp: 3000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual([3, 0, 0]); // unchanged
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['longitude']).toBe(8.001);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint.position is raw WebXR in era-1 â€” must NOT be
       * converted (the reducer handles it). gpsPointâ†’rawGpsPoint rename applies.
       */
      it('renames gpsPointâ†’rawGpsPoint in markReferencePoint, leaves position unchanged', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'benchCorner',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              gpsPoint: {
                id: 'gps-ref',
                latitude: 49.0,
                longitude: 8.0,
                timestamp: 1000,
              },
              timestamp: 1000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]); // unchanged
        expect(payload['id']).toBe('benchCorner');
        expect(payload['gpsPoint']).toBeUndefined();
        expect(
          (payload['rawGpsPoint'] as Record<string, unknown>)['latitude']
        ).toBe(49);
      });

      /**
       * Why this test matters:
       * add2dImage.position is raw WebXR in era-1 â€” must NOT be converted.
       */
      it('leaves add2dImage.position unchanged in era-1', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/add2dImage',
            payload: {
              imageFile: 'frames/frame-000001.jpg',
              position: [1, 2, 3],
              rotation: [0, 0, 0, 1],
              screenRotation: 0,
              capturedAt: 1704110400000,
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['position']).toEqual([1, 2, 3]); // unchanged
      });

      /**
       * Why this test matters:
       * odometryTrackingRestarted positions are raw WebXR in era-1 â€” unchanged.
       */
      it('leaves odometryTrackingRestarted positions unchanged in era-1', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/odometryTrackingRestarted',
            payload: {
              lastValidOdomPos: [1, 2, 3],
              lastValidOdomRot: [0, 0, 0, 1],
              lastSensorRot: [0, 0, 0, 1],
              newOdomRot: [0, 0.1, 0, 0.995],
              newSensorRot: [0, 0, 0, 1],
              newOdomPos: [0.5, 1.0, -0.3],
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['lastValidOdomPos']).toEqual([1, 2, 3]); // unchanged
        expect(payload['newOdomPos']).toEqual([0.5, 1.0, -0.3]); // unchanged
      });

      /**
       * Why this test matters:
       * Non-position era-1 actions pass through unchanged.
       */
      it('leaves non-position actions untouched (startSession, stopSession)', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          { type: 'recording/startSession', payload: { scenarioName: 'test' } },
          { type: 'recording/stopSession', payload: undefined },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        expect(result[0]).toEqual({
          type: 'recording/startSession',
          payload: { scenarioName: 'test' },
        });
        expect(result[1]).toEqual({
          type: 'recording/stopSession',
          payload: undefined,
        });
      });

      /**
       * Why this test matters:
       * Multiple GPS events must all have gpsPointâ†’rawGpsPoint applied.
       */
      it('renames gpsPointâ†’rawGpsPoint for all recordGpsEvent actions in a multi-event recording', () => {
        const metadata: Era1Metadata = {};
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 0, 0],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [10, 0, 0],
                weight: 1,
                timestamp: 1000,
              },
            },
          },
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [2, 0, -3],
              gpsPoint: {
                id: 'gps-2',
                latitude: 49.001,
                longitude: 8.001,
                coordinates: [20, 0, 30],
                weight: 1,
                timestamp: 2000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, metadata);

        const p0 = result[0].payload as Record<string, unknown>;
        expect(p0['odomPosition']).toEqual([1, 0, 0]); // unchanged
        expect(p0['gpsPoint']).toBeUndefined();
        expect((p0['rawGpsPoint'] as Record<string, unknown>)['latitude']).toBe(
          49
        );
        expect(
          (p0['rawGpsPoint'] as Record<string, unknown>)['coordinates']
        ).toBeUndefined();

        const p1 = result[1].payload as Record<string, unknown>;
        expect(p1['odomPosition']).toEqual([2, 0, -3]); // unchanged
        expect(p1['gpsPoint']).toBeUndefined();
        expect((p1['rawGpsPoint'] as Record<string, unknown>)['latitude']).toBe(
          49.001
        );
        expect(
          (p1['rawGpsPoint'] as Record<string, unknown>)['coordinates']
        ).toBeUndefined();
      });
    });

    // =======================================================================
    // Immutability
    // =======================================================================

    describe('immutability', () => {
      /**
       * Why this test matters:
       * Migration must not mutate the original actions array.
       */
      it('does not mutate the original actions array (era 1)', () => {
        const metadata: Era1Metadata = {};
        const originalGpsPoint = {
          id: 'gps-1',
          latitude: 49,
          longitude: 8,
          coordinates: [5, 0, 10],
          weight: 1,
          timestamp: 1000,
        };
        const original: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: originalGpsPoint,
            },
          },
        ];

        migrateActionsIfNeeded(original, metadata);

        const payload = original[0].payload as Record<string, unknown>;
        // Original must still have gpsPoint (not rawGpsPoint)
        expect(payload['gpsPoint']).toBe(originalGpsPoint);
        expect(payload['odomPosition']).toEqual([1, 2, 3]);
      });

      /**
       * Why this test matters:
       * Era-2 reverse migration must also not mutate the original.
       */
      it('does not mutate the original actions array (era 2)', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const original: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [-3, 2, 1],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [10, 0, 5],
                weight: 1,
                timestamp: 1000,
              },
            },
          },
        ];
        const originalOdomCopy = [-3, 2, 1];

        migrateActionsIfNeeded(original, metadata);

        const payload = original[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual(originalOdomCopy);
        // Original must still have gpsPoint (not rawGpsPoint)
        expect(payload['gpsPoint']).toBeDefined();
      });
    });

    // =======================================================================
    // Malformed payload guards
    // =======================================================================

    describe('malformed payload guards', () => {
      /**
       * Why this test matters:
       * recordGpsEvent with no payload (undefined) must not crash.
       */
      it('returns recordGpsEvent unmodified when payload is undefined', () => {
        const actions: RecordedAction[] = [
          { type: 'gpsData/recordGpsEvent', payload: undefined },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        expect(result[0]).toEqual(actions[0]);
      });

      /**
       * Why this test matters:
       * Era-1 recordGpsEvent missing gpsPoint skips gpsPointâ†’rawGpsPoint rename.
       */
      it('returns recordGpsEvent unmodified when gpsPoint is missing (era 1)', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        // No gpsPoint to rename â€” action passes through unchanged
        expect(result[0]).toEqual(actions[0]);
      });

      /**
       * Why this test matters:
       * Era-2 recordGpsEvent with missing odomPosition skips position
       * reversal, but gpsPointâ†’rawGpsPoint rename+strip still happens.
       */
      it('renames gpsPointâ†’rawGpsPoint even when odomPosition is missing (era 2)', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              gpsPoint: { coordinates: [1, 2, 3], latitude: 49, longitude: 8 },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * gpsPoint exists but has no coordinates â€” should still rename + strip.
       */
      it('renames gpsPointâ†’rawGpsPoint even when gpsPoint.coordinates is missing', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                timestamp: 1000,
              },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, null);
        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['gpsPoint']).toBeUndefined();
        expect(
          (payload['rawGpsPoint'] as Record<string, unknown>)['latitude']
        ).toBe(49);
      });

      /**
       * Why this test matters:
       * Non-numeric elements in odomPosition skip position reversal,
       * but gpsPointâ†’rawGpsPoint rename+strip still applies.
       */
      it('skips position reversal for non-numeric odomPosition but still renames gpsPoint (era 2)', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: ['a', 'b', 'c'],
              gpsPoint: { coordinates: [1, 2, 3], latitude: 49, longitude: 8 },
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        const payload = result[0].payload as Record<string, unknown>;
        // odomPosition left as-is (non-numeric, can't reverse)
        expect(payload['odomPosition']).toEqual(['a', 'b', 'c']);
        // gpsPoint renamed, derived fields stripped
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined();
      });

      /**
       * Why this test matters:
       * markReferencePoint with no payload must not crash.
       */
      it('returns markReferencePoint unmodified when payload is undefined', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          { type: 'gpsData/markReferencePoint', payload: undefined },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        expect(result[0]).toEqual(actions[0]);
      });

      /**
       * Why this test matters:
       * position is not an array â€” indexing would produce garbage.
       */
      it('returns markReferencePoint unmodified when position is not an array', () => {
        const metadata: Era2Metadata = { odomCoordVersion: 2 };
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/markReferencePoint',
            payload: {
              id: 'test',
              position: 'bad',
            },
          },
        ];
        const result = migrateActionsIfNeeded(actions, metadata);
        expect(result[0]).toEqual(actions[0]);
      });
    });

    // =======================================================================
    // Edge cases
    // =======================================================================

    describe('edge cases', () => {
      /**
       * Why this test matters:
       * Empty recordings must not throw.
       */
      it('handles empty actions array', () => {
        const metadata: Era1Metadata = {};
        expect(() => migrateActionsIfNeeded([], metadata)).not.toThrow();
        expect(migrateActionsIfNeeded([], metadata)).toEqual([]);
      });

      /**
       * Why this test matters:
       * null metadata (zip has no session.json) is treated as era-1 â€”
       * only GPS coord swap is applied.
       */
      it('treats null metadata as era-1 (renames gpsPointâ†’rawGpsPoint, keeps positions)', () => {
        const actions: RecordedAction[] = [
          {
            type: 'gpsData/recordGpsEvent',
            payload: {
              odomPosition: [1, 2, 3],
              gpsPoint: {
                id: 'gps-1',
                latitude: 49,
                longitude: 8,
                coordinates: [5, 0, 10],
                weight: 1,
                timestamp: 1000,
              },
            },
          },
        ];

        const result = migrateActionsIfNeeded(actions, null);

        const payload = result[0].payload as Record<string, unknown>;
        expect(payload['odomPosition']).toEqual([1, 2, 3]); // unchanged
        expect(payload['gpsPoint']).toBeUndefined();
        const raw = payload['rawGpsPoint'] as Record<string, unknown>;
        expect(raw['latitude']).toBe(49);
        expect(raw['coordinates']).toBeUndefined(); // stripped
      });
    });
  });
});
