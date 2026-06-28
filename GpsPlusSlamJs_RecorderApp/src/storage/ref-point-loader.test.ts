/**
 * Reference Point Loader Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadAllRefPoints,
  loadRefPoint,
  saveRefPointObservation,
  listRefPointIds,
  flattenRefPointsToMarks,
  averageGpsPerRefPoint,
  type RefPointDefinition,
  type RefPointObservation,
} from './ref-point-loader';
import type { GpsPoint } from 'gps-plus-slam-app-framework/core';
import {
  MockFSDirectoryHandle,
  MockFSFileHandle,
} from 'gps-plus-slam-app-framework/test-utils/browser-mocks';

// Helper to create mock GPS point for tests
const mockGpsPoint: GpsPoint = {
  id: 'gps1',
  zeroRef: { lat: 48.8584, lon: 2.2945 },
  latitude: 48.8584,
  longitude: 2.2945,
  altitude: 100,
  latLongAccuracy: 5,
  altitudeAccuracy: 5,
  coordinates: [0, 0, 0],
  weight: 1,
  timestamp: Date.now(),
};

describe('ref-point-loader', () => {
  let scenarioHandle: MockFSDirectoryHandle;
  let refPointsHandle: MockFSDirectoryHandle;

  beforeEach(() => {
    scenarioHandle = new MockFSDirectoryHandle('Paris Eiffeltower');
    refPointsHandle = new MockFSDirectoryHandle('refPoints');
    scenarioHandle.addDirectory('refPoints', refPointsHandle);
  });

  describe('loadAllRefPoints', () => {
    it('should load all reference points from refPoints directory', async () => {
      const pointA: RefPointDefinition = {
        id: 'pointA',
        name: 'Bench Corner',
        createdAt: 1000,
        observations: [
          {
            sessionId: 'recording-2025-01-01',
            timestamp: 1000,
            arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
            gpsPoint: mockGpsPoint,
          },
        ],
      };

      const pointB: RefPointDefinition = {
        id: 'pointB',
        name: 'Statue Base',
        createdAt: 2000,
        observations: [],
      };

      refPointsHandle.addFile('pointA.json', JSON.stringify(pointA));
      refPointsHandle.addFile('pointB.json', JSON.stringify(pointB));

      const result = await loadAllRefPoints(scenarioHandle);

      expect(result).toHaveLength(2);
      expect(result.find((p) => p.id === 'pointA')).toEqual(pointA);
      expect(result.find((p) => p.id === 'pointB')).toEqual(pointB);
    });

    it('should return empty array if refPoints directory does not exist', async () => {
      const emptyScenario = new MockFSDirectoryHandle('Empty');
      const result = await loadAllRefPoints(emptyScenario);
      expect(result).toEqual([]);
    });

    it('should skip invalid JSON files', async () => {
      refPointsHandle.addFile(
        'valid.json',
        JSON.stringify({
          id: 'valid',
          name: 'Valid',
          createdAt: 1000,
          observations: [],
        })
      );
      refPointsHandle.addFile('invalid.json', 'not valid json');

      const result = await loadAllRefPoints(scenarioHandle);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');
    });

    /**
     * Regression test: validates that JSON files with incorrect schema are rejected.
     * This tests the isRefPointDefinition type guard added to prevent runtime errors
     * from malformed data that is valid JSON but doesn't match RefPointDefinition.
     */
    it('should skip JSON files that do not match RefPointDefinition schema', async () => {
      // Valid RefPointDefinition
      refPointsHandle.addFile(
        'valid.json',
        JSON.stringify({
          id: 'valid',
          name: 'Valid Point',
          createdAt: 1000,
          observations: [],
        })
      );

      // Missing required 'id' field
      refPointsHandle.addFile(
        'missingId.json',
        JSON.stringify({
          name: 'Missing ID',
          createdAt: 1000,
          observations: [],
        })
      );

      // Missing required 'name' field
      refPointsHandle.addFile(
        'missingName.json',
        JSON.stringify({
          id: 'noname',
          createdAt: 1000,
          observations: [],
        })
      );

      // Missing required 'createdAt' field
      refPointsHandle.addFile(
        'missingCreatedAt.json',
        JSON.stringify({
          id: 'nocreated',
          name: 'No Created',
          observations: [],
        })
      );

      // Missing required 'observations' field
      refPointsHandle.addFile(
        'missingObservations.json',
        JSON.stringify({
          id: 'noobs',
          name: 'No Observations',
          createdAt: 1000,
        })
      );

      // Wrong type for 'id' (number instead of string)
      refPointsHandle.addFile(
        'wrongIdType.json',
        JSON.stringify({
          id: 123,
          name: 'Wrong ID Type',
          createdAt: 1000,
          observations: [],
        })
      );

      // Wrong type for 'observations' (object instead of array)
      refPointsHandle.addFile(
        'wrongObservationsType.json',
        JSON.stringify({
          id: 'wrongobs',
          name: 'Wrong Observations Type',
          createdAt: 1000,
          observations: {},
        })
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadAllRefPoints(scenarioHandle);

      // Only the valid one should be loaded
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');

      // Should have logged warnings for each invalid schema
      expect(warnSpy).toHaveBeenCalledTimes(6);
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "missingId.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "missingName.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "missingCreatedAt.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "missingObservations.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "wrongIdType.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "wrongObservationsType.json"'
      );

      warnSpy.mockRestore();
    });

    /**
     * Regression test: validates that null/non-object JSON values are rejected.
     * Tests edge cases for the isRefPointDefinition type guard.
     */
    it('should skip JSON files with null or primitive values', async () => {
      refPointsHandle.addFile('nullValue.json', 'null');
      refPointsHandle.addFile('stringValue.json', '"just a string"');
      refPointsHandle.addFile('numberValue.json', '42');
      refPointsHandle.addFile('arrayValue.json', '[]');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadAllRefPoints(scenarioHandle);

      expect(result).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledTimes(4);

      warnSpy.mockRestore();
    });

    /**
     * Regression test: validates that observations within RefPointDefinition are validated.
     * Malformed observation objects (missing arPose, gpsPoint, or nested properties)
     * should cause the entire file to be rejected to prevent runtime crashes in
     * flattenRefPointsToMarks when accessing nested properties.
     */
    it('should skip JSON files with malformed observation objects', async () => {
      // Valid observation for reference
      const validObs = {
        sessionId: 'session-1',
        timestamp: 1000,
        arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
        gpsPoint: { latitude: 48.8584, longitude: 2.2945 },
      };

      // Valid RefPointDefinition for control
      refPointsHandle.addFile(
        'valid.json',
        JSON.stringify({
          id: 'valid',
          name: 'Valid Point',
          createdAt: 1000,
          observations: [validObs],
        })
      );

      // Observation missing arPose
      refPointsHandle.addFile(
        'missingArPose.json',
        JSON.stringify({
          id: 'missingArPose',
          name: 'Missing arPose',
          createdAt: 1000,
          observations: [
            { sessionId: 'session-1', timestamp: 1000, gpsPoint: {} },
          ],
        })
      );

      // Observation missing gpsPoint
      refPointsHandle.addFile(
        'missingGpsPoint.json',
        JSON.stringify({
          id: 'missingGpsPoint',
          name: 'Missing gpsPoint',
          createdAt: 1000,
          observations: [
            { sessionId: 'session-1', timestamp: 1000, arPose: {} },
          ],
        })
      );

      // Observation is null
      refPointsHandle.addFile(
        'nullObservation.json',
        JSON.stringify({
          id: 'nullObservation',
          name: 'Null Observation',
          createdAt: 1000,
          observations: [null],
        })
      );

      // Observation is a primitive
      refPointsHandle.addFile(
        'primitiveObservation.json',
        JSON.stringify({
          id: 'primitiveObservation',
          name: 'Primitive Observation',
          createdAt: 1000,
          observations: ['not an object'],
        })
      );

      // arPose missing position array
      refPointsHandle.addFile(
        'arPoseMissingPosition.json',
        JSON.stringify({
          id: 'arPoseMissingPosition',
          name: 'arPose missing position',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session-1',
              timestamp: 1000,
              arPose: { rotation: [0, 0, 0, 1] },
              gpsPoint: { latitude: 48.8584, longitude: 2.2945 },
            },
          ],
        })
      );

      // gpsPoint missing latitude
      refPointsHandle.addFile(
        'gpsPointMissingLat.json',
        JSON.stringify({
          id: 'gpsPointMissingLat',
          name: 'gpsPoint missing latitude',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session-1',
              timestamp: 1000,
              arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
              gpsPoint: { longitude: 2.2945 },
            },
          ],
        })
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadAllRefPoints(scenarioHandle);

      // Only the valid one should be loaded
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');

      // Should have logged warnings for each invalid schema
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "missingArPose.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "missingGpsPoint.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "nullObservation.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "primitiveObservation.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "arPoseMissingPosition.json"'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema in "gpsPointMissingLat.json"'
      );

      warnSpy.mockRestore();
    });
  });

  describe('loadRefPoint', () => {
    it('should load a specific reference point by ID', async () => {
      const pointA: RefPointDefinition = {
        id: 'pointA',
        name: 'Bench Corner',
        createdAt: 1000,
        observations: [],
      };

      refPointsHandle.addFile('pointA.json', JSON.stringify(pointA));

      const result = await loadRefPoint(scenarioHandle, 'pointA');

      expect(result).toEqual(pointA);
    });

    it('should return null if reference point does not exist', async () => {
      const result = await loadRefPoint(scenarioHandle, 'nonexistent');
      expect(result).toBeNull();
    });

    /**
     * Regression test: validates that loadRefPoint rejects files with invalid schema.
     * This tests the isRefPointDefinition type guard for single file loading.
     */
    it('should return null for file that does not match RefPointDefinition schema', async () => {
      // File exists but has invalid schema (missing required fields)
      refPointsHandle.addFile(
        'invalidSchema.json',
        JSON.stringify({
          id: 'invalidSchema',
          // missing: name, createdAt, observations
        })
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadRefPoint(scenarioHandle, 'invalidSchema');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema for "invalidSchema"'
      );

      warnSpy.mockRestore();
    });

    /**
     * Regression test: validates edge case where file contains null JSON.
     */
    it('should return null for file containing null JSON value', async () => {
      refPointsHandle.addFile('nullPoint.json', 'null');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadRefPoint(scenarioHandle, 'nullPoint');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema for "nullPoint"'
      );

      warnSpy.mockRestore();
    });

    /**
     * Regression test: validates type checking for field types.
     */
    it('should return null when field types are wrong', async () => {
      // createdAt should be number, not string
      refPointsHandle.addFile(
        'wrongTypes.json',
        JSON.stringify({
          id: 'wrongTypes',
          name: 'Wrong Types',
          createdAt: '2025-01-01', // should be number
          observations: [],
        })
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadRefPoint(scenarioHandle, 'wrongTypes');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[RefPointLoader]',
        'Invalid schema for "wrongTypes"'
      );

      warnSpy.mockRestore();
    });
  });

  describe('saveRefPointObservation', () => {
    it('should create new reference point file for first observation', async () => {
      const observation: RefPointObservation = {
        sessionId: 'recording-2025-01-02',
        timestamp: 3000,
        arPose: { position: [4, 5, 6], rotation: [0, 0, 0, 1] },
        gpsPoint: mockGpsPoint,
      };

      await saveRefPointObservation(
        scenarioHandle,
        'newPoint',
        'New Point',
        observation
      );

      const saved = await loadRefPoint(scenarioHandle, 'newPoint');
      expect(saved).not.toBeNull();
      expect(saved!.id).toBe('newPoint');
      expect(saved!.name).toBe('New Point');
      expect(saved!.createdAt).toBe(3000); // Should match observation.timestamp
      expect(saved!.observations).toHaveLength(1);
      expect(saved!.observations[0]).toEqual(observation);
    });

    it('should append observation to existing reference point', async () => {
      const existing: RefPointDefinition = {
        id: 'pointA',
        name: 'Point A',
        createdAt: 1000,
        observations: [
          {
            sessionId: 'recording-2025-01-01',
            timestamp: 1000,
            arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
            gpsPoint: mockGpsPoint,
          },
        ],
      };

      refPointsHandle.addFile('pointA.json', JSON.stringify(existing));

      const observation: RefPointObservation = {
        sessionId: 'recording-2025-01-02',
        timestamp: 2000,
        arPose: { position: [4, 5, 6], rotation: [0, 0, 0, 1] },
        gpsPoint: mockGpsPoint,
      };

      await saveRefPointObservation(
        scenarioHandle,
        'pointA',
        'Point A',
        observation
      );

      const updated = await loadRefPoint(scenarioHandle, 'pointA');
      expect(updated!.observations).toHaveLength(2);
      expect(updated!.observations[1]).toEqual(observation);
    });

    it('should create refPoints directory if it does not exist', async () => {
      const scenarioWithoutRefPoints = new MockFSDirectoryHandle(
        'New Scenario'
      );
      const observation: RefPointObservation = {
        sessionId: 'recording-2025-01-01',
        timestamp: 1000,
        arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
        gpsPoint: mockGpsPoint,
      };

      await saveRefPointObservation(
        scenarioWithoutRefPoints,
        'firstPoint',
        'First Point',
        observation
      );

      const saved = await loadRefPoint(scenarioWithoutRefPoints, 'firstPoint');
      expect(saved).not.toBeNull();
    });
  });

  describe('listRefPointIds', () => {
    it('should return sorted list of reference point IDs', async () => {
      refPointsHandle.addFile('pointC.json', '{}');
      refPointsHandle.addFile('pointA.json', '{}');
      refPointsHandle.addFile('pointB.json', '{}');

      const ids = await listRefPointIds(scenarioHandle);

      expect(ids).toEqual(['pointA', 'pointB', 'pointC']);
    });

    it('should return empty array if refPoints directory does not exist', async () => {
      const emptyScenario = new MockFSDirectoryHandle('Empty');
      const ids = await listRefPointIds(emptyScenario);
      expect(ids).toEqual([]);
    });

    it('should ignore non-JSON files', async () => {
      refPointsHandle.addFile('pointA.json', '{}');
      refPointsHandle.addFile('readme.txt', 'some text');

      const ids = await listRefPointIds(scenarioHandle);

      expect(ids).toEqual(['pointA']);
    });
  });

  describe('flattenRefPointsToMarks', () => {
    /**
     * Tests the helper function that flattens RefPointDefinition[] into RefPointMark[].
     * This function was extracted to eliminate code duplication between
     * loadPriorReferencePoints() and handleScenarioChange() in main.ts.
     */
    it('should flatten multiple definitions with multiple observations', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'pointA',
          name: 'Point A',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
              gpsPoint: { ...mockGpsPoint, latitude: 48.1, longitude: 2.1 },
            },
            {
              sessionId: 'session2',
              timestamp: 2000,
              arPose: { position: [4, 5, 6], rotation: [0, 1, 0, 0] },
              gpsPoint: { ...mockGpsPoint, latitude: 48.2, longitude: 2.2 },
            },
          ],
        },
        {
          id: 'pointB',
          name: 'Point B',
          createdAt: 3000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 3000,
              arPose: { position: [7, 8, 9], rotation: [1, 0, 0, 0] },
              gpsPoint: {
                ...mockGpsPoint,
                latitude: 48.3,
                longitude: 2.3,
                altitude: 150,
              },
            },
          ],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);

      expect(marks).toHaveLength(3);
      expect(marks[0]).toEqual({
        id: 'pointA',
        odomPosition: [1, 2, 3],
        odomRotation: [0, 0, 0, 1],
        gpsPosition: { lat: 48.1, lon: 2.1, altitude: 100 },
        timestamp: 1000,
      });
      expect(marks[1]).toEqual({
        id: 'pointA',
        odomPosition: [4, 5, 6],
        odomRotation: [0, 1, 0, 0],
        gpsPosition: { lat: 48.2, lon: 2.2, altitude: 100 },
        timestamp: 2000,
      });
      expect(marks[2]).toEqual({
        id: 'pointB',
        odomPosition: [7, 8, 9],
        odomRotation: [1, 0, 0, 0],
        gpsPosition: { lat: 48.3, lon: 2.3, altitude: 150 },
        timestamp: 3000,
      });
    });

    it('should return empty array for empty input', () => {
      const marks = flattenRefPointsToMarks([]);
      expect(marks).toEqual([]);
    });

    it('should handle definition with no observations', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'emptyPoint',
          name: 'Empty Point',
          createdAt: 1000,
          observations: [],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);
      expect(marks).toEqual([]);
    });

    it('should handle undefined altitude in GPS point', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'noAltitude',
          name: 'No Altitude',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
              gpsPoint: { ...mockGpsPoint, altitude: undefined },
            },
          ],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);

      expect(marks).toHaveLength(1);
      expect(marks[0].gpsPosition?.altitude).toBeUndefined();
    });

    /**
     * REGRESSION TEST: Ensures the distinction between unique reference point
     * count and total observation count is clear.
     *
     * This test documents that:
     * - refPointDefs.length = number of unique reference points
     * - flattenRefPointsToMarks(refPointDefs).length = total observations
     *
     * UI status messages should report both counts to avoid confusion, e.g.:
     *   "3 ref points (7 observations)"
     * NOT just:
     *   "7 prior ref points" (misleading - implies 7 unique points)
     *
     * See main.ts handleScenarioChange() and loadPriorReferencePoints() for usage.
     */
    it('should clarify that output length is observations, not unique ref points', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'pointA',
          name: 'Point A',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [1, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: { ...mockGpsPoint, latitude: 48.1 },
            },
            {
              sessionId: 'session2',
              timestamp: 2000,
              arPose: { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: { ...mockGpsPoint, latitude: 48.2 },
            },
            {
              sessionId: 'session3',
              timestamp: 3000,
              arPose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: { ...mockGpsPoint, latitude: 48.3 },
            },
          ],
        },
        {
          id: 'pointB',
          name: 'Point B',
          createdAt: 4000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 4000,
              arPose: { position: [4, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: { ...mockGpsPoint, latitude: 48.4 },
            },
          ],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);

      // Key invariants for UI status messages:
      const uniqueRefPointCount = refPointDefs.length;
      const totalObservationCount = marks.length;

      expect(uniqueRefPointCount).toBe(2); // 2 unique reference points
      expect(totalObservationCount).toBe(4); // 4 total observations across all points

      // Verify marks retain the original ref point ID (for grouping if needed)
      expect(marks.filter((m) => m.id === 'pointA')).toHaveLength(3);
      expect(marks.filter((m) => m.id === 'pointB')).toHaveLength(1);
    });

    /**
     * Why this test matters: raw GPS is noisy (3–10 m scatter). When the
     * recorder has already computed a sub-metre `fusedGpsPoint` at mark-time
     * (or post-hoc), the visualizer should use that instead of the raw
     * sensor value. This is the visualizer-side half of the "prefer fused"
     * plan in 2026-04-24-refpoint-positioning-investigation.md §7.
     */
    it('prefers fusedGpsPoint over raw gpsPoint when both are present', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'pointA',
          name: 'Point A',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: {
                ...mockGpsPoint,
                latitude: 48.1,
                longitude: 2.1,
                altitude: 100,
              },
              fusedGpsPoint: {
                latitude: 48.1005,
                longitude: 2.1005,
                altitude: 101,
              },
            },
          ],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);
      expect(marks).toHaveLength(1);
      expect(marks[0].gpsPosition).toEqual({
        lat: 48.1005,
        lon: 2.1005,
        altitude: 101,
      });
    });

    /**
     * Why: when no fused value is present (older observations or devices
     * without a converged alignment), the raw GPS is the only source and
     * must still be used — no regression of the existing contract.
     */
    it('falls back to raw gpsPoint when fusedGpsPoint is absent', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'pointA',
          name: 'Point A',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: {
                ...mockGpsPoint,
                latitude: 48.1,
                longitude: 2.1,
                altitude: 100,
              },
              // no fusedGpsPoint
            },
          ],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);
      expect(marks[0].gpsPosition).toEqual({
        lat: 48.1,
        lon: 2.1,
        altitude: 100,
      });
    });

    /**
     * Why: legacy recordings persisted `fusedGpsPoint.altitude = undefined`
     * because of the calcGpsCoords altitude-discard bug (fixed 2026-04-30,
     * see 2026-04-29-ref-points-user-feedback.md Finding 1). To rescue
     * those recordings we per-field fall back to raw altitude when fused
     * altitude is missing. Mixing is acceptable here because fused altitude
     * was *intended* to equal raw altitude — the recorder derives both from
     * the same odom Y. New recordings (post-fix) populate fused altitude
     * themselves, so the fallback only fires for legacy data.
     */
    it('falls back to raw altitude when fused altitude is undefined (Option B legacy rescue)', () => {
      const refPointDefs: RefPointDefinition[] = [
        {
          id: 'pointA',
          name: 'Point A',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: {
                ...mockGpsPoint,
                latitude: 48.1,
                longitude: 2.1,
                altitude: 100,
              },
              fusedGpsPoint: {
                latitude: 48.1005,
                longitude: 2.1005,
                // altitude intentionally omitted (legacy recording)
              },
            },
          ],
        },
      ];

      const marks = flattenRefPointsToMarks(refPointDefs);
      // Fused lat/lon (sub-metre) preserved; altitude rescued from raw.
      expect(marks[0].gpsPosition).toEqual({
        lat: 48.1005,
        lon: 2.1005,
        altitude: 100,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Readonly guards — Finding #6 (2026-03-05 code review)
  // ──────────────────────────────────────────────────────────────────────────

  describe('Readonly guards for pure-data interfaces', () => {
    /**
     * Why this test matters:
     * RefPointObservation is created once per mark event and never mutated.
     * Uses ts-expect-error because the arPose field contains tuple types
     * (Vector3/Quaternion) that break Readonly<T> equality via vitest.
     */
    // eslint-disable-next-line vitest/expect-expect -- type-level only: readonly enforced via @ts-expect-error at compile time
    it('RefPointObservation fields are readonly', () => {
      const obs: RefPointObservation = {
        sessionId: 'test',
        timestamp: 1000,
        arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
        gpsPoint: {
          id: 'g1',
          zeroRef: { lat: 50, lon: 8 },
          latitude: 50,
          longitude: 8,
          altitude: 100,
          coordinates: [0, 0, 0],
          weight: 1,
          timestamp: 1000,
        },
      };
      // @ts-expect-error — sessionId should be readonly
      obs.sessionId = 'changed';
      // @ts-expect-error — timestamp should be readonly
      obs.timestamp = 2000;
      // @ts-expect-error — arPose should be readonly
      obs.arPose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
      // @ts-expect-error — gpsPoint should be readonly
      obs.gpsPoint = { ...obs.gpsPoint };
    });
  });

  // ---------------------------------------------------------------------------
  // averageGpsPerRefPoint
  // ---------------------------------------------------------------------------

  describe('averageGpsPerRefPoint', () => {
    function makeObservation(
      lat: number,
      lon: number,
      alt?: number,
      fusedGps?: { latitude: number; longitude: number; altitude?: number }
    ): RefPointObservation {
      return {
        sessionId: 'session1',
        timestamp: 1000,
        arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        gpsPoint: {
          id: 'g1',
          zeroRef: { lat, lon },
          latitude: lat,
          longitude: lon,
          altitude: alt,
          coordinates: [0, 0, 0],
          weight: 1,
          timestamp: 1000,
        },
        ...(fusedGps ? { fusedGpsPoint: fusedGps } : {}),
      };
    }

    // Why: simplest case — one observation with only raw GPS
    it('should return raw GPS position for single observation without fused data', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'pointA',
          name: 'A',
          createdAt: 1000,
          observations: [makeObservation(50.0, 8.0, 100)],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('pointA');
      expect(result[0].lat).toBeCloseTo(50.0, 6);
      expect(result[0].lon).toBeCloseTo(8.0, 6);
      expect(result[0].alt).toBeCloseTo(100, 6);
    });

    // Why: fused GPS should be preferred over raw GPS when available
    it('should prefer fusedGpsPoint over raw gpsPoint when available', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'pointB',
          name: 'B',
          createdAt: 1000,
          observations: [
            makeObservation(50.0, 8.0, 100, {
              latitude: 50.001,
              longitude: 8.001,
              altitude: 105,
            }),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0].lat).toBeCloseTo(50.001, 6);
      expect(result[0].lon).toBeCloseTo(8.001, 6);
      expect(result[0].alt).toBeCloseTo(105, 6);
    });

    // Why: multiple observations should be averaged (centroid)
    it('should average lat/lon across multiple observations', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'pointC',
          name: 'C',
          createdAt: 1000,
          observations: [
            makeObservation(50.0, 8.0, 100),
            makeObservation(50.002, 8.004, 110),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0].lat).toBeCloseTo(50.001, 6);
      expect(result[0].lon).toBeCloseTo(8.002, 6);
      expect(result[0].alt).toBeCloseTo(105, 6);
    });

    // Why: mixed fused + raw — each observation uses its best-available data
    it('should use best-available GPS per observation when mixing fused and raw', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'pointD',
          name: 'D',
          createdAt: 1000,
          observations: [
            // obs1: has fused → use fused (50.010, 8.010)
            makeObservation(50.0, 8.0, undefined, {
              latitude: 50.01,
              longitude: 8.01,
            }),
            // obs2: no fused → use raw (50.020, 8.020)
            makeObservation(50.02, 8.02),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      // Average of (50.010, 8.010) and (50.020, 8.020)
      expect(result[0].lat).toBeCloseTo(50.015, 6);
      expect(result[0].lon).toBeCloseTo(8.015, 6);
    });

    // Why: ref points with zero observations should be filtered out
    it('should filter out ref points with no observations', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'empty',
          name: 'Empty',
          createdAt: 1000,
          observations: [],
        },
        {
          id: 'valid',
          name: 'Valid',
          createdAt: 1000,
          observations: [makeObservation(50.0, 8.0)],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');
    });

    // Why: altitudes should be averaged only from observations that have them
    it('should average only valid altitudes, ignoring undefined', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'pointE',
          name: 'E',
          createdAt: 1000,
          observations: [
            makeObservation(50.0, 8.0, 100),
            makeObservation(50.0, 8.0, undefined),
            makeObservation(50.0, 8.0, 200),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0].alt).toBeCloseTo(150, 6); // (100+200)/2
    });

    // Why: if no observation has altitude, result should have no/undefined altitude
    it('should return undefined altitude when no observations have one', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'noAlt',
          name: 'NoAlt',
          createdAt: 1000,
          observations: [
            makeObservation(50.0, 8.0, undefined),
            makeObservation(50.001, 8.001, undefined),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0].alt).toBeUndefined();
    });

    // Why: multiple ref point definitions should each produce one averaged result
    it('should return one averaged position per ref point definition', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'p1',
          name: 'P1',
          createdAt: 1000,
          observations: [makeObservation(50.0, 8.0)],
        },
        {
          id: 'p2',
          name: 'P2',
          createdAt: 2000,
          observations: [makeObservation(51.0, 9.0)],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('p1');
      expect(result[1].id).toBe('p2');
    });

    // Why: disproves claim that avgLon uses c.lat — distinct lat/lon values must
    // not be swapped in the output. This test passes on the current code because
    // the alleged bug does not exist.
    it('should not swap lat and lon (disproves alleged lon/lat bug)', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'swap-check',
          name: 'Swap Check',
          createdAt: 1000,
          observations: [
            makeObservation(10.0, 80.0),
            makeObservation(20.0, 90.0),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      // lat average = (10+20)/2 = 15, lon average = (80+90)/2 = 85
      expect(result[0].lat).toBeCloseTo(15.0, 6);
      expect(result[0].lon).toBeCloseTo(85.0, 6);
      // Explicitly verify they are NOT swapped
      expect(result[0].lat).not.toBeCloseTo(85.0, 1);
      expect(result[0].lon).not.toBeCloseTo(15.0, 1);
    });

    // Why: the result should include the human-readable name from the definition
    // so callers don't have to re-map id → name for display purposes.
    it('should include name from the ref point definition', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'bench',
          name: 'Park Bench Corner',
          createdAt: 1000,
          observations: [makeObservation(50.0, 8.0)],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('name', 'Park Bench Corner');
    });

    // Why: if gpsPoint.longitude is not a number, the observation should be
    // skipped even when gpsPoint.latitude is valid — both must be checked.
    it('should skip observation when gpsPoint.longitude is not a number', () => {
      const defs: RefPointDefinition[] = [
        {
          id: 'badLon',
          name: 'Bad Lon',
          createdAt: 1000,
          observations: [
            {
              sessionId: 'session1',
              timestamp: 1000,
              arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              gpsPoint: {
                id: 'g1',
                zeroRef: { lat: 50, lon: 8 },
                latitude: 50.0,
                longitude: undefined as unknown as number,
                altitude: 100,
                coordinates: [0, 0, 0],
                weight: 1,
                timestamp: 1000,
              },
            },
            makeObservation(51.0, 9.0, 200),
          ],
        },
      ];
      const result = averageGpsPerRefPoint(defs);
      expect(result).toHaveLength(1);
      // Only the valid observation should contribute
      expect(result[0].lat).toBeCloseTo(51.0, 6);
      expect(result[0].lon).toBeCloseTo(9.0, 6);
      expect(result[0].alt).toBeCloseTo(200, 6);
    });
  });

  describe('saveRefPointObservation — writable stream safety', () => {
    it('aborts writable stream when write() throws', async () => {
      // Why: If OPFS write() fails (storage full, quota exceeded), the
      // writable stream must be abort()ed to release the file lock.
      // Without abort(), the file remains locked until page reload,
      // making all subsequent writes to it fail with InvalidStateError.
      const mockAbort = vi.fn().mockResolvedValue(undefined);
      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error('QuotaExceededError')),
        close: vi.fn().mockResolvedValue(undefined),
        abort: mockAbort,
      } as unknown as FileSystemWritableFileStream;

      const scenario = new MockFSDirectoryHandle('test-scenario');
      const refDir = new MockFSDirectoryHandle('refPoints');
      scenario.addDirectory('refPoints', refDir);

      // Pre-populate with a file handle whose createWritable returns our mock
      const fileHandle = new MockFSFileHandle('point1.json', 'null');
      // Override createWritable to return the failing writable
      fileHandle.createWritable = () => Promise.resolve(mockWritable);
      refDir.addFile('point1.json', 'null');

      // Override getFileHandle to return our custom file handle
      const origGetFileHandle = refDir.getFileHandle.bind(refDir);
      refDir.getFileHandle = vi.fn(
        async (
          name: string,
          options?: { create?: boolean }
        ): Promise<FileSystemFileHandle> => {
          if (name === 'point1.json') return fileHandle;
          return origGetFileHandle(name, options);
        }
      );

      const observation: RefPointObservation = {
        sessionId: 'session1',
        timestamp: Date.now(),
        arPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        gpsPoint: mockGpsPoint,
      };

      // Should throw (re-throw the write error) but abort() must be called
      await expect(
        saveRefPointObservation(
          scenario as unknown as FileSystemDirectoryHandle,
          'point1',
          'Test Point',
          observation
        )
      ).rejects.toThrow('QuotaExceededError');

      expect(mockAbort).toHaveBeenCalledTimes(1);
    });
  });
});
