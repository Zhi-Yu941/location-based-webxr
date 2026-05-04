/**
 * Folder Manager
 *
 * Encapsulates folder/save-location selection, scenario management, and
 * OPFS scenario caching, extracted from main.ts (Finding #7 — main.ts
 * decomposition, Step 4).
 *
 * The factory pattern allows main.ts to inject dependencies that change
 * over the app lifecycle (replay mode state, ref point handlers, etc.).
 *
 * All other dependencies (external-file-storage, session-browser, UI) are
 * imported directly — the same modules they were imported from in main.ts.
 */

import {
  isExternalStorageSupported,
  selectReadFolder,
  selectSaveFile,
  getReadFolderHandle,
} from './external-file-storage';
import type { ImportedRefPoint } from '../storage/ref-point-importer';
import {
  setCurrentScenario,
  ensureScenarioDirectory,
} from 'gps-plus-slam-app-framework/storage/file-system';
import {
  loadAllRefPoints,
  flattenRefPointsToMarks,
  averageGpsPerRefPoint,
  writeRefPointDefinition,
  type RefPointDefinition,
} from '../storage/ref-point-loader';
import { recoverRefPointDefinitionsFromZips } from '../storage/ref-point-recovery';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  setCurrentScenarioName,
  setPriorRefPointMarks,
} from '../state/recorder-store';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('FolderManager');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structural equivalent of SessionEntry from ui/session-browser (avoids cross-layer import). */
interface SessionEntryLike {
  filename: string;
  fileHandle: FileSystemFileHandle;
  date: Date | null;
}

export interface FolderManagerDeps {
  /** Check if the app is in replay mode (owned by replayHandlers). */
  getIsReplayMode: () => boolean;
  /** Cache zip→scenario mapping for replay (owned by replayHandlers). */
  setReplayZipScenariosCache: (cache: Map<string, SessionEntryLike[]>) => void;
  /** Set imported ref points (owned by refPointHandlers). */
  setImportedRefPoints: (refPoints: ImportedRefPoint[]) => void;
  /** Access the current store instance (may change between recordings). */
  getStore: () => RecorderStore;
  /** UI: show error toast/banner. */
  showError: (msg: string) => void;
  /** UI: update main status line. */
  updateStatus: (msg: string) => void;
  /** UI: populate scenario dropdown. */
  populateScenarios: (scenarios: string[]) => void;
  /** UI: mark folder as selected in the HUD. */
  setFolderSelected: (selected: boolean) => void;
  /** UI: mark save location as selected in the HUD. */
  setSaveLocationSelected: (selected: boolean) => void;
  /** UI: revalidate the Enter AR button state. */
  validateEnterButton: () => void;
  /** UI: list scenario sub-directories from a folder handle. */
  listScenariosFromFolder: (
    handle: FileSystemDirectoryHandle
  ) => Promise<string[]>;
  /** UI: extract scenario names from zips in a folder. */
  extractScenarioNamesFromZips: (
    handle: FileSystemDirectoryHandle
  ) => Promise<string[]>;
  /** UI: discover scenario→session mappings from zip metadata. */
  discoverScenariosFromZipMetadata: (
    handle: FileSystemDirectoryHandle
  ) => Promise<{
    scenarioSessions: Map<string, SessionEntryLike[]>;
    scenarioNames: string[];
  }>;
  /** UI: populate replay scenario list. */
  populateReplayScenarios: (scenarios: string[]) => void;
  /** UI: update folder-status display text. */
  updateFolderStatus: (text: string) => void;
  /** UI: update save-status display text. */
  updateSaveStatus: (text: string) => void;
  /** Optional map overlay for displaying prior ref points on the 2D map. */
  mapOverlay?: {
    addPriorRefPoints: (
      refPoints: Array<{ lat: number; lon: number; name: string }>
    ) => void;
    clearPriorRefPoints: () => void;
  };
}

export interface FolderManager {
  /** Handle "Open Previous Recordings" button click. */
  handleOpenFolder(): Promise<void>;
  /** Handle "Choose Save Location" button click. */
  handleChooseSaveLocation(): Promise<void>;
  /** Handle scenario dropdown change. */
  handleScenarioChange(scenarioName: string): Promise<void>;
  /** Load, flatten, and display ref points from a scenario directory. */
  loadAndDisplayRefPoints(
    handle: FileSystemDirectoryHandle
  ): Promise<{ refPointCount: number; observationCount: number }>;

