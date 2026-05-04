/**
 * File System Storage Module
 *
 * Facade over the OPFS storage module. Provides session lifecycle, write
 * operations, and backwards-compatible scenario management for the recorder.
 *
 * The core OPFS module (opfs-storage.ts) is scenario-free â€” it manages
 * flat sessions/{timestamp}/ directories. This module bridges the gap by
 * managing scenario directory handles for consumers that still need them
 * (recorder, ref-point loader, etc.) until those are migrated to
 * ScenarioWrappingStorageBackend in later iterations.
 */

import type { LatLongAlt } from 'gps-plus-slam-js';
import type { ArPoseTuples } from '../types/ar-types';
import { createLogger } from '../utils/logger';
import { setFileSystemState } from '../sensors/permission-checker';
import {
  initOpfsStorage,
  createSession as createOpfsSession,
  writeAction as opfsWriteAction,
  writeFrame as opfsWriteFrame,
  writeSessionMetadata as opfsWriteSessionMetadata,
  listSessions as opfsListSessions,
  getAppRootHandle,
  setSessionHandles as opfsSetSessionHandles,
  resetOpfsStorage,
  resetSessionHandles,
  type SessionMetadata,
} from './opfs-storage';
import { formatTimestamp } from './file-system-utils';

const log = createLogger('Storage');

// Track current session info
let _currentScenarioName: string | null = null;
let _currentSessionName: string | null = null;
let storageInitialized = false;

// Legacy scenario directory management (will move to recorder in Iter 3)
let scenariosDir: FileSystemDirectoryHandle | null = null;
let currentScenarioHandle: FileSystemDirectoryHandle | null = null;

/**
 * Reset module state - exported for testing only
 * @internal
 */
export function resetStorageState(): void {
  _currentScenarioName = null;
  _currentSessionName = null;
  storageInitialized = false;
  scenariosDir = null;
  currentScenarioHandle = null;
  resetOpfsStorage();
}

/**
 * Reset session-level state for a new recording.
 *
 * Clears scenario/session names and OPFS session handles, but preserves
 * `storageInitialized` and the OPFS root so `initStorage()` doesn't need
 * to be called again.
 */
export function resetForNewSession(): void {
  _currentScenarioName = null;
  _currentSessionName = null;
  currentScenarioHandle = null;
  resetSessionHandles();
}

/**
 * Result of write access verification.
 */
export interface WriteAccessResult {
  /** Whether write access was successfully verified */
  success: boolean;
  /** Error message if write verification failed */
  error?: string;
}

/**
 * Verify that we have actual write access to a directory.
 */
export async function verifyWriteAccess(
  dirHandle: FileSystemDirectoryHandle
): Promise<WriteAccessResult> {
  const testFilename = `.write-test-${Date.now()}`;

  try {
    const fileHandle = await dirHandle.getFileHandle(testFilename, {
      create: true,
    });

    const writable = await fileHandle.createWritable();
    await writable.write('write-test');
    await writable.close();

    try {
      await dirHandle.removeEntry(testFilename);
    } catch (cleanupErr) {
      log.warn('Write test cleanup failed (non-critical):', cleanupErr);
    }

    log.info('Write access verified for:', dirHandle.name);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Write verification failed:', error);

    if (error.name === 'NoModificationAllowedError') {
      return {
        success: false,
        error:
          'Folder is read-only. Please select a different folder with write access.',
      };
    }

    return {
      success: false,
      error: `Cannot write to folder: ${error.message}`,
    };
  }
}

// ============================================================================
// Scenario directory management (legacy â€” moves to recorder in Iter 3)
// ============================================================================

async function ensureScenariosDir(): Promise<FileSystemDirectoryHandle | null> {
  if (scenariosDir) return scenariosDir;
  const appRoot = getAppRootHandle();
  if (!appRoot) return null;
  scenariosDir = await appRoot.getDirectoryHandle('scenarios', {
    create: true,
  });
  return scenariosDir;
}

/**
 * List all scenario names in OPFS storage.
 * Legacy: scenarios are managed by the recorder, not the framework.
 */
async function listScenarios(): Promise<string[]> {
  const dir = await ensureScenariosDir();
  if (!dir) return [];

  const scenarios: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      scenarios.push(entry.name);
    }
  }
  return scenarios;
}

/**
 * Get the scenarios root directory handle.
 * Legacy: used by ref-point loading. Will move to recorder.
 */
