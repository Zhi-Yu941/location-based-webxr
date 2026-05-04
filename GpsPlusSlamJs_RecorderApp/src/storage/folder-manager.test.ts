/**
 * Folder Manager Tests
 *
 * Tests for the folder-manager module extracted from main.ts
 * (Finding #7 — main.ts decomposition, Step 4).
 *
 * Tests the factory function `createFolderManager(deps)` which encapsulates:
 * - handleOpenFolder: folder picker + ref point import + scenario discovery
 * - handleChooseSaveLocation: save file picker
 * - handleScenarioChange: scenario dropdown change handler
 * - cachedOpfsScenarios: OPFS scenario cache
 * - currentScenarioName: current scenario name state
 *
 * Status display functions (updateFolderStatus / updateSaveStatus) are injected
 * dependencies — no jsdom environment is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createFolderManager,
  type FolderManagerDeps,
  type FolderManager,
} from './folder-manager';
import type { RecorderStore } from '../state/recorder-store';

// --- Mock all direct dependencies ---

vi.mock('./external-file-storage', () => ({
  isExternalStorageSupported: vi.fn(() => true),
  selectReadFolder: vi.fn(),
  selectSaveFile: vi.fn(),
  getReadFolderHandle: vi.fn(),
}));

vi.mock('../storage/ref-point-importer', () => ({
  importRefPointsFromFolder: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/storage/file-system', () => ({
  setCurrentScenario: vi.fn(),
  ensureScenarioDirectory: vi.fn(),
}));

vi.mock('../storage/ref-point-loader', () => ({
  loadAllRefPoints: vi.fn(() => []),
  flattenRefPointsToMarks: vi.fn(() => []),
  averageGpsPerRefPoint: vi.fn(() => []),
  writeRefPointDefinition: vi.fn(),
}));

vi.mock('../storage/ref-point-recovery', () => ({
  recoverRefPointDefinitionsFromZips: vi.fn(() =>
    Promise.resolve({ definitions: [], zipFilesScanned: 0, errors: [] })
  ),
}));

vi.mock('gps-plus-slam-app-framework/visualization/reference-points', () => ({
  refPointVisualizer: {
    displayPriorRefPoints: vi.fn(),
  },
}));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Now import mocked modules for assertion
import {
  isExternalStorageSupported,
  selectReadFolder,
  selectSaveFile,
  getReadFolderHandle,
} from './external-file-storage';
import {
  setCurrentScenario,
  ensureScenarioDirectory,
} from 'gps-plus-slam-app-framework/storage/file-system';

// ============================================================================
// Helpers
// ============================================================================

const mockFolderHandle = {
  kind: 'directory',
  name: 'TestFolder',
} as unknown as FileSystemDirectoryHandle;

/**
 * Creates a minimal mock RecorderStore that handles scenario/setCurrentScenarioName
 * actions, backing them with a simple in-memory state.
 */
function createMockStore(): RecorderStore {
  const state = {
    recorder: {
      isRecording: false,
      sessionMetadata: null,
      actionCount: 0,
      failedWriteCount: 0,
    },
    scenario: {
      currentScenarioName: '',
    },
    refPoints: {
      importedRefPoints: [],
      sessionRefPointUsage: {},
    },
    gpsData: null,
  };
  return {
    getState: () => state,
    dispatch: vi.fn((action: { type: string; payload?: unknown }) => {
      if (action.type === 'scenario/setCurrentScenarioName') {
        state.scenario.currentScenarioName = action.payload as string;
      }
    }),
    subscribe: () => () => {},
  } as unknown as RecorderStore;
}

