/**
 * Recording Replay Integration Test
 *
 * Tests the full produce→consume round-trip: actions are written through
 * the OPFS pipeline, exported as a zip, then loaded and replayed into
 * Redux stores. Validates that every action, frame, and metadata field
 * survives the round-trip intact.
 *
 * Why this test matters: It validates the full pipeline end-to-end,
 * ensuring that recordings made by the RecorderApp can be deterministically
 * replayed and produce valid state. By producing its own test data via
 * the round-trip helper, it always tests the current production format.
 *
 * Optimisation: zip data, entries, and actions are loaded once in
 * beforeAll and shared across all tests to avoid redundant I/O and parsing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  readZipEntries,
  loadActionsFromZip,
  loadSessionMetadata,
  type Entry,
  type ZipActionEntry,
  type RecordedAction,
} from 'gps-plus-slam-app-framework/storage/zip-reader';
import { replayRecording } from 'gps-plus-slam-app-framework/state/recording-replayer';
import type { CombinedRootState as FrameworkReplayState } from 'gps-plus-slam-app-framework/state/combined-root-state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { createRecorderStore, type CombinedRootState } from './recorder-store';
import {
  createGpsSlamStore,
  isIdentityMatrix4,
  type LibraryRootState,
} from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';
import {
  produceTestZip,
  type TestZipResult,
} from 'gps-plus-slam-app-framework/test-utils/zip-round-trip-helpers';

// --- Shared test data (loaded once in beforeAll) ---

let testZip: TestZipResult;
let zipData: Uint8Array;
let zipEntries: Entry[];
let actionEntries: ZipActionEntry[];
let actions: RecordedAction[];
/** Library store state after replaying only gpsData/* actions */
let libraryState: LibraryRootState;
/** Full recorder store state after replaying all actions */
let recorderState: CombinedRootState;
/** State produced by the replayRecording() convenience function (framework shape, no recorder-only slices) */
let replayedState: FrameworkReplayState;