function getScenariosRootHandle(): FileSystemDirectoryHandle | null {
  return scenariosDir;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize storage using OPFS.
 *
 * @returns List of existing scenario folder names
 * @throws Error if OPFS is not supported
 */
export async function initStorage(): Promise<string[]> {
  try {
    await initOpfsStorage();
    storageInitialized = true;

    setFileSystemState({
      folderSelected: true,
      writeVerified: true,
    });

    // Ensure scenarios dir exists and list existing scenarios (legacy compat)
    await ensureScenariosDir();
    const scenarios = await listScenarios();
    log.info('OPFS storage initialized, found scenarios:', scenarios);

    return scenarios;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('OPFS initialization failed:', error);

    setFileSystemState({
      folderSelected: false,
      writeVerified: false,
      writeError: error.message,
    });

    throw error;
  }
}

// ============================================================================
// Session lifecycle
// ============================================================================

/**
 * Create a new session folder.
 *
 * When scenarioName is provided, creates under the scenario directory
 * (legacy scenario layout for the recorder). When omitted, creates under
 * the flat sessions/ directory.
 *
 * @param scenarioName - Optional name of the scenario (omit for flat layout)
 */
export async function startSession(
  scenarioName?: string
): Promise<{ scenarioPath: string; sessionPath: string }> {
  if (!storageInitialized) {
    throw new Error('Storage not initialized. Call initStorage first.');
  }

  if (scenarioName) {
    // Legacy scenario-based path: create under scenarios/{name}/
    const dir = await ensureScenariosDir();
    if (!dir) {
      throw new Error('Failed to access scenarios directory.');
    }
    const scenarioHandle = await dir.getDirectoryHandle(scenarioName, {
      create: true,
    });
    currentScenarioHandle = scenarioHandle;
    const sessionName = `recording-${formatTimestamp(new Date())}`;
    const sessionHandle = await scenarioHandle.getDirectoryHandle(sessionName, {
      create: true,
    });
    const actionsHandle = await sessionHandle.getDirectoryHandle('actions', {
      create: true,
    });
    const framesHandle = await sessionHandle.getDirectoryHandle('frames', {
      create: true,
    });

    // Bridge: set opfs-storage's handles so write operations work
    opfsSetSessionHandles(sessionHandle, actionsHandle, framesHandle);

    _currentScenarioName = scenarioName;
    _currentSessionName = sessionName;

    log.info('Session started:', `${scenarioName}/${sessionName}`);

    return {
      scenarioPath: scenarioName,
      sessionPath: sessionName,
    };
  }

  // Flat path: delegate to opfs-storage
  const result = await createOpfsSession(new Date());

  _currentScenarioName = '';
  _currentSessionName = result.sessionName;

  log.info('Session started:', result.sessionName);

  return {
    scenarioPath: '',
    sessionPath: result.sessionName,
  };
}

/**
 * List all session names.
 * When scenarioName is provided, lists sessions under that scenario.
 * Otherwise lists flat sessions.
 */
export async function listSessions(scenarioName?: string): Promise<string[]> {
  if (scenarioName) {
    const dir = await ensureScenariosDir();
    if (!dir) return [];
    try {
      const scenarioHandle = await dir.getDirectoryHandle(scenarioName);
      const sessions: string[] = [];
      for await (const entry of scenarioHandle.values()) {
        if (entry.kind === 'directory') {
          sessions.push(entry.name);
        }
      }
      return sessions;
    } catch {
      return [];
    }
  }
  return opfsListSessions();
}

// ============================================================================
// Write operations
// ============================================================================

/**
 * Write a Redux action to OPFS as a JSON file.
 */
export async function writeAction(
  action: unknown,
  index: number
): Promise<void> {
  await opfsWriteAction(action, index);
}

/**
 * Write a captured frame image to OPFS.
 */
export async function writeFrame(blob: Blob, index: number): Promise<void> {
  await opfsWriteFrame(blob, index);
}

/**
 * Write session metadata (session.json) to OPFS.
 */
export async function writeSessionMetadata(
  metadata: SessionMetadata
): Promise<void> {
  await opfsWriteSessionMetadata(metadata);
}

// ============================================================================
// Ref-point helpers (legacy â€” moves to recorder in Iter 3)
// ============================================================================

interface ParsedRefPointAction {
  type: string;
  payload: {
    id: string;
    gpsPosition?: LatLongAlt;
    arPose?: ArPoseTuples;
  };
}

/**
 * Type guard for reference point actions.
 * Exported for testing.
 */
export function isRefPointAction(
  action: unknown
): action is ParsedRefPointAction {
  if (typeof action !== 'object' || action === null) {
    return false;
  }
  const obj = action as Record<string, unknown>;
  const payload = obj.payload;
  return (
    obj.type === 'recording/markRefPoint' &&
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload)
  );
}