function createDefaultDeps(
  overrides: Partial<FolderManagerDeps> = {}
): FolderManagerDeps {
  const mockStore = overrides.getStore?.() ?? createMockStore();
  return {
    getStore: () => mockStore,
    getIsReplayMode: vi.fn(() => false),
    setReplayZipScenariosCache: vi.fn(),
    setImportedRefPoints: vi.fn(),
    showError: vi.fn(),
    updateStatus: vi.fn(),
    populateScenarios: vi.fn(),
    setFolderSelected: vi.fn(),
    setSaveLocationSelected: vi.fn(),
    validateEnterButton: vi.fn(),
    listScenariosFromFolder: vi
      .fn<FolderManagerDeps['listScenariosFromFolder']>()
      .mockResolvedValue([]),
    extractScenarioNamesFromZips: vi
      .fn<FolderManagerDeps['extractScenarioNamesFromZips']>()
      .mockResolvedValue([]),
    discoverScenariosFromZipMetadata: vi
      .fn<FolderManagerDeps['discoverScenariosFromZipMetadata']>()
      .mockResolvedValue({
        scenarioSessions: new Map(),
        scenarioNames: [],
      }),
    populateReplayScenarios: vi.fn(),
    updateFolderStatus: vi.fn(),
    updateSaveStatus: vi.fn(),
    ...overrides,
  };
}

function createFolderManagerWithDefaults(
  overrides: Partial<FolderManagerDeps> = {}
): { manager: FolderManager; deps: FolderManagerDeps; store: RecorderStore } {
  const deps = createDefaultDeps(overrides);
  const manager = createFolderManager(deps);
  return { manager, deps, store: deps.getStore() };
}

// ============================================================================
// Tests
// ============================================================================