describe('Recording Replay Integration', () => {
  beforeAll(async () => {
    testZip = await produceTestZip();
    zipData = testZip.zipData;
    zipEntries = await readZipEntries(zipData);
    actionEntries = await loadActionsFromZip(zipData);
    actions = actionEntries.map((e) => e.action);

    // Replay into library store (gpsData actions only)
    const libStore = createGpsSlamStore({ licenseKey: COMMUNITY_LICENSE_KEY });
    const gpsActions = actions.filter((a) => a.type.startsWith('gpsData/'));
    for (const a of gpsActions) {
      libStore.dispatch(a);
    }
    libraryState = libStore.getState();

    // Replay into recorder store (all actions)
    const recStore = createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
    for (const a of actions) {
      recStore.dispatch(a);
    }
    recorderState = recStore.getState();

    // Replay via the convenience function
    replayedState = await replayRecording(zipData);
  });

  // --- Round-trip smoke tests ---
  describe('round-trip zip verification', () => {
    it('produced zip is non-empty', () => {
      // Why: basic smoke test that the round-trip helper produced valid data
      expect(zipData.length).toBeGreaterThan(0);
    });

    it('can open zip and list entries', () => {
      // Why: verifies the zip is structurally valid
      expect(zipEntries.length).toBeGreaterThan(0);
    });

    it('contains an actions directory with JSON files', () => {
      // Why: the replay pipeline depends on finding actions/ entries
      const actionFiles = zipEntries.filter(
        (e) =>
          !e.directory &&
          e.filename.includes('actions/') &&
          e.filename.endsWith('.json')
      );
      expect(actionFiles.length).toBe(testZip.totalActionCount);
    });

    it('session.json is present in the produced zip', async () => {
      // Why: the round-trip helper writes session metadata (post-F2-fix behavior);
      // this validates that the produce→consume path includes session.json.
      // The framework's SessionMetadata now carries the recorder's scenario name
      // in the opaque `contextTag` field.
      const metadata = await loadSessionMetadata(zipData);
      expect(metadata).not.toBeNull();
      expect(metadata!.contextTag).toBe(testZip.scenarioName);
    });
  });

  // --- Action parsing ---
  describe('action parsing', () => {
    it('parses all action JSON files', () => {
      // Why: validates that loadActionsFromZip recovers every action we wrote
      expect(actionEntries.length).toBe(testZip.totalActionCount);
    });

    it('all actions have a type field', () => {
      // Why: Redux actions must have a type; this catches format regressions
      for (const entry of actionEntries) {
        expect(entry.action.type).toBeDefined();
        expect(typeof entry.action.type).toBe('string');
      }
    });
  });

  // --- Replay into stores ---
  describe('action replay into stores', () => {
    it('replays gpsData actions into library store without errors', () => {
      // Why: the library store must accept all GPS actions without throwing
      expect(libraryState.gpsData).not.toBeNull();
    });

    it('replays all actions into recorder store without errors', () => {
      // Why: the recorder store must handle all action types
      expect(recorderState.gpsData).not.toBeNull();
      expect(recorderState.recording).toBeDefined();
    });

    it('replayRecording() produces equivalent state', () => {
      // Why: the convenience function should produce the same result
      // as manual store creation + dispatch
      expect(replayedState.gpsData).not.toBeNull();
      expect(replayedState.recording.sessionMetadata).toEqual(
        recorderState.recording.sessionMetadata
      );
      expect(replayedState.gpsData!.gpsEvents.gpsPositions.length).toBe(
        recorderState.gpsData!.gpsEvents.gpsPositions.length
      );
    });
  });

  // --- State verification after full replay ---
  describe('state verification after full replay', () => {
    it('library store has correct GPS event count after replay', () => {
      // Why: GPS event count in state should match the number of
      // recordGpsEvent actions we wrote
      expect(libraryState.gpsData!.gpsEvents.gpsPositions.length).toBe(
        testZip.gpsEventCount
      );
      expect(libraryState.gpsData!.gpsEvents.odometryPositions.length).toBe(
        testZip.gpsEventCount
      );
    });

    it('GPS and odometry arrays are parallel (same length)', () => {
      // Why: every GPS observation produces exactly one odometry entry
      expect(libraryState.gpsData!.gpsEvents.gpsPositions.length).toBe(
        libraryState.gpsData!.gpsEvents.odometryPositions.length
      );
    });

    it('zero reference matches the setZeroPos action', () => {
      // Why: the zero position anchors all GPS-to-local transformations
      expect(libraryState.gpsData!.zero.lat).toBeCloseTo(
        testZip.zeroPos.lat,
        6
      );
      expect(libraryState.gpsData!.zero.lon).toBeCloseTo(
        testZip.zeroPos.lon,
        6
      );
    });

    it('alignment matrix is computed (not identity) after replay', () => {
      // Why: with varied GPS and odometry positions tracing different paths,
      // the alignment should be a non-trivial rotation/translation
      const matrix = libraryState.gpsData!.gpsEvents.alignmentMatrix;
      expect(isIdentityMatrix4(matrix)).toBe(false);
    });

    it('all GPS positions have valid coordinates', () => {
      // Why: all GPS positions should have finite lat/lon/weight
      const gpsPositions = libraryState.gpsData!.gpsEvents.gpsPositions;

      for (const gp of gpsPositions) {
        expect(Number.isFinite(gp.latitude)).toBe(true);
        expect(Number.isFinite(gp.longitude)).toBe(true);
        expect(Number.isFinite(gp.weight)).toBe(true);
        expect(gp.weight).toBeGreaterThan(0);
      }
    });

    it('add2dImage actions before setZeroPos are silently dropped', () => {
      // Why: add2dImage dispatched before setZeroPos initializes state
      // should be no-ops — the reducer skips them (state is null)
      const gpsActions = actions.filter((a) => a.type.startsWith('gpsData/'));
      const setZeroIdx = gpsActions.findIndex(
        (a) => a.type === 'gpsData/setZeroPos'
      );

      expect(setZeroIdx).toBeGreaterThanOrEqual(0);

      const beforeSetZero = gpsActions
        .slice(0, setZeroIdx)
        .filter((a) => a.type === 'gpsData/add2dImage');
      const afterSetZero = gpsActions
        .slice(setZeroIdx)
        .filter((a) => a.type === 'gpsData/add2dImage');

      expect(beforeSetZero.length).toBe(testZip.imageActions.beforeSetZero);
      expect(afterSetZero.length).toBe(testZip.imageActions.afterSetZero);
      expect(beforeSetZero.length + afterSetZero.length).toBe(
        testZip.imageActions.totalCount
      );
    });

    it('image captures are stored in odometryPath.points', () => {
      // Why: only add2dImage actions after setZeroPos should produce points
      const expectedPoints = testZip.imageActions.afterSetZero;

      const points = libraryState.gpsData!.odometryPath.points;
      expect(points.length).toBe(expectedPoints);

      for (const pt of points) {
        expect(pt.imageFile).toBeDefined();
        expect(pt.position).toBeDefined();
        expect(pt.rotation).toBeDefined();
        expect(typeof pt.screenRotation).toBe('number');
      }
    });

    it('image capture metadata is preserved from actions (frames may be absent)', () => {
      // Why: position data must survive the round-trip serialization intact
      const points = libraryState.gpsData!.odometryPath.points;

      for (const pt of points) {
        const [x, y, z] = pt.position;
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(Number.isFinite(z)).toBe(true);
      }

      const withFramePath = points.filter((pt) =>
        pt.imageFile.startsWith('images/')
      ); // renamed from frames/ (Q5)
      expect(withFramePath.length).toBe(points.length);
    });

    it('recorder store tracks session metadata', () => {
      // Why: startSession action payload must be correctly stored in recorder state
      expect(recorderState.recording.sessionMetadata).not.toBeNull();
      // The helper emits a pre-rename `scenarioName` startSession action; the
      // reducer maps it onto `contextTag` (backward-compat).
      expect(recorderState.recording.sessionMetadata!.contextTag).toBe(
        testZip.scenarioName
      );
      expect(recorderState.recording.sessionMetadata!.sessionName).toBe(
        testZip.sessionName
      );
      expect(recorderState.recording.sessionMetadata!.startTime).toBe(
        testZip.startTime
      );
      expect(recorderState.recording.sessionMetadata!.deviceInfo).toContain(
        'Android'
      );
    });

    it('action sequence is chronologically ordered', () => {
      // Why: startSession must come first, setZeroPos before GPS events
      expect(actions[0].type).toBe('recording/startSession');

      const setZeroIdx = actions.findIndex(
        (a) => a.type === 'gpsData/setZeroPos'
      );
      const firstGpsIdx = actions.findIndex(
        (a) => a.type === 'gpsData/recordGpsEvent'
      );
      expect(setZeroIdx).toBeLessThan(firstGpsIdx);
    });
  });
});