async function parseSessionRefPoints(
  actionsDir: FileSystemDirectoryHandle,
  sessionName: string
): Promise<RefPointRecord[]> {
  const refPoints: RefPointRecord[] = [];

  for await (const actionEntry of actionsDir.values()) {
    if (actionEntry.kind !== 'file' || !actionEntry.name.endsWith('.json')) {
      continue;
    }

    const fileHandle = await actionsDir.getFileHandle(actionEntry.name);
    const file = await fileHandle.getFile();
    const text = await file.text();

    try {
      const action: unknown = JSON.parse(text);
      if (isRefPointAction(action)) {
        refPoints.push({
          id: action.payload.id,
          sessionName,
          gpsPosition: action.payload.gpsPosition,
          arPose: action.payload.arPose,
        });
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return refPoints;
}

/**
 * Load existing reference points from a scenario (across all sessions).
 * Legacy: uses scenario directory layout.
 */
export async function loadScenarioRefPoints(
  scenarioName: string
): Promise<RefPointRecord[]> {
  const scenRoot = getScenariosRootHandle();
  if (!scenRoot) {
    return [];
  }

  const refPoints: RefPointRecord[] = [];

  try {
    const scenarioHandle = await scenRoot.getDirectoryHandle(scenarioName);

    for await (const sessionEntry of scenarioHandle.values()) {
      if (sessionEntry.kind !== 'directory') {
        continue;
      }

      const sessionHandle = await scenarioHandle.getDirectoryHandle(
        sessionEntry.name
      );

      let actionsDir: FileSystemDirectoryHandle;
      try {
        actionsDir = await sessionHandle.getDirectoryHandle('actions');
      } catch {
        continue;
      }

      const sessionRefPoints = await parseSessionRefPoints(
        actionsDir,
        sessionEntry.name
      );
      refPoints.push(...sessionRefPoints);
    }
  } catch {
    // Scenario doesn't exist yet
  }

  return refPoints;
}

/**
 * Get the current scenario handle (for loading prior sessions).
 * Legacy: uses scenario directory layout.
 */
export function getCurrentScenarioHandle(): FileSystemDirectoryHandle | null {
  if (!_currentScenarioName) return null;
  // The handle is cached during startSession / setCurrentScenario /
  // ensureScenarioDirectory; this accessor is sync for backwards compat.
  return currentScenarioHandle;
}

/**
 * Set the current scenario handle (when user selects a scenario).
 * Legacy: uses scenario directory layout.
 */
export async function setCurrentScenario(
  scenarioName: string
): Promise<FileSystemDirectoryHandle | null> {
  const scenRoot = await ensureScenariosDir();
  if (!scenRoot) {
    return null;
  }

  try {
    const handle = await scenRoot.getDirectoryHandle(scenarioName);
    _currentScenarioName = scenarioName;
    currentScenarioHandle = handle;
    return handle;
  } catch {
    log.warn('Scenario not found:', scenarioName);
    return null;
  }
}

/**
 * Ensure a scenario directory exists in OPFS, creating it if necessary.
 * Legacy: used during OPFS recovery.
 */
export async function ensureScenarioDirectory(
  scenarioName: string
): Promise<FileSystemDirectoryHandle | null> {
  const scenRoot = await ensureScenariosDir();
  if (!scenRoot) {
    return null;
  }

  try {
    const handle = await scenRoot.getDirectoryHandle(scenarioName, {
      create: true,
    });
    _currentScenarioName = scenarioName;
    currentScenarioHandle = handle;
    return handle;
  } catch (err) {
    log.error('Failed to create scenario directory:', err);
    return null;
  }
}

/**
 * Reference point record from prior sessions.
 */
export interface RefPointRecord {
  id: string;
  sessionName: string;
  gpsPosition?: LatLongAlt;
  arPose?: ArPoseTuples;
}