  /** Get current scenario name. */
  getCurrentScenarioName(): string;
  /** Set current scenario name. */
  setCurrentScenarioName(name: string): void;
  /** Get cached OPFS scenarios. */
  getCachedOpfsScenarios(): string[];
  /** Set cached OPFS scenarios. */
  setCachedOpfsScenarios(scenarios: string[]): void;

  /** Reset all state to defaults. */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFolderManager(deps: FolderManagerDeps): FolderManager {
  // --- State ---
  let cachedOpfsScenarios: string[] = [];

  // --- Public API ---

  async function handleOpenFolder(): Promise<void> {
    if (!isExternalStorageSupported()) {
      deps.showError('External file access is not supported in this browser.');
      return;
    }

    const result = await selectReadFolder();

    if (!result.success) {
      if (result.reason === 'cancelled') {
        return;
      }
      deps.showError(result.error ?? 'Failed to open folder.');
      return;
    }

    log.info('Opened folder for reading:', result.folderName);
    deps.updateFolderStatus(`⏳ Scanning ${result.folderName}...`);

    const folderHandle = getReadFolderHandle();
    if (!folderHandle) {
      log.error('Folder handle not available after selection');
      deps.updateFolderStatus('❌ Failed to access folder');
      return;
    }

    // Replay mode: discover scenarios from both subdirectories and zip metadata
    if (deps.getIsReplayMode()) {
      try {
        const [dirScenarios, zipDiscovery] = await Promise.all([
          deps.listScenariosFromFolder(folderHandle),
          deps.discoverScenariosFromZipMetadata(folderHandle),
        ]);
        deps.setReplayZipScenariosCache(zipDiscovery.scenarioSessions);
        const allScenarios = [
          ...new Set([...dirScenarios, ...zipDiscovery.scenarioNames]),
        ].sort();
        deps.populateReplayScenarios(allScenarios);
        const msg = `✅ ${result.folderName} (${allScenarios.length} scenario${allScenarios.length !== 1 ? 's' : ''})`;
        log.info(msg);
        deps.updateFolderStatus(msg);
      } catch (err) {
        log.error('Failed to list scenarios from folder:', err);
        deps.updateFolderStatus('❌ Failed to read scenarios');
      }
      return;
    }

    // Recording mode: discover scenarios (ref point import is scenario-scoped, handled in loadAndDisplayRefPoints)
    try {
      const [folderScenarios, zipScenarios] = await Promise.all([
        deps.listScenariosFromFolder(folderHandle),
        deps.extractScenarioNamesFromZips(folderHandle),
      ]);
      const allScenarios = [
        ...new Set([
          ...cachedOpfsScenarios,
          ...folderScenarios,
          ...zipScenarios,
        ]),
      ].sort();
      if (allScenarios.length > 0) {
        deps.populateScenarios(allScenarios);
      }

      const scenarioLabel =
        allScenarios.length > 0
          ? `${allScenarios.length} scenario${allScenarios.length !== 1 ? 's' : ''}`
          : '';
      const msg = `✅ ${result.folderName}${scenarioLabel ? ` (${scenarioLabel})` : ''}`;
      log.info(msg);
      deps.updateFolderStatus(msg);
      deps.setFolderSelected(true);
      deps.validateEnterButton();
    } catch (err) {
      log.error('Unexpected error during folder scan:', err);
      deps.updateFolderStatus('❌ Folder scan error - see logs');
    }
  }

  async function handleChooseSaveLocation(): Promise<void> {
    if (!isExternalStorageSupported()) {
      deps.showError('External file access is not supported in this browser.');
      return;
    }

    const result = await selectSaveFile();

    if (!result.success) {
      if (result.reason === 'cancelled') {
        return;
      }
      deps.showError(result.error ?? 'Failed to choose save location.');
      return;
    }

    log.info('Save location chosen:', result.fileName);
    deps.updateSaveStatus(`✅ ${result.fileName}`);
    deps.setSaveLocationSelected(true);
    deps.validateEnterButton();
  }

  async function handleScenarioChange(scenarioName: string): Promise<void> {
    log.info('Scenario changed to:', scenarioName);
    deps.getStore().dispatch(setCurrentScenarioName(scenarioName));

    try {
      let handle = await setCurrentScenario(scenarioName);

      // OPFS recovery: scenario directory may be gone after browser data clear.
      // If the user has a read folder with prior ZIPs, create the directory
      // so recovery can populate it with ref points.
      if (!handle) {
        const readFolder = getReadFolderHandle();
        if (readFolder) {
          log.info(
            'Scenario not in OPFS — creating directory for recovery:',
            scenarioName
          );
          handle = await ensureScenarioDirectory(scenarioName);
        }
      }

      if (handle) {
        const { refPointCount, observationCount } =
          await loadAndDisplayRefPoints(handle);
        deps.updateStatus(
          `Scenario: ${scenarioName} | ${refPointCount} ref points (${observationCount} observations)`
        );
      } else {
        deps.showError(`Failed to load scenario: ${scenarioName}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      log.error('Error changing scenario:', errMsg);
      deps.showError(`Error loading scenario: ${scenarioName}`);
    }
  }

  /**
   * Attempts to recover ref point definitions from ZIPs in the read folder.
   * Returns recovered definitions (already persisted to OPFS), or [] on
   * failure / no read folder.
   */
  async function tryRecoverRefPointsFromZips(
    opfsHandle: FileSystemDirectoryHandle
  ): Promise<RefPointDefinition[]> {
    const readFolder = getReadFolderHandle();
    if (!readFolder) return [];
    try {
      log.info('OPFS empty — recovering ref points from ZIPs...');
      const recovery = await recoverRefPointDefinitionsFromZips(readFolder);
      if (recovery.definitions.length > 0) {
        for (const def of recovery.definitions) {
          await writeRefPointDefinition(opfsHandle, def);
        }
        log.info(
          `Recovered ${recovery.definitions.length} ref points from ${recovery.zipFilesScanned} ZIPs`
        );
        return await loadAllRefPoints(opfsHandle);
      }
    } catch (err) {
      log.warn('Ref point recovery from ZIPs failed:', err);
    }
    return [];
  }

  async function loadAndDisplayRefPoints(
    handle: FileSystemDirectoryHandle
  ): Promise<{ refPointCount: number; observationCount: number }> {
    let refPointDefs = await loadAllRefPoints(handle);

    // OPFS recovery (Problem 2): when OPFS refPoints/ is empty and a read
    // folder with prior session ZIPs is available, recover full definitions
    // from ZIPs, persist them to OPFS, and re-load.
    if (refPointDefs.length === 0) {
      refPointDefs = await tryRecoverRefPointsFromZips(handle);
    }

    const allObservations = flattenRefPointsToMarks(refPointDefs);

    // 3D display (all individual observations as green spheres) — driven by
    // store subscription (Finding 5; see
    // 2026-04-30-refpoint-marks-into-redux-plan.md). The visualizer was
    // previously called directly here; it is now a subscription consumer
    // bound via wireStoreSubscribers in the recording / replay paths.
    deps.getStore().dispatch(setPriorRefPointMarks(allObservations));

    // Compute averaged GPS per ref point ID for H3 + 2D map
    const averaged = averageGpsPerRefPoint(refPointDefs);

    // H3 proximity cache (scenario-scoped, replaces old cross-scenario ZIP scan)
    deps.setImportedRefPoints(
      averaged.map((rp) => ({
        id: rp.id,
        name: rp.name,
        lat: rp.lat,
        lon: rp.lon,
        alt: rp.alt,
        sourceZipName: '',
      }))
    );

    // 2D map display
    if (deps.mapOverlay) {
      deps.mapOverlay.clearPriorRefPoints();
      deps.mapOverlay.addPriorRefPoints(
        averaged.map((rp) => ({ lat: rp.lat, lon: rp.lon, name: rp.name }))
      );
    }

    return {
      refPointCount: refPointDefs.length,
      observationCount: allObservations.length,
    };
  }

  function reset(): void {
    deps.getStore().dispatch(setCurrentScenarioName(''));
    cachedOpfsScenarios = [];
  }

  return {
    handleOpenFolder,
    handleChooseSaveLocation,
    handleScenarioChange,
    loadAndDisplayRefPoints,
    getCurrentScenarioName: () =>
      deps.getStore().getState().scenario.currentScenarioName,
    setCurrentScenarioName: (name: string) => {
      deps.getStore().dispatch(setCurrentScenarioName(name));
    },
    getCachedOpfsScenarios: () => cachedOpfsScenarios,
    setCachedOpfsScenarios: (scenarios: string[]) => {
      cachedOpfsScenarios = scenarios;
    },
    reset,
  };
}
