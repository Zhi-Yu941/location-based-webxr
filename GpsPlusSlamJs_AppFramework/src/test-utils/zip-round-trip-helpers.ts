/**
 * Round-Trip Test Helpers â€” Produce realistic recording zips programmatically.
 *
 * Why this exists: Tests need recording zip files for the replay pipeline,
 * zip-reader, and state verification. Rather than depending on static
 * pre-recorded zips (which go stale as the app evolves), this helper
 * produces zips using the real OPFS mock + export pipeline, ensuring the
 * test data always matches the current production format.
 *
 * The helper writes actions via writeAction(), writes frames via writeFrame(),
 * writes session metadata via writeSessionMetadata(), and exports via
 * exportSessionAsZip(). OPFS mocks are installed and cleaned up internally
 * â€” no side effects leak to the calling test.
 *
 * DESIGN BOUNDARY â€” VALID ZIPS ONLY
 *
 * This helper intentionally produces only valid, realistic zips. Do NOT add
 * options to generate broken/incomplete zips (missing session.json, malformed
 * JSON, missing actions, etc.). Its value comes from exercising the real
 * production pipeline end-to-end â€” mixing in "intentionally broken" modes
 * would undermine that contract.
 *
 * For error-handling / robustness tests, use hand-crafted zips via ZipWriter
 * directly â€” see createZipWithActions() in zip-reader.test.ts for the
 * established pattern. That approach gives precise byte-level control over
 * exactly what's broken, which is strictly better for negative test cases.
 */

import { installOPFSMocks } from './browser-mocks';
import {
  initOpfsStorage,
  createSession,
  writeAction,
  writeFrame,
  writeSessionMetadata,
  resetOpfsStorage,
  type SessionMetadata,
} from '../storage/opfs-storage';
import { exportSessionAsZip } from '../storage/zip-export';
import { type RecordedAction } from '../storage/zip-reader';
import type { LatLong, Vector3, Quaternion } from 'gps-plus-slam-js';

// Re-export so existing consumers don't break.
export type { RecordedAction } from '../storage/zip-reader';

/** Configuration for producing a test zip. All fields have sensible defaults. */
export interface ProduceTestZipOptions {
  scenarioName: string;
  sessionTimestamp: Date;
  gpsEventCount: number;
  imagesBeforeSetZero: number;
  imagesAfterSetZero: number;
  frameCount: number;
  deviceInfo: string;
  zeroPos: LatLong;
}

/** Result of producing a test zip, with all metadata needed for assertions. */
export interface TestZipResult {
  /** The zip file as a Uint8Array, ready for loadActionsFromZip / readZipEntries */
  zipData: Uint8Array;
  /** Total number of Redux action files in the zip */
  totalActionCount: number;
  /** Number of gpsData/recordGpsEvent actions */
  gpsEventCount: number;
  /** Breakdown of gpsData/add2dImage actions */
  imageActions: {
    totalCount: number;
    beforeSetZero: number;
    afterSetZero: number;
  };
  scenarioName: string;
  sessionName: string;
  startTime: number;
  deviceInfo: string;
  /** Whether session.json is present in the zip */
  hasSessionJson: boolean;
  /** The zero reference position used for GPS events */
  zeroPos: LatLong;
  /** All actions as written, in order, for assertion comparisons */
  actions: RecordedAction[];
  /** Number of frame files in the zip */
  frameCount: number;
}

const DEFAULTS: ProduceTestZipOptions = {
  scenarioName: 'TestScenario',
  sessionTimestamp: new Date('2026-03-01T09:00:00Z'),
  gpsEventCount: 10,
  imagesBeforeSetZero: 2,
  imagesAfterSetZero: 5,
  frameCount: 2,
  deviceInfo: 'TestDevice Android 14',
  zeroPos: { lat: 50.0, lon: 8.0 },
};

/**
 * Produce a realistic recording zip using the real OPFS mock + export pipeline.
 *
 * Action sequence produced (with defaults):
 *   1. recorder/startSession        (index 1)
 *   2. gpsData/add2dImage Ã— 2       (indices 2-3, before setZeroPos â€” dropped on replay)
 *   3. gpsData/setZeroPos            (index 4)
 *   4. gpsData/recordGpsEvent Ã— 10   (indices 5-14)
 *   5. gpsData/add2dImage Ã— 5        (indices 15-19, after setZeroPos â€” kept on replay)
 *
 * GPS events use varied odom/GPS positions that produce a non-identity
 * alignment matrix when replayed through the library store.
 *
 * OPFS mocks are installed and cleaned up within this function.
 */
