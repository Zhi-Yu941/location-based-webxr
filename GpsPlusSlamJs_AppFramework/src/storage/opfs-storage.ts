/**
 * OPFS Storage Module
 *
 * Uses the Origin Private File System (OPFS) API to persist recording data.
 * OPFS works consistently on Desktop Chrome, Android Chrome, and iOS Safari,
 * unlike showDirectoryPicker which has write restrictions on Android.
 *
 * Directory structure (flat sessions — no scenario hierarchy):
 * /gps-plus-slam/
 *   └── sessions/
 *       ├── recording-YYYY-MM-DD_HH-MM-SSutc/
 *       │   ├── session.json
 *       │   ├── actions/
 *       │   │   ├── 000001.json
 *       │   │   └── ...
 *       │   └── frames/
 *       │       ├── frame-000001.jpg
 *       │       └── ...
 *       └── ...
 *
 * Scenario grouping (scenarios/{name}/recording-…) is a recorder-only concern,
 * handled by ScenarioWrappingStorageBackend in the recorder app.
 */

import { createLogger } from '../utils/logger';
import {
  formatTimestamp,
  formatActionFilename,
  formatFrameFilename,
} from './file-system-utils';

const log = createLogger('OPFS');

// ============================================================================
// Types
// ============================================================================

/**
 * Session metadata stored in session.json.
 */
export interface SessionMetadata {
  /** Schema version for forward compatibility */
  version: 1;
  /**
   * Odometry coordinate convention version.
   * - Absent (era 1, old recordings): odomPosition in raw WebXR frame [xrX, xrY, xrZ],
   *   GPS payload uses `gpsPoint` with ENU coordinates and derived fields.
   * - 2 (era 2): odomPosition in NUE frame [-xrZ, xrY, xrX],
   *   GPS payload uses `gpsPoint` with NUE coordinates and derived fields.
   * - 3 (era 3): odomPosition in raw WebXR [xrX, xrY, xrZ],
   *   GPS payload uses `gpsPoint` with NUE coordinates and derived fields.
   * - 4 (era 4): odomPosition in raw WebXR [xrX, xrY, xrZ],
   *   GPS payload uses `rawGpsPoint` (raw sensor fields only, no derived fields).
   * - 5 (era 5, current): Same action format as era 4. State-side change only:
   *   reducer now also converts quaternion rotations from WebXR to NUE.
   * Used during replay to determine whether migration is needed.
   */
  odomCoordVersion?: 2 | 3 | 4 | 5;
  /** ISO 8601 timestamp when recording started */
  startedAt: string;
  /** ISO 8601 timestamp when recording ended */
  endedAt: string;
  /**
   * Opaque tag the framework does not interpret. Consumers (e.g. the recorder)
   * use it to carry application-specific grouping info such as a scenario name.
   * Replaces the former required `scenarioName` field.
   */
  contextTag?: string;
  /** Total number of actions recorded */
  actionCount: number;
  /** Total number of frames captured */
  frameCount: number;
  /** Browser user agent string */
  userAgent: string;

  /** Build/environment info for debugging. Optional for backwards compat. */
  build?: {
    /** Git commit hash (short, e.g. "a1b2c3d"), or "dev" during local dev without git */
    commitHash: string;
    /** App version from package.json (e.g. "0.1.0") */
    appVersion: string;
    /** Library version from gps-plus-slam-js package.json */
    libraryVersion: string;
    /** Framework version from gps-plus-slam-app-framework package.json */
    frameworkVersion: string;
    /** ISO 8601 timestamp of when this build was produced */
    buildTime: string;
  };

  /** The page URL the recording was made from (origin + pathname only). Optional for backwards compat. */
  pageUrl?: string;
}

/**
 * Result from createSession.
 */
export interface CreateSessionResult {
  sessionName: string;
}

// ============================================================================
// Module State
// ============================================================================

