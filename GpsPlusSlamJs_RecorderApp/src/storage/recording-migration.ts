/**
 * Recording Migration
 *
 * Migrates recorded Redux actions from older coordinate conventions to the
 * current "raw-storage" convention (odomCoordVersion: 5).
 *
 * Five recording eras:
 *
 * Era 1 (pre-2026-03-15, no odomCoordVersion):
 *   - Positions: raw WebXR [x, y, z] â€” already correct, no migration needed
 *   - GPS payload: `gpsPoint` with derived fields + old ENU coordinates
 *     â†’ rename to `rawGpsPoint`, strip derived fields
 *
 * Era 2 (2026-03-15 â†’ 2026-04, odomCoordVersion: 2):
 *   - Positions: NUE [-z, y, x] (converted at dispatch) â€” reverse to raw WebXR
 *   - GPS payload: `gpsPoint` with derived fields
 *     â†’ rename to `rawGpsPoint`, strip derived fields
 *
 * Era 3 (2026-04, odomCoordVersion: 3):
 *   - Positions: raw WebXR [x, y, z] â€” already correct, no migration needed
 *   - GPS payload: `gpsPoint` with derived fields
 *     â†’ rename to `rawGpsPoint`, strip derived fields
 *
 * Era 4 (2026-04, odomCoordVersion: 4):
 *   - Positions: raw WebXR [x, y, z] â€” no migration needed
 *   - GPS payload: `rawGpsPoint` (raw sensor fields only) â€” no migration needed
 *
 * Era 5 (current, odomCoordVersion: 5):
 *   - Same action format as era 4 (raw WebXR positions + rawGpsPoint)
 *   - State-side change only: reducer now also applies webxrQuaternionToNUE()
 *     to all quaternion fields. No migration needed â€” all eras store raw WebXR
 *     rotations in action payloads.
 *
 * The reducer applies webxrToNUE() to raw WebXR positions and
 * webxrQuaternionToNUE() to raw WebXR rotations from all eras.
 * Era-2 positions are reversed first so the same reducer logic produces correct
 * NUE state.
 *
 * Related docs: docs/2026-04-09-raw-storage-convert-on-read.md
 */

import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';

/** The current odom coordinate convention version written into new session.json files. */
export const ODOM_COORD_VERSION = 5 as const;

/** Returns true when `v` is an Array with at least 3 numeric elements. */
function isVec3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 3 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    typeof v[2] === 'number'
  );
}

/** NUE [n, u, e] â†’ raw WebXR [e, u, -n] = [v[2], v[1], -v[0]]. */
function nueToWebxr(v: [number, number, number]): [number, number, number] {
  return [v[2], v[1], -v[0]];
}

/**
 * Migrate recorded actions to the current raw-WebXR convention if needed.
 *
 * Returns the original array unchanged (same reference) when no migration is
 * required (odomCoordVersion >= 3).  Returns a new array with migrated actions
 * when migration is needed â€” the original array is never mutated.
 *
 * @param actions - Recorded Redux actions from the zip file
 * @param metadata - Parsed session.json, or null if absent
 * @returns Actions ready for replay in the current raw-WebXR convention
 */
export function migrateActionsIfNeeded(
  actions: RecordedAction[],
  metadata: Record<string, unknown> | null
): RecordedAction[] {
  const version = metadata
    ? (metadata['odomCoordVersion'] as number | undefined)
    : undefined;

  if (version !== undefined && version >= 4) {
    // Era 4+: raw WebXR positions, rawGpsPoint payloads â€” no migration needed.
    // Era 5 is a state-side-only change (rotation convention in reducer), so
    // eras 4 and 5 have identical action formats and require no migration.
    return actions;
  }

  if (version === 3) {
    // Era 3: positions are raw WebXR (correct).
    // GPS payloads use old `gpsPoint` field with derived fields â€” rename + strip.
    return actions.map((action) => migrateGpsPointField(action));
  }

  if (version === 2) {
    // Era 2: positions were converted to NUE at dispatch time.
    // Reverse them to raw WebXR so the reducer can apply webxrToNUE().
    // GPS payloads also need gpsPointâ†’rawGpsPoint rename + strip.
    return actions.map((action) => migrateGpsPointField(reverseEra2(action)));
  }

  // Era 1 (no version or version < 2): positions are raw WebXR (correct).
  // GPS payloads use old `gpsPoint` with ENU coordinates â€” rename + strip
  // (coordinates are stripped so no ENUâ†’NUE swap needed).
  return actions.map((action) => migrateGpsPointField(action));
}