export async function produceTestZip(
  opts?: Partial<ProduceTestZipOptions>
): Promise<TestZipResult> {
  const options = { ...DEFAULTS, ...opts };
  const { cleanup } = installOPFSMocks();

  try {
    await initOpfsStorage();
    const { sessionName } = await createSession(
      options.sessionTimestamp,
      options.scenarioName
    );

    const allActions: RecordedAction[] = [];
    let actionIndex = 0;

    /** Increment index, persist to OPFS, and record for later assertions. */
    const writeAndRecordAction = async (action: RecordedAction) => {
      actionIndex++;
      await writeAction(action, actionIndex);
      allActions.push(action);
    };

    // --- Action 1: recorder/startSession ---
    const startPayload = {
      scenarioName: options.scenarioName,
      sessionName,
      startTime: options.sessionTimestamp.getTime(),
      deviceInfo: options.deviceInfo,
    };
    await writeAndRecordAction({
      type: 'recording/startSession',
      payload: startPayload,
    });

    // --- add2dImage BEFORE setZeroPos (dropped during replay: state is null) ---
    for (let i = 0; i < options.imagesBeforeSetZero; i++) {
      const payload = {
        imageFile: `frames/frame-${String(actionIndex + 1).padStart(6, '0')}.jpg`,
        position: [i * 0.5, 0, 0] as Vector3,
        rotation: [0, 0, 0, 1] as Quaternion,
        screenRotation: 0,
        capturedAt: options.sessionTimestamp.getTime() + actionIndex * 1000,
      };
      await writeAndRecordAction({ type: 'gpsData/add2dImage', payload });
    }

    // --- gpsData/setZeroPos ---
    await writeAndRecordAction({
      type: 'gpsData/setZeroPos',
      payload: { lat: options.zeroPos.lat, lon: options.zeroPos.lon },
    });

    // --- gpsData/recordGpsEvent Ã— N ---
    // Odom path: expanding arc in XZ plane
    // GPS coordinates: northeast diagonal in XY plane
    // This intentionally differs so the alignment matrix is non-identity.
    for (let i = 0; i < options.gpsEventCount; i++) {
      const t = options.sessionTimestamp.getTime() + (actionIndex + 1) * 1000;
      const angle =
        (i / Math.max(options.gpsEventCount - 1, 1)) * Math.PI * 0.5;
      const radius = (i + 1) * 2.0;
      const odomX = radius * Math.cos(angle);
      const odomZ = radius * Math.sin(angle);
      const gpsPayload = {
        odomPosition: [odomX, 0, odomZ] as Vector3,
        odomRotation: [0, 0, 0, 1] as Quaternion,
        rawGpsPoint: {
          id: `gps-event-${i + 1}`,
          latitude: options.zeroPos.lat + (i + 1) * 0.0001,
          longitude: options.zeroPos.lon + (i + 1) * 0.0001,
          timestamp: t,
        },
      };
      await writeAndRecordAction({
        type: 'gpsData/recordGpsEvent',
        payload: gpsPayload,
      });
    }

    // --- add2dImage AFTER setZeroPos (kept during replay) ---
    const postZeroImageOffset = options.imagesBeforeSetZero;
    for (let i = 0; i < options.imagesAfterSetZero; i++) {
      const imgIdx = postZeroImageOffset + i + 1;
      const payload = {
        imageFile: `frames/frame-${String(imgIdx).padStart(6, '0')}.jpg`,
        position: [(i + 1) * 1.0, (i + 1) * 0.5, 0] as Vector3,
        rotation: [0, 0, 0, 1] as Quaternion,
        screenRotation: i % 4,
        capturedAt: options.sessionTimestamp.getTime() + actionIndex * 1000,
      };
      await writeAndRecordAction({ type: 'gpsData/add2dImage', payload });
    }

    // --- Write frame files ---
    for (let i = 0; i < options.frameCount; i++) {
      const jpegHeader = [0xff, 0xd8, 0xff, 0xe0];
      const body = Array.from({ length: 10 }, (_, j) => (i * 10 + j) & 0xff);
      const frameBytes = new Uint8Array([...jpegHeader, ...body]);
      await writeFrame(new Blob([frameBytes], { type: 'image/jpeg' }), i + 1);
    }

    // --- Write session metadata (session.json) ---
    const metadata: SessionMetadata = {
      version: 1,
      startedAt: options.sessionTimestamp.toISOString(),
      endedAt: new Date(
        options.sessionTimestamp.getTime() + actionIndex * 1000 + 5000
      ).toISOString(),
      contextTag: options.scenarioName,
      actionCount: actionIndex,
      frameCount: options.frameCount,
      userAgent: options.deviceInfo,
    };
    await writeSessionMetadata(metadata);

    // --- Export as zip ---
    const { blob } = await exportSessionAsZip(sessionName);
    const zipData = new Uint8Array(await blob.arrayBuffer());

    return {
      zipData,
      totalActionCount: actionIndex,
      gpsEventCount: options.gpsEventCount,
      imageActions: {
        totalCount: options.imagesBeforeSetZero + options.imagesAfterSetZero,
        beforeSetZero: options.imagesBeforeSetZero,
        afterSetZero: options.imagesAfterSetZero,
      },
      scenarioName: options.scenarioName,
      sessionName,
      startTime: options.sessionTimestamp.getTime(),
      deviceInfo: options.deviceInfo,
      hasSessionJson: true,
      zeroPos: options.zeroPos,
      actions: allActions,
      frameCount: options.frameCount,
    };
  } finally {
    resetOpfsStorage();
    cleanup();
  }
}