let opfsRoot: FileSystemDirectoryHandle | null = null;
let gpsPlusSlamDir: FileSystemDirectoryHandle | null = null;
let sessionsDir: FileSystemDirectoryHandle | null = null;
let currentSessionHandle: FileSystemDirectoryHandle | null = null;
let actionsHandle: FileSystemDirectoryHandle | null = null;
let framesHandle: FileSystemDirectoryHandle | null = null;

/**
 * Reset module state - exported for testing only.
 * @internal
 */
export function resetOpfsStorage(): void {
  opfsRoot = null;
  gpsPlusSlamDir = null;
  sessionsDir = null;
  currentSessionHandle = null;
  actionsHandle = null;
  framesHandle = null;
}

/**
 * Reset session-level handles only.
 *
 * Preserves opfsRoot/gpsPlusSlamDir/sessionsDir (OPFS stays initialized)
 * but clears current session/actions/frames handles so a new session can
 * be started fresh.
 */
export function resetSessionHandles(): void {
  currentSessionHandle = null;
  actionsHandle = null;
  framesHandle = null;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize OPFS storage by creating the required directory structure.
 *
 * Creates:
 * - /gps-plus-slam/
 * - /gps-plus-slam/sessions/
 *
 * This is idempotent - calling multiple times is safe.
 *
 * @throws Error if OPFS is not supported
 */
export async function initOpfsStorage(): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error(
      'OPFS (Origin Private File System) is not supported in this browser. ' +
        'Please use Chrome 86+, Safari 15.2+, or Firefox 111+.'
    );
  }

  opfsRoot = await navigator.storage.getDirectory();
  log.info('OPFS root obtained');

  gpsPlusSlamDir = await opfsRoot.getDirectoryHandle('gps-plus-slam', {
    create: true,
  });
  sessionsDir = await gpsPlusSlamDir.getDirectoryHandle('sessions', {
    create: true,
  });

  log.info('OPFS storage initialized');
}

/**
 * Get the sessions root directory handle.
 * Used by consumers that need direct OPFS access (e.g. ZIP export).
 */
export function getSessionsRootHandle(): FileSystemDirectoryHandle | null {
  return sessionsDir;
}

/**
 * Get the app root directory handle (gps-plus-slam/).
 * Used by consumers that need to create additional directories alongside sessions/.
 */