// ---------------------------------------------------------------------------
// GPS payload migration: gpsPoint â†’ rawGpsPoint (strip derived fields)
// Applied to eras 1, 2, and 3 actions.
// ---------------------------------------------------------------------------

/** Derived fields that exist on GpsPoint but not on RawGpsPoint. */
const DERIVED_GPS_FIELDS = [
  'coordinates',
  'weight',
  'zeroRef',
  'deviceRotation',
];

/**
 * Strip derived fields from a gpsPoint object, leaving only raw sensor fields.
 */
function stripDerivedFields(
  gpsPoint: Record<string, unknown>
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(gpsPoint)) {
    if (!DERIVED_GPS_FIELDS.includes(key)) {
      raw[key] = value;
    }
  }
  return raw;
}

/**
 * Migrate `gpsPoint` â†’ `rawGpsPoint` in recordGpsEvent and markReferencePoint
 * payloads. Strips derived fields (coordinates, weight, zeroRef, deviceRotation).
 */
function migrateGpsPointField(action: RecordedAction): RecordedAction {
  if (
    action.type === 'gpsData/recordGpsEvent' ||
    action.type === 'gpsData/markReferencePoint'
  ) {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const gpsPoint = payload['gpsPoint'] as Record<string, unknown> | undefined;
    if (!gpsPoint || typeof gpsPoint !== 'object') return action;

    const { gpsPoint: _, ...restPayload } = payload;
    return {
      ...action,
      payload: {
        ...restPayload,
        rawGpsPoint: stripDerivedFields(gpsPoint),
      },
    };
  }

  return action;
}

// ---------------------------------------------------------------------------
// Era 2 migration: reverse NUE positions â†’ raw WebXR
// ---------------------------------------------------------------------------

function reverseEra2(action: RecordedAction): RecordedAction {
  if (action.type === 'gpsData/recordGpsEvent') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const odomPosition = payload['odomPosition'];
    if (!isVec3(odomPosition)) return action;

    return {
      ...action,
      payload: {
        ...payload,
        odomPosition: nueToWebxr(odomPosition),
      },
    };
  }

  if (action.type === 'gpsData/markReferencePoint') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const position = payload['position'];
    if (!isVec3(position)) return action;

    return {
      ...action,
      payload: {
        ...payload,
        position: nueToWebxr(position),
      },
    };
  }

  if (action.type === 'gpsData/add2dImage') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const position = payload['position'];
    if (!isVec3(position)) return action;

    return {
      ...action,
      payload: {
        ...payload,
        position: nueToWebxr(position),
      },
    };
  }

  if (action.type === 'gpsData/odometryTrackingRestarted') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const lastValidOdomPos = payload['lastValidOdomPos'];
    if (!isVec3(lastValidOdomPos)) return action;

    const migrated: Record<string, unknown> = {
      ...payload,
      lastValidOdomPos: nueToWebxr(lastValidOdomPos),
    };

    const newOdomPos = payload['newOdomPos'];
    if (isVec3(newOdomPos)) {
      migrated['newOdomPos'] = nueToWebxr(newOdomPos);
    }

    return { ...action, payload: migrated };
  }

  if (action.type === 'recording/recordDepthSample') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const cameraPos = payload['cameraPos'];
    if (!isVec3(cameraPos)) return action;

    return {
      ...action,
      payload: {
        ...payload,
        cameraPos: nueToWebxr(cameraPos),
      },
    };
  }

  if (action.type === 'gpsData/arLoopClosureDetected') {
    const payload = action.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') return action;

    const lastPos = payload['lastPos'];
    const newPos = payload['newPos'];
    if (!isVec3(lastPos) || !isVec3(newPos)) return action;

    return {
      ...action,
      payload: {
        ...payload,
        lastPos: nueToWebxr(lastPos),
        newPos: nueToWebxr(newPos),
      },
    };
  }

  return action;
}