describe('createFolderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mockReturnValue for isExternalStorageSupported
    // (vi.clearAllMocks does NOT reset mockReturnValue/mockResolvedValue)
    vi.mocked(isExternalStorageSupported).mockReturnValue(true);
  });

  // ========================================================================
  // State management
  // ========================================================================

  describe('scenario name state', () => {
    it('should initialize currentScenarioName as empty string', () => {
      // Why: Default state must be empty so handleStartRecording knows no scenario was selected
      const { manager } = createFolderManagerWithDefaults();
      expect(manager.getCurrentScenarioName()).toBe('');
    });

    it('should update currentScenarioName via setter', () => {
      // Why: Scenario dropdown changes must be reflected in state
      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');
      expect(manager.getCurrentScenarioName()).toBe('Paris');
    });

    it('should persist the last selected scenario name', () => {
      // Why: Multiple changes should always reflect the most recent selection
      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('A');
      manager.setCurrentScenarioName('B');
      expect(manager.getCurrentScenarioName()).toBe('B');
    });
  });

  describe('OPFS scenario cache', () => {
    it('should initialize cachedOpfsScenarios as empty array', () => {
      // Why: Default state must be empty before OPFS is initialized
      const { manager } = createFolderManagerWithDefaults();
      expect(manager.getCachedOpfsScenarios()).toEqual([]);
    });

    it('should update cachedOpfsScenarios via setter', () => {
      // Why: OPFS initialization provides scenario names that must be cached
      const { manager } = createFolderManagerWithDefaults();
      manager.setCachedOpfsScenarios(['Paris', 'Berlin']);
      expect(manager.getCachedOpfsScenarios()).toEqual(['Paris', 'Berlin']);
    });
  });

  describe('reset', () => {
    it('should reset all state to defaults', () => {
      // Why: Test isolation requires full state reset between tests
      const { manager } = createFolderManagerWithDefaults();
      manager.setCurrentScenarioName('Paris');
      manager.setCachedOpfsScenarios(['Berlin']);
      manager.reset();
      expect(manager.getCurrentScenarioName()).toBe('');
      expect(manager.getCachedOpfsScenarios()).toEqual([]);
    });
  });

  // ========================================================================
  // handleOpenFolder — recording mode
  // ========================================================================

  describe('handleOpenFolder — recording mode', () => {
    beforeEach(() => {
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: true,
        folderName: 'TestFolder',
      } as never);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
    });

    it('should return early when external storage is not supported', async () => {
      // Why: Must guard against missing File System Access API
      vi.mocked(isExternalStorageSupported).mockReturnValue(false);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.showError).toHaveBeenCalledWith(
        'External file access is not supported in this browser.'
      );
      expect(selectReadFolder).not.toHaveBeenCalled();
    });

    it('should return early when user cancels folder picker', async () => {
      // Why: User cancellation is not an error — no side effects expected
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: false,
        reason: 'cancelled',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('should show error when folder picker fails', async () => {
      // Why: Non-cancellation failures should inform the user
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: false,
        reason: 'error',
        error: 'Access denied',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.showError).toHaveBeenCalledWith('Access denied');
    });

    it('should show error when folder handle is not available', async () => {
      // Why: Edge case where selectReadFolder succeeds but getReadFolderHandle returns null
      vi.mocked(getReadFolderHandle).mockReturnValue(null);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.updateFolderStatus).toHaveBeenCalledWith(
        '❌ Failed to access folder'
      );
    });

    it('should NOT call importRefPointsFromFolder (ref point import is scenario-scoped)', async () => {
      // Why: Cross-scenario ZIP scan was removed; ref points are loaded per-scenario in loadAndDisplayRefPoints
      const { importRefPointsFromFolder } =
        await import('../storage/ref-point-importer');
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(importRefPointsFromFolder).not.toHaveBeenCalled();
    });

    it('should call listScenariosFromFolder with the folder handle', async () => {
      // Why: Must scan for scenario subdirectories
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.listScenariosFromFolder).toHaveBeenCalledWith(
        mockFolderHandle
      );
    });

    it('should call extractScenarioNamesFromZips', async () => {
      // Why: Top-level ZIPs with scenario prefixes must also contribute
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.extractScenarioNamesFromZips).toHaveBeenCalledWith(
        mockFolderHandle
      );
    });

    it('should merge OPFS, folder, and zip scenarios — deduplicated and sorted', async () => {
      // Why: Dropdown must show unified, sorted, deduplicated scenario list
      const listScenarios = vi
        .fn<FolderManagerDeps['listScenariosFromFolder']>()
        .mockResolvedValue(['Paris', 'Munich']);
      const extractZipScenarios = vi
        .fn<FolderManagerDeps['extractScenarioNamesFromZips']>()
        .mockResolvedValue(['Tokyo']);
      const { manager, deps } = createFolderManagerWithDefaults({
        listScenariosFromFolder: listScenarios,
        extractScenarioNamesFromZips: extractZipScenarios,
      });
      manager.setCachedOpfsScenarios(['Paris', 'Berlin']);

      await manager.handleOpenFolder();

      expect(deps.populateScenarios).toHaveBeenCalledWith([
        'Berlin',
        'Munich',
        'Paris',
        'Tokyo',
      ]);
    });

    it('should update folder status with scenario count', async () => {
      // Why: User needs feedback on what was found
      const { manager, deps } = createFolderManagerWithDefaults({
        listScenariosFromFolder: vi
          .fn<FolderManagerDeps['listScenariosFromFolder']>()
          .mockResolvedValue(['Paris', 'Munich']),
      });

      await manager.handleOpenFolder();

      const statusCall =
        vi.mocked(deps.updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
      expect(statusCall).toContain('2 scenario');
    });

    it('should set folder selected and validate enter button', async () => {
      // Why: Successful folder open enables the Enter AR button
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleOpenFolder();

      expect(deps.setFolderSelected).toHaveBeenCalledWith(true);
      expect(deps.validateEnterButton).toHaveBeenCalled();
    });

    it('should handle unexpected errors during folder scan', async () => {
      // Why: Must not crash on unexpected exceptions
      const { manager, deps } = createFolderManagerWithDefaults({
        listScenariosFromFolder: vi
          .fn<FolderManagerDeps['listScenariosFromFolder']>()
          .mockRejectedValue(new Error('Network error')),
      });

      await manager.handleOpenFolder();

      expect(deps.updateFolderStatus).toHaveBeenCalledWith(
        '❌ Folder scan error - see logs'
      );
    });
  });

  // ========================================================================
  // handleOpenFolder — replay mode
  // ========================================================================

  describe('handleOpenFolder — replay mode', () => {
    beforeEach(() => {
      vi.mocked(selectReadFolder).mockResolvedValue({
        success: true,
        folderName: 'TestFolder',
      } as never);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
    });

    it('should discover scenarios from both directories and zip metadata', async () => {
      // Why: Replay mode must discover scenarios from both sources
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      expect(deps.listScenariosFromFolder).toHaveBeenCalledWith(
        mockFolderHandle
      );
      expect(deps.discoverScenariosFromZipMetadata).toHaveBeenCalledWith(
        mockFolderHandle
      );
    });

    it('should cache zip scenario mapping via deps', async () => {
      // Why: Cached mapping is used when user selects a metadata-only scenario
      const scenarioSessions = new Map([
        [
          'ParkWalk',
          [
            {
              filename: 'rec.zip',
              fileHandle: {} as FileSystemFileHandle,
              date: null,
            },
          ],
        ],
      ]);
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
        discoverScenariosFromZipMetadata: vi
          .fn<FolderManagerDeps['discoverScenariosFromZipMetadata']>()
          .mockResolvedValue({
            scenarioSessions,
            scenarioNames: ['ParkWalk'],
          }),
      });

      await manager.handleOpenFolder();

      expect(deps.setReplayZipScenariosCache).toHaveBeenCalledWith(
        scenarioSessions
      );
    });

    it('should merge and deduplicate scenarios from directories and zips', async () => {
      // Why: Both discovery mechanisms must contribute without duplicates
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
        listScenariosFromFolder: vi
          .fn<FolderManagerDeps['listScenariosFromFolder']>()
          .mockResolvedValue(['DirScenario']),
        discoverScenariosFromZipMetadata: vi
          .fn<FolderManagerDeps['discoverScenariosFromZipMetadata']>()
          .mockResolvedValue({
            scenarioSessions: new Map([
              [
                'ZipScenario',
                [
                  {
                    filename: 'rec.zip',
                    fileHandle: {} as FileSystemFileHandle,
                    date: null,
                  },
                ],
              ],
            ]),
            scenarioNames: ['ZipScenario'],
          }),
      });

      await manager.handleOpenFolder();

      expect(deps.populateReplayScenarios).toHaveBeenCalledWith([
        'DirScenario',
        'ZipScenario',
      ]);
    });

    it('should update folder status with scenario count', async () => {
      // Why: User needs to see what was found in the folder
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
        listScenariosFromFolder: vi
          .fn<FolderManagerDeps['listScenariosFromFolder']>()
          .mockResolvedValue(['A', 'B']),
      });

      await manager.handleOpenFolder();

      const statusCall =
        vi.mocked(deps.updateFolderStatus).mock.calls.at(-1)?.[0] ?? '';
      expect(statusCall).toContain('2 scenarios');
    });

    it('should handle replay mode folder scan errors gracefully', async () => {
      // Why: Must not crash on scan failure
      const { manager, deps } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
        listScenariosFromFolder: vi
          .fn<FolderManagerDeps['listScenariosFromFolder']>()
          .mockRejectedValue(new Error('Permission denied')),
      });

      await manager.handleOpenFolder();

      expect(deps.updateFolderStatus).toHaveBeenCalledWith(
        '❌ Failed to read scenarios'
      );
    });

    it('should NOT import ref points in replay mode', async () => {
      // Why: Replay mode only needs scenario discovery, not ref point import
      const { importRefPointsFromFolder } =
        await import('../storage/ref-point-importer');
      const { manager } = createFolderManagerWithDefaults({
        getIsReplayMode: vi.fn(() => true),
      });

      await manager.handleOpenFolder();

      expect(importRefPointsFromFolder).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // handleChooseSaveLocation
  // ========================================================================

  describe('handleChooseSaveLocation', () => {
    it('should return early when external storage is not supported', async () => {
      // Why: Must guard against missing File System Access API
      vi.mocked(isExternalStorageSupported).mockReturnValue(false);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.showError).toHaveBeenCalledWith(
        'External file access is not supported in this browser.'
      );
      expect(selectSaveFile).not.toHaveBeenCalled();
    });

    it('should return early when user cancels', async () => {
      // Why: User cancellation is not an error
      vi.mocked(selectSaveFile).mockResolvedValue({
        success: false,
        reason: 'cancelled',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('should show error when save picker fails', async () => {
      // Why: Failure should inform the user
      vi.mocked(selectSaveFile).mockResolvedValue({
        success: false,
        reason: 'error',
        error: 'Disk full',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.showError).toHaveBeenCalledWith('Disk full');
    });

    it('should update save status and enable button on success', async () => {
      // Why: Successful save location must update UI state
      vi.mocked(selectSaveFile).mockResolvedValue({
        success: true,
        fileName: 'recording.zip',
      } as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleChooseSaveLocation();

      expect(deps.updateSaveStatus).toHaveBeenCalledWith('✅ recording.zip');
      expect(deps.setSaveLocationSelected).toHaveBeenCalledWith(true);
      expect(deps.validateEnterButton).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // handleScenarioChange
  // ========================================================================

  describe('handleScenarioChange', () => {
    it('should update currentScenarioName', async () => {
      // Why: Scenario change must update internal state
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('New Scenario');

      expect(manager.getCurrentScenarioName()).toBe('New Scenario');
    });

    it('should call setCurrentScenario to update storage', async () => {
      // Why: Storage layer must know which scenario is active
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('Paris');

      expect(setCurrentScenario).toHaveBeenCalledWith('Paris');
    });

    it('should load and display ref points when scenario handle is returned', async () => {
      // Why: Changing scenario must load its ref points for the AR view
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      const { loadAllRefPoints } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      const { manager } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('Paris');

      expect(loadAllRefPoints).toHaveBeenCalledWith(mockFolderHandle);
    });

    it('should update status with ref point info', async () => {
      // Why: User needs feedback on what ref points are in this scenario
      vi.mocked(setCurrentScenario).mockResolvedValue(mockFolderHandle);
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { name: 'pt1', observations: [] },
        { name: 'pt2', observations: [] },
      ] as never);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([
        { lat: 0, lng: 0, name: 'pt1' },
        { lat: 1, lng: 1, name: 'pt2' },
        { lat: 2, lng: 2, name: 'pt2' },
      ] as never);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('Paris');

      expect(deps.updateStatus).toHaveBeenCalledWith(
        'Scenario: Paris | 2 ref points (3 observations)'
      );
    });

    it('should show error when scenario handle is null', async () => {
      // Why: Failed scenario load must inform the user
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('BadScenario');

      expect(deps.showError).toHaveBeenCalledWith(
        'Failed to load scenario: BadScenario'
      );
    });

    it('should handle errors in scenario loading', async () => {
      // Why: Must not crash on storage errors
      vi.mocked(setCurrentScenario).mockRejectedValue(new Error('OPFS error'));
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.handleScenarioChange('BrokenScenario');

      expect(deps.showError).toHaveBeenCalledWith(
        'Error loading scenario: BrokenScenario'
      );
    });
  });

  // ========================================================================
  // loadAndDisplayRefPoints
  // ========================================================================

  describe('loadAndDisplayRefPoints', () => {
    it('should load, flatten, and dispatch ref points to the store', async () => {
      // Why: Finding 5 — visualizer is a subscription consumer; the call
      // site dispatches setPriorRefPointMarks instead of calling the
      // visualizer directly. See
      // docs/2026-04-30-refpoint-marks-into-redux-plan.md.
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      const mockDefs = [
        { name: 'pt1', observations: [{ lat: 0, lng: 0, name: 'pt1' }] },
      ] as never;
      const mockMarks = [{ lat: 0, lng: 0, name: 'pt1' }] as never;
      vi.mocked(loadAllRefPoints).mockResolvedValue(mockDefs);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue(mockMarks);
      const { manager, store } = createFolderManagerWithDefaults();

      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(loadAllRefPoints).toHaveBeenCalledWith(mockFolderHandle);
      expect(flattenRefPointsToMarks).toHaveBeenCalledWith(mockDefs);
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'refPoints/setPriorRefPointMarks',
          payload: mockMarks,
        })
      );
      expect(result).toEqual({ refPointCount: 1, observationCount: 1 });
    });

    it('should call setImportedRefPoints with averaged GPS positions', async () => {
      // Why: H3 proximity cache must use averaged scenario-scoped ref points
      const { loadAllRefPoints, averageGpsPerRefPoint } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { id: 'p1', name: 'P1', createdAt: 1000, observations: [] },
      ] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([
        { id: 'p1', name: 'P1', lat: 50.0, lon: 8.0, alt: 100 },
      ]);
      const { manager, deps } = createFolderManagerWithDefaults();

      await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(deps.setImportedRefPoints).toHaveBeenCalledWith([
        {
          id: 'p1',
          name: 'P1',
          lat: 50.0,
          lon: 8.0,
          alt: 100,
          sourceZipName: '',
        },
      ]);
    });

    it('should forward averaged ref points to map overlay for 2D display', async () => {
      // Why: Prior ref points must appear on the 2D Leaflet map
      const { loadAllRefPoints, averageGpsPerRefPoint } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([
        { id: 'p1', name: 'P1', lat: 50.0, lon: 8.0 },
        { id: 'p2', name: 'P2', lat: 51.0, lon: 9.0 },
      ]);
      const mockMapOverlay = {
        addPriorRefPoints: vi.fn(),
        clearPriorRefPoints: vi.fn(),
      };
      const { manager } = createFolderManagerWithDefaults({
        mapOverlay: mockMapOverlay,
      });

      await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(mockMapOverlay.clearPriorRefPoints).toHaveBeenCalled();
      expect(mockMapOverlay.addPriorRefPoints).toHaveBeenCalledWith([
        { lat: 50.0, lon: 8.0, name: 'P1' },
        { lat: 51.0, lon: 9.0, name: 'P2' },
      ]);
    });

    it('should clear old prior ref points on scenario change before adding new ones', async () => {
      // Why: Switching scenarios must replace, not accumulate, prior ref points
      const { loadAllRefPoints, averageGpsPerRefPoint } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([] as never);
      vi.mocked(averageGpsPerRefPoint).mockReturnValue([]);
      const mockMapOverlay = {
        addPriorRefPoints: vi.fn(),
        clearPriorRefPoints: vi.fn(),
      };
      const { manager } = createFolderManagerWithDefaults({
        mapOverlay: mockMapOverlay,
      });

      await manager.loadAndDisplayRefPoints(mockFolderHandle);

      // clearPriorRefPoints must be called before addPriorRefPoints
      const clearOrder =
        mockMapOverlay.clearPriorRefPoints.mock.invocationCallOrder[0];
      const addOrder =
        mockMapOverlay.addPriorRefPoints.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(addOrder);
    });

    it('should work without mapOverlay (optional dep)', async () => {
      // Why: mapOverlay might not be set (e.g., in tests or before 3D scene init)
      const { loadAllRefPoints, flattenRefPointsToMarks } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([] as never);
      vi.mocked(flattenRefPointsToMarks).mockReturnValue([] as never);
      const { manager } = createFolderManagerWithDefaults();

      // Should not throw
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);
      expect(result).toEqual({ refPointCount: 0, observationCount: 0 });
    });

    it('should recover ref points from ZIPs when OPFS is empty and read folder available', async () => {
      // Why: Problem 2 fix — when OPFS is cleared, ref points should be
      // recovered from session ZIPs in the read folder, written to OPFS,
      // then loaded normally. This is the core OPFS recovery flow.
      const { loadAllRefPoints, writeRefPointDefinition } =
        await import('../storage/ref-point-loader');
      const { recoverRefPointDefinitionsFromZips } =
        await import('../storage/ref-point-recovery');

      const recoveredDef = {
        id: 'h3-cell-a',
        name: 'Bench',
        createdAt: 1000,
        observations: [
          {
            sessionId: 'session-1',
            timestamp: 1000,
            arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
            gpsPoint: { latitude: 50.1, longitude: 8.1 },
          },
        ],
      };

      // First call: OPFS empty. Second call (after recovery writes): has data
      vi.mocked(loadAllRefPoints)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([recoveredDef] as never);
      vi.mocked(recoverRefPointDefinitionsFromZips).mockResolvedValue({
        definitions: [recoveredDef] as never,
        zipFilesScanned: 2,
        errors: [],
      });
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager } = createFolderManagerWithDefaults();
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      // Recovery should have been triggered
      expect(recoverRefPointDefinitionsFromZips).toHaveBeenCalledWith(
        mockFolderHandle
      );
      // Recovered definitions should have been written to OPFS
      expect(writeRefPointDefinition).toHaveBeenCalledWith(
        mockFolderHandle,
        recoveredDef
      );
      // After recovery, ref points should be loaded and displayed
      expect(result.refPointCount).toBe(1);
    });

    it('should NOT attempt recovery when OPFS has data', async () => {
      // Why: Recovery should only run when OPFS is empty — unnecessary
      // ZIP scanning would slow down normal scenario changes.
      const { loadAllRefPoints } =
        await import('../storage/ref-point-loader');
      const { recoverRefPointDefinitionsFromZips } =
        await import('../storage/ref-point-recovery');

      vi.mocked(loadAllRefPoints).mockResolvedValue([
        { id: 'p1', name: 'existing', createdAt: 1, observations: [] },
      ] as never);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager } = createFolderManagerWithDefaults();
      await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(recoverRefPointDefinitionsFromZips).not.toHaveBeenCalled();
    });

    it('should NOT attempt recovery when no read folder is available', async () => {
      // Why: Without a read folder, there are no ZIPs to recover from.
      const { loadAllRefPoints } =
        await import('../storage/ref-point-loader');
      const { recoverRefPointDefinitionsFromZips } =
        await import('../storage/ref-point-recovery');

      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      vi.mocked(getReadFolderHandle).mockReturnValue(null);

      const { manager } = createFolderManagerWithDefaults();
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);

      expect(recoverRefPointDefinitionsFromZips).not.toHaveBeenCalled();
      expect(result).toEqual({ refPointCount: 0, observationCount: 0 });
    });

    it('should handle recovery errors gracefully', async () => {
      // Why: Recovery failures should not crash scenario selection —
      // user can still record, just without prior ref points.
      const { loadAllRefPoints } =
        await import('../storage/ref-point-loader');
      const { recoverRefPointDefinitionsFromZips } =
        await import('../storage/ref-point-recovery');

      vi.mocked(loadAllRefPoints).mockResolvedValue([]);
      vi.mocked(recoverRefPointDefinitionsFromZips).mockRejectedValue(
        new Error('ZIP read failure')
      );
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager } = createFolderManagerWithDefaults();
      // Should not throw
      const result = await manager.loadAndDisplayRefPoints(mockFolderHandle);
      expect(result).toEqual({ refPointCount: 0, observationCount: 0 });
    });
  });

  // ========================================================================
  // handleScenarioChange — OPFS recovery (Problem 2)
  // ========================================================================

  describe('handleScenarioChange — OPFS recovery', () => {
    it('should create scenario directory and proceed when OPFS scenario is missing but read folder available', async () => {
      // Why: After browser data clear, the scenario directory is gone.
      // When a read folder with ZIPs is available, we should create
      // the directory so recovery can populate it.
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      vi.mocked(ensureScenarioDirectory).mockResolvedValue(mockFolderHandle);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);
      const { loadAllRefPoints } =
        await import('../storage/ref-point-loader');
      vi.mocked(loadAllRefPoints).mockResolvedValue([]);

      const { manager, deps } = createFolderManagerWithDefaults();
      await manager.handleScenarioChange('Aachen');

      expect(ensureScenarioDirectory).toHaveBeenCalledWith('Aachen');
      // Should not show error since recovery path was taken
      expect(deps.showError).not.toHaveBeenCalled();
    });

    it('should show error when OPFS scenario missing and no read folder', async () => {
      // Why: Without a read folder, cannot create and recover — show error.
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      vi.mocked(getReadFolderHandle).mockReturnValue(null);

      const { manager, deps } = createFolderManagerWithDefaults();
      await manager.handleScenarioChange('Unknown');

      expect(deps.showError).toHaveBeenCalledWith(
        'Failed to load scenario: Unknown'
      );
    });

    it('should show error when ensureScenarioDirectory also fails', async () => {
      // Why: If even creating the directory fails (e.g., OPFS not initialized),
      // must inform the user.
      vi.mocked(setCurrentScenario).mockResolvedValue(null);
      vi.mocked(ensureScenarioDirectory).mockResolvedValue(null);
      vi.mocked(getReadFolderHandle).mockReturnValue(mockFolderHandle);

      const { manager, deps } = createFolderManagerWithDefaults();
      await manager.handleScenarioChange('Broken');

      expect(deps.showError).toHaveBeenCalledWith(
        'Failed to load scenario: Broken'
      );
    });
  });
});