export function getAppRootHandle(): FileSystemDirectoryHandle | null {
  return gpsPlusSlamDir;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new recording session.
 *
 * Creates the directory structure:
 * - /gps-plus-slam/sessions/recording-{timestamp}/
 * - /gps-plus-slam/sessions/recording-{timestamp}/actions/
 * - /gps-plus-slam/sessions/recording-{timestamp}/frames/
 *
 * @param timestamp - Session start time (used for folder naming)
 * @param _contextTag - Opaque tag; not used by the flat layout but accepted
 *   for interface compatibility with wrapping backends
 * @returns Session information
 * @throws Error if storage not initialized
 */
export async function createSession(
  timestamp: Date,
  _contextTag?: string
): Promise<CreateSessionResult> {
  if (!sessionsDir) {
    throw new Error(
      'OPFS storage not initialized. Call initOpfsStorage first.'
    );
  }

  const sessionName = `recording-${formatTimestamp(timestamp)}`;
  currentSessionHandle = await sessionsDir.getDirectoryHandle(sessionName, {
    create: true,
  });

  actionsHandle = await currentSessionHandle.getDirectoryHandle('actions', {
    create: true,
  });
  framesHandle = await currentSessionHandle.getDirectoryHandle('frames', {
    create: true,
  });

  log.info('Session created:', sessionName);

  return { sessionName };
}

/**
 * Get the current session directory handle.
 * @internal
 */
export function getSessionHandle(): FileSystemDirectoryHandle | null {
  return currentSessionHandle;
}

/**
 * Set the active session handles externally.
 *
 * Used by file-system.ts's scenario-based path to reuse opfs-storage's
 * write infrastructure for sessions created outside the flat layout.
 * This is a temporary bridge until the recorder migrates to
 * ScenarioWrappingStorageBackend.
 *
 * @internal
 */
export function setSessionHandles(
  session: FileSystemDirectoryHandle,
  actions: FileSystemDirectoryHandle,
  frames: FileSystemDirectoryHandle
): void {
  currentSessionHandle = session;
  actionsHandle = actions;
  framesHandle = frames;
}

// ============================================================================
// Writing Data
// ============================================================================

/**
 * Safely write data to a file handle with proper cleanup.
 *
 * Uses try/finally to ensure the writable stream is always cleaned up,
 * calling abort() on errors to prevent resource leaks and file locks.
 */
async function safeWriteToFile(
  fileHandle: FileSystemFileHandle,
  data: string | Blob
): Promise<void> {
  const writable = await fileHandle.createWritable();
  let writeError: unknown = null;
  try {
    await writable.write(data);
    await writable.close();
  } catch (error: unknown) {
    writeError = error;
  } finally {
    if (writeError !== null) {
      try {
        await writable.abort();
      } catch {
        // Intentionally ignored: abort failure should not overwrite writeError
      }
    }
  }
  if (writeError !== null) {
    if (writeError instanceof Error) {
      throw writeError;
    }
    const message =
      typeof writeError === 'string' ? writeError : 'File write failed';
    throw new Error(message);
  }
}

/**
 * Write a Redux action to the current session's actions directory.
 *
 * @param action - The action object to write
 * @param index - Sequential action index (1-based)
 * @throws Error if no active session
 */
export async function writeAction(
  action: unknown,
  index: number
): Promise<void> {
  if (!actionsHandle) {
    throw new Error('No active session. Call createSession first.');
  }

  const filename = formatActionFilename(index);
  const fileHandle = await actionsHandle.getFileHandle(filename, {
    create: true,
  });

  const json = JSON.stringify(action, null, 2);
  await safeWriteToFile(fileHandle, json);
}

/**
 * Write a frame blob to the current session's frames directory.
 *
 * @param blob - Image blob to write
 * @param index - Sequential frame index (1-based)
 * @throws Error if no active session
 */
export async function writeFrame(blob: Blob, index: number): Promise<void> {
  if (!framesHandle) {
    throw new Error('No active session. Call createSession first.');
  }

  const filename = formatFrameFilename(index);
  const fileHandle = await framesHandle.getFileHandle(filename, {
    create: true,
  });

  await safeWriteToFile(fileHandle, blob);
}

/**
 * Write session metadata to session.json in the current session directory.
 *
 * @param metadata - Session metadata object
 * @throws Error if no active session
 */
export async function writeSessionMetadata(
  metadata: SessionMetadata
): Promise<void> {
  if (!currentSessionHandle) {
    throw new Error('No active session. Call createSession first.');
  }

  const fileHandle = await currentSessionHandle.getFileHandle('session.json', {
    create: true,
  });

  const json = JSON.stringify(metadata, null, 2);
  await safeWriteToFile(fileHandle, json);

  log.info('Session metadata written');
}

// ============================================================================
// Listing
// ============================================================================

/**
 * List all session names in OPFS storage.
 *
 * @returns Array of session folder names
 */
export async function listSessions(): Promise<string[]> {
  if (!sessionsDir) {
    return [];
  }

  const sessions: string[] = [];
  for await (const entry of sessionsDir.values()) {
    if (entry.kind === 'directory') {
      sessions.push(entry.name);
    }
  }

  return sessions;
}

/**
 * Check storage quota.
 *
 * @returns Available and used storage in bytes
 */
export async function checkStorageQuota(): Promise<{
  available: number;
  used: number;
}> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    log.warn('Storage Manager API not available, returning zero quota');
    return { available: 0, used: 0 };
  }

  const estimate = await navigator.storage.estimate();
  return {
    available: estimate.quota ?? 0,
    used: estimate.usage ?? 0,
  };
}
