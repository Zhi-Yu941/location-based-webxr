/**
 * Ref-Point Handlers Tests
 *
 * Why these tests matter:
 * The ref-point handlers module encapsulates all reference-point state and
 * event handlers extracted from main.ts (Finding #7 â€” main.ts decomposition,
 * Step 2). These tests verify each handler's behavior in isolation, ensuring
 * the extraction preserves the exact same behavior as the original.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Vector3,
  Quaternion,
  GpsPoint,
} from 'gps-plus-slam-app-framework/core';
import type { ARPose } from 'gps-plus-slam-app-framework/types/ar-types';
import type * as StoreModule from '../state/recorder-store';
import type { RecorderStore } from '../state/recorder-store';
import type { ImportedRefPoint } from '../storage/ref-point-importer';
import type {
  RefPointObservation,
  RefPointMark,
} from '../storage/ref-point-loader';

// â”€â”€ Hoisted mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const {
  mockGetCurrentArPose,
  mockGetCurrentScenarioHandle,
  mockListRefPointIds,
  mockShowRefPointPicker,
  mockSaveRefPointObservation,
  mockExtractOdomPosition,
  mockExtractOdomRotation,
  mockRefPointVisualizer,
  mockShowError,
  mockUpdateStatus,
  mockShowToast,
  mockIsRefPointPickerVisible,
  mockMarkReferencePoint,
  mockCalcGpsCoords,
  mockFusedGpsFromOdom,
} = vi.hoisted(() => ({
  mockGetCurrentArPose: vi.fn<() => ARPose | null>().mockReturnValue(null),
  mockGetCurrentScenarioHandle: vi
    .fn<() => FileSystemDirectoryHandle | null>()
    .mockReturnValue(null),
  mockListRefPointIds: vi
    .fn<(h: FileSystemDirectoryHandle) => Promise<string[]>>()
    .mockResolvedValue([]),
  mockShowRefPointPicker: vi
    .fn<
      (
        ids: string[],
        usage: Map<string, number>
      ) => Promise<{ id: string; isNew: boolean } | null>
    >()
    .mockResolvedValue(null),
  mockSaveRefPointObservation: vi.fn().mockResolvedValue(undefined),
  mockExtractOdomPosition: vi
    .fn<(pose: ARPose) => Vector3>()
    .mockReturnValue([1, 2, 3] as Vector3),
  mockExtractOdomRotation: vi
    .fn<(pose: ARPose) => Quaternion>()
    .mockReturnValue([0, 0, 0, 1] as Quaternion),
  mockRefPointVisualizer: {
    addCurrentRefPoint: vi.fn(),
  },
  mockShowError: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockShowToast: vi.fn(),
  mockIsRefPointPickerVisible: vi.fn<() => boolean>().mockReturnValue(false),
  mockMarkReferencePoint: vi.fn((payload: unknown) => ({
    type: 'recording/markReferencePoint',
    payload,
  })),
  mockCalcGpsCoords: vi.fn().mockReturnValue({ lat: 49.123, lon: 8.456 }),
  mockFusedGpsFromOdom: vi.fn().mockReturnValue({ lat: 49.123, lon: 8.456 }),
}));

// â”€â”€ Module mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

vi.mock('gps-plus-slam-app-framework/ar/webxr-session', () => ({
  getCurrentArPose: mockGetCurrentArPose,
}));

vi.mock('gps-plus-slam-app-framework/storage/file-system', () => ({
  getCurrentScenarioHandle: mockGetCurrentScenarioHandle,
}));

vi.mock('gps-plus-slam-app-framework/utils/fused-path', () => ({
  fusedGpsFromOdom: mockFusedGpsFromOdom,
}));

vi.mock('../state/recorder-store', async () => {
  const actual: typeof StoreModule = await vi.importActual(
    '../state/recorder-store'
  );
  return {
    ...actual,
    markReferencePoint: mockMarkReferencePoint,
  };
});

vi.mock('../storage/ref-point-loader', () => ({
  listRefPointIds: mockListRefPointIds,
  saveRefPointObservation: mockSaveRefPointObservation,
}));

vi.mock('../ui/ref-point-picker', () => ({
  showRefPointPicker: mockShowRefPointPicker,
  isRefPointPickerVisible: mockIsRefPointPickerVisible,
  cancelRefPointPicker: vi.fn(),
  createRefPointPickerHtml: vi.fn(),
}));

vi.mock('gps-plus-slam-app-framework/state/gps-event-coordinator', () => ({
  extractOdomPosition: mockExtractOdomPosition,
  extractOdomRotation: mockExtractOdomRotation,
}));

vi.mock('../ui/hud', () => ({
  showError: mockShowError,
  updateStatus: mockUpdateStatus,
}));

vi.mock('../ui/toast', () => ({
  showToast: mockShowToast,
  initToast: vi.fn(),
  TOAST_DURATION_ERROR: 8000,
}));

vi.mock('gps-plus-slam-app-framework/visualization/reference-points', () => ({
  refPointVisualizer: mockRefPointVisualizer,
}));

vi.mock('gps-plus-slam-app-framework/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// â”€â”€ Imports (after mocks) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  createRefPointHandlers,
  type RefPointHandlers,
  type RefPointHandlersDeps,
} from './ref-point-handlers';
import { refPointsReducer } from '../state/ref-points-slice';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function createMockStore(
  gpsPositions: GpsPoint[] = [],
  options?: { alignmentMatrix?: number[] }
): RecorderStore {
  let refPointsState = refPointsReducer(undefined, { type: '@@INIT' });

  const store = {
    getState: vi.fn().mockImplementation(() => ({
      gpsData: {
        zero: { lat: 49.0, lng: 8.0 },
        gpsEvents: {
          gpsPositions,
          alignmentMatrix: options?.alignmentMatrix ?? null,
        },
      },
      refPoints: refPointsState,
    })),
    subscribe: vi.fn().mockReturnValue(() => {}),
    dispatch: vi.fn().mockImplementation((action: { type: string }) => {
      if (action.type.startsWith('refPoints/')) {
        refPointsState = refPointsReducer(refPointsState, action);
      }
      return action;
    }),
    replaceReducer: vi.fn(),
    writeFrame: vi.fn(),
    writeSessionMetadata: vi.fn(),
  } as unknown as RecorderStore;
  return store;
}

/**
 * Extract the RefPointMark from the most recent
 * `refPoints/addCurrentRefPointMark` action dispatched on the given store.
 *
 * Why: Finding 5 (2026-04-30 plan) moves visualization through Redux. The
 * call site dispatches the mark instead of calling refPointVisualizer
 * directly; tests that previously asserted on the visualizer's
 * `addCurrentRefPoint` mock now assert on the dispatched action payload.
 */
function getDispatchedCurrentMark(store: RecorderStore): RefPointMark {
  const dispatch = store.dispatch as unknown as ReturnType<typeof vi.fn>;
  const calls = dispatch.mock.calls as Array<
    [{ type: string; payload: unknown }]
  >;
  const match = [...calls]
    .reverse()
    .find(([a]) => a?.type === 'refPoints/addCurrentRefPointMark');
  if (!match) {
    throw new Error(
      'Expected a refPoints/addCurrentRefPointMark action to have been dispatched'
    );
  }
  return match[0].payload as RefPointMark;
}

/**
 * Assert that at least one `refPoints/addCurrentRefPointMark` action was
 * dispatched on the given store. Replacement for the legacy assertion
 * `expect(mockRefPointVisualizer.addCurrentRefPoint).toHaveBeenCalled()`.
 */
function expectCurrentRefPointDispatched(store: RecorderStore): void {
  const dispatch = store.dispatch as unknown as ReturnType<typeof vi.fn>;
  const calls = dispatch.mock.calls as Array<[{ type: string }]>;
  expect(
    calls.some(([a]) => a?.type === 'refPoints/addCurrentRefPointMark')
  ).toBe(true);
}

function createMockGpsPoint(overrides?: Partial<GpsPoint>): GpsPoint {
  return {
    latitude: 49.0,
    longitude: 8.0,
    altitude: 100,
    accuracy: 5,
    altitudeAccuracy: 10,
    heading: null,
    speed: null,
    timestamp: Date.now(),
    ...overrides,
  } as GpsPoint;
}

function createMockArPose(): ARPose {
  return {
    position: { x: 1, y: 2, z: 3 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

function createDefaultDeps(
  overrides?: Partial<RefPointHandlersDeps>
): RefPointHandlersDeps {
  const gpsPoint = createMockGpsPoint();
  const store = createMockStore([gpsPoint]);
  return {
    getStore: () => store,
    getCurrentSessionName: () => 'recording-test-session',
    ...overrides,
  };
}

function createMockScenarioHandle(
  name = 'TestScenario'
): FileSystemDirectoryHandle {
  return { kind: 'directory', name } as unknown as FileSystemDirectoryHandle;
}

// â”€â”€ Test suites â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('createRefPointHandlers', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: The factory must return an object with all required handler functions
  // and state accessors, matching the contract used by main.ts.
  it('should return all handler functions and state accessors', () => {
    expect(handlers.handleMarkRefPoint).toBeTypeOf('function');
    expect(handlers.getImportedRefPoints).toBeTypeOf('function');
    expect(handlers.setImportedRefPoints).toBeTypeOf('function');
    expect(handlers.getSessionRefPointUsage).toBeTypeOf('function');
    expect(handlers.clearSessionRefPointUsage).toBeTypeOf('function');
    expect(handlers.reset).toBeTypeOf('function');
  });

  // Why: Default state must match the original module-level initialization.
  it('should initialize with default state', () => {
    expect(handlers.getImportedRefPoints()).toEqual([]);
    expect(handlers.getSessionRefPointUsage().size).toBe(0);
  });
});

// ============================================================================
// State management
// ============================================================================

describe('ref-point state management', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: Imported ref points must be settable (e.g., from folder import) and gettable
  it('should set and get imported ref points', () => {
    const refPoints: ImportedRefPoint[] = [
      {
        id: 'pointA',
        name: 'Point A',
        lat: 49.1,
        lon: 8.1,
        sourceZipName: 'session1.zip',
      },
      {
        id: 'pointB',
        name: 'Point B',
        lat: 49.2,
        lon: 8.2,
        sourceZipName: 'session2.zip',
      },
    ];
    handlers.setImportedRefPoints(refPoints);
    expect(handlers.getImportedRefPoints()).toEqual(refPoints);
  });

  // Why: Session usage tracking should be clearable between recordings.
  // We populate the map via handleMarkRefPoint, then verify clear empties it.
  it('should track and clear session ref point usage', async () => {
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });

    await handlers.handleMarkRefPoint();
    expect(handlers.getSessionRefPointUsage().size).toBeGreaterThan(0);
    // Usage is now keyed by H3 index (not picker name 'bench')
    const [h3Key] = [...handlers.getSessionRefPointUsage().keys()];
    expect(h3Key).toMatch(/^[0-9a-f]{15}$/);
    expect(handlers.getSessionRefPointUsage().get(h3Key)).toBe(1);

    handlers.clearSessionRefPointUsage();
    expect(handlers.getSessionRefPointUsage().size).toBe(0);
  });

  // Why: reset() must clear all state back to initial values, including
  // sessionRefPointUsage populated via handleMarkRefPoint (not just the
  // trivially-empty default).
  it('should reset all state', async () => {
    // Populate importedRefPoints
    handlers.setImportedRefPoints([
      { id: 'x', name: 'x', lat: 0, lon: 0, sourceZipName: 'z.zip' },
    ]);

    // Populate sessionRefPointUsage via a full handleMarkRefPoint flow
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });

    await handlers.handleMarkRefPoint();
    expect(handlers.getSessionRefPointUsage().size).toBe(1);

    handlers.reset();
    expect(handlers.getImportedRefPoints()).toEqual([]);
    expect(handlers.getSessionRefPointUsage().size).toBe(0);
  });
});

// ============================================================================
// handleMarkRefPoint â€” validation
// ============================================================================

describe('handleMarkRefPoint â€” validation', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset mock return values that may bleed from other tests
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(null);
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue(null);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: If the picker is already visible, duplicate calls must be ignored
  // to prevent overwriting the currentResolver (2026-02-27 Issue 2).
  it('should return early if picker is already visible', async () => {
    mockIsRefPointPickerVisible.mockReturnValue(true);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
  });

  // Why: AR pose is required to record odometry data for the ref point.
  it('should show error if AR pose is not available', async () => {
    mockGetCurrentArPose.mockReturnValue(null);

    await handlers.handleMarkRefPoint();

    expect(mockShowError).toHaveBeenCalledWith(
      'Cannot mark reference point - AR tracking not available'
    );
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
  });

  // Why: GPS data is required to geo-reference the ref point.
  it('should show error if no GPS data is available', async () => {
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    const emptyStore = createMockStore([]);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => emptyStore })
    );

    await handlers.handleMarkRefPoint();

    expect(mockShowError).toHaveBeenCalledWith(
      'Cannot mark reference point - no GPS data available'
    );
  });
});

// ============================================================================
// handleMarkRefPoint â€” picker integration
// ============================================================================

describe('handleMarkRefPoint â€” picker integration', () => {
  let handlers: RefPointHandlers;
  const mockArPose = createMockArPose();
  const mockGpsPoint = createMockGpsPoint();

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset mock return values
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue(null);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    const store = createMockStore([mockGpsPoint]);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
  });

  // Why: When imported refs are far from GPS (no nearby match), the picker
  // should show with empty suggestions (IDs are now H3 hex, meaningless to users).
  it('should show picker with empty suggestions when no nearby match', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue(['scenarioPoint']);
    mockShowRefPointPicker.mockResolvedValue({ id: 'MyNew', isNew: true });

    // Imported refs are far from GPS (49, 8) â€” won't match as re-observation
    handlers.setImportedRefPoints([
      {
        id: 'importedA',
        name: 'Imported A',
        lat: 10,
        lon: 20,
        sourceZipName: 'z.zip',
      },
      {
        id: 'scenarioPoint',
        name: 'Scenario Point',
        lat: 10,
        lon: 20,
        sourceZipName: 'z2.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0];
    // No suggestions â€” scenario IDs are H3 hex, imported names are for distant locations
    expect(passedIds).toEqual([]);
  });

  // Why: Even with no scenario handle, picker gets empty suggestions for new refs.
  it('should show picker with empty suggestions when no scenario handle and no nearby match', async () => {
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockShowRefPointPicker.mockResolvedValue({ id: 'NewRef', isNew: true });
    handlers.setImportedRefPoints([
      {
        id: 'importedOnly',
        name: 'importedOnly',
        lat: 10,
        lon: 20,
        sourceZipName: 'z.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0];
    expect(passedIds).toEqual([]);
  });

  // Why: When an imported ref point is near the current GPS position, the
  // handler should skip the picker and directly capture as a re-observation.
  it('should bypass picker when GPS matches an imported ref point', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);

    // Imported ref at same coords as GPS position (49, 8)
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    // Picker should NOT be shown
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
    // But the ref point should still be dispatched with H3 ID
    expect(mockMarkReferencePoint).toHaveBeenCalled();
    const payload = mockMarkReferencePoint.mock.calls[0][0] as { id: string };
    expect(payload.id).toMatch(/^[0-9a-f]{15}$/);
  });

  // Why: Re-observation should use the imported ref point's display name (not H3 index)
  // as the persisted display name, so users see the original name.
  it('should use imported ref point display name for re-observation', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);

    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const [, persistedId, persistedName] =
      mockSaveRefPointObservation.mock.calls[0];
    expect(persistedId).toMatch(/^[0-9a-f]{15}$/);
    expect(persistedName).toBe('Bank');
  });

  // Why: When picker returns null (cancelled), no dispatch or persist should happen.
  it('should return early if picker is cancelled', async () => {
    mockShowRefPointPicker.mockResolvedValue(null);

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).not.toHaveBeenCalled();
  });

  // Why: For new ref points (no nearby match), the picker should receive
  // an empty suggestion list since scenario IDs are now H3 hex strings
  // that are meaningless to users. The picker becomes a simple name input.
  it('should pass empty suggestions to picker for new ref points', async () => {
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue(['8b1f1a5c2e3d4f1']);
    mockShowRefPointPicker.mockResolvedValue({ id: 'My Point', isNew: true });

    // Imported refs far away â€” no nearby match, new ref point flow
    handlers.setImportedRefPoints([
      {
        id: 'FarAway',
        name: 'Far Away',
        lat: 10,
        lon: 20,
        sourceZipName: 'z.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalled();
    const passedIds = mockShowRefPointPicker.mock.calls[0][0];
    expect(passedIds).toEqual([]);
  });
});

// ============================================================================
// handleMarkRefPoint â€” dispatch, persist, visualize
// ============================================================================

describe('handleMarkRefPoint â€” full flow', () => {
  let handlers: RefPointHandlers;
  let mockStore: RecorderStore;
  const mockArPose = createMockArPose();
  const mockGpsPoint = createMockGpsPoint();

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly reset mock return values
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    mockStore = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => mockStore })
    );
  });

  // Why: The store must receive the markReferencePoint action with the correct payload.
  it('should dispatch markReferencePoint action', async () => {
    await handlers.handleMarkRefPoint();

    expect(mockStore.dispatch).toHaveBeenCalled();
  });

  // Why: The observation must be persisted to the scenario's refPoints/ directory.
  it('should persist ref point observation to disk', async () => {
    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const [handle, id, name] = mockSaveRefPointObservation.mock.calls[0];
    // ID is now H3 index, name is the picker-returned display text
    expect(id).toMatch(/^[0-9a-f]{15}$/);
    expect(name).toBe('bench');
    expect(handle).toBeDefined();
  });

  // Why: Re-observations should pass the picker name as display metadata.
  it('should use picker name as display name for existing ref points', async () => {
    mockShowRefPointPicker.mockResolvedValue({
      id: 'bench',
      isNew: false,
    });

    await handlers.handleMarkRefPoint();

    const name = mockSaveRefPointObservation.mock.calls[0][2];
    // Display name is now the raw picker text (no "Re-observation of" prefix)
    expect(name).toBe('bench');
  });

  // Why: The ref point must be visualized in the 3D scene. After Finding 5
  // (2026-04-30 plan) the visualization is driven by the Redux slice; the
  // call site dispatches addCurrentRefPointMark and the visualizer is
  // wired as a subscription consumer.
  it('should dispatch ref point to the store for visualization', async () => {
    await handlers.handleMarkRefPoint();

    expectCurrentRefPointDispatched(mockStore);
    const mark = getDispatchedCurrentMark(mockStore);
    // ID is now H3 index
    expect(mark.id).toMatch(/^[0-9a-f]{15}$/);
    expect(mark.odomPosition).toEqual([1, 2, 3]);
    expect(mark.odomRotation).toEqual([0, 0, 0, 1]);
  });

  // Why: The status bar must show the marked ref point's ID.
  it('should update status with marked ref point', async () => {
    await handlers.handleMarkRefPoint();

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.stringMatching(/^Marked reference point: [0-9a-f]{15}$/)
    );
  });

  // Why: Session usage count must be tracked for the picker's usage column.
  it('should track session ref point usage', async () => {
    await handlers.handleMarkRefPoint();

    const usage = handlers.getSessionRefPointUsage();
    // Usage is keyed by H3 index, not picker name
    expect(usage.size).toBe(1);
    const [h3Key] = [...usage.keys()];
    expect(h3Key).toMatch(/^[0-9a-f]{15}$/);
    expect(usage.get(h3Key)).toBe(1);
  });

  // Why: Multiple markings of the same ref point should increment the count.
  it('should increment usage count on repeated marking', async () => {
    await handlers.handleMarkRefPoint();
    await handlers.handleMarkRefPoint();

    const usage = handlers.getSessionRefPointUsage();
    const [h3Key] = [...usage.keys()];
    expect(usage.get(h3Key)).toBe(2);
  });

  // Why: If no scenario handle, persist should be skipped but dispatch/visualize still happen.
  it('should skip persist when no scenario handle', async () => {
    mockGetCurrentScenarioHandle.mockReturnValue(null);

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).not.toHaveBeenCalled();
    expect(mockStore.dispatch).toHaveBeenCalled();
    expectCurrentRefPointDispatched(mockStore);
  });
});

// ============================================================================
// handleMarkRefPoint â€” concurrent call prevention
// ============================================================================

describe('handleMarkRefPoint â€” concurrent call prevention', () => {
  // Why: Two rapid taps on "Mark Reference Point" must not both proceed.
  // The synchronous lock prevents the second call from entering the async section.
  it('should block concurrent calls via synchronous lock', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);

    // Make showRefPointPicker slow to widen the race window
    let resolveShowPicker!: (
      value: { id: string; isNew: boolean } | null
    ) => void;
    mockShowRefPointPicker.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveShowPicker = resolve;
        })
    );

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Launch two concurrent calls (simulates rapid double tap)
    const call1 = handlers.handleMarkRefPoint();
    const call2 = handlers.handleMarkRefPoint();

    // Resolve the first call's showRefPointPicker
    resolveShowPicker({ id: 'point1', isNew: true });

    await call1;
    await call2;

    // showRefPointPicker should only be called ONCE (the second call was blocked)
    expect(mockShowRefPointPicker).toHaveBeenCalledTimes(1);
  });

  // Why: After a call completes (even with error), the lock must be released.
  it('should release lock after completion', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentScenarioHandle.mockReturnValue(null);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue(null);
    mockGetCurrentArPose.mockReturnValue(null); // Will fail validation
    const handlers = createRefPointHandlers(createDefaultDeps());

    await handlers.handleMarkRefPoint(); // First call fails
    mockGetCurrentArPose.mockReturnValue(createMockArPose());

    // Second call should not be blocked
    await handlers.handleMarkRefPoint();
    // It should proceed (showError for first, then proceed for second)
    expect(mockShowError).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// handleMarkRefPoint â€” re-observation cooldown
// ============================================================================

describe('handleMarkRefPoint â€” re-observation cooldown', () => {
  /**
   * Why: Rapid double-taps on the re-observation button produce duplicate
   * markings for the same H3 cell (Aachen audit Issue 3). A per-cell cooldown
   * prevents accidental duplicates while still allowing intentional re-marks
   * after the cooldown expires.
   */
  it('should ignore a re-observation within the cooldown period', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Import a ref point at the GPS position (49, 8) â†’ re-observation path
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // First re-observation should succeed
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(1);

    // Second re-observation within cooldown should be silently ignored
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(1); // Still 1
  });

  it('should allow re-observation after cooldown expires', async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // First mark
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(1);

    // Advance past the cooldown (10 seconds)
    vi.advanceTimersByTime(11_000);

    // Second mark should now succeed
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should not apply cooldown to new ref points (picker path)', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockShowRefPointPicker.mockResolvedValue({ id: 'New Point', isNew: true });

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // No imported ref points â†’ new ref point flow (picker shown)
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(1);

    // Second new ref point should still work immediately
    mockShowRefPointPicker.mockResolvedValue({
      id: 'Another Point',
      isNew: true,
    });
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(2);
  });

  // Why: reset() must clear the per-H3-cell cooldown map so that cooldown
  // state does not leak between recording sessions when the handler instance
  // is reused (Aachen audit Issue 3 follow-up).
  it('should clear re-observation cooldown on reset()', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    // Import a ref point at the GPS position â†’ re-observation path
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // First re-observation should succeed
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(1);

    // Cooldown is now active â€” second call should be ignored
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(1);

    // Reset should clear cooldown state
    handlers.reset();

    // Re-import ref points (reset clears them)
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);

    // Re-observation should succeed immediately after reset (no cooldown)
    await handlers.handleMarkRefPoint();
    expect(mockMarkReferencePoint).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// buildRefPointObservation â€” unit test
// ============================================================================

describe('buildRefPointObservation (via handleMarkRefPoint)', () => {
  // Why: The observation must include sessionId from getCurrentSessionName dep.
  it('should build observation with correct sessionId', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'bench', isNew: true });
    mockExtractOdomPosition.mockReturnValue([10, 20, 30] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0.1, 0.2, 0.3, 0.9] as Quaternion);

    const handlers = createRefPointHandlers(
      createDefaultDeps({
        getStore: () => store,
        getCurrentSessionName: () => 'recording-2026-03-05',
      })
    );

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.sessionId).toBe('recording-2026-03-05');
    expect(observation.arPose.position).toEqual([10, 20, 30]);
    expect(observation.arPose.rotation).toEqual([0.1, 0.2, 0.3, 0.9]);
    expect(observation.gpsPoint).toBe(mockGpsPoint);
  });
});

// ============================================================================
// H3-based reference point IDs
// ============================================================================

describe('handleMarkRefPoint â€” H3-based ID', () => {
  // Why: The naming bug (docs/2026-03-08-ref-point-naming-investigation.md)
  // showed that user-entered names are unreliable on mobile. The ref point ID
  // must be the H3 resolution-11 hex index computed from the GPS at capture
  // time, NOT the string the user typed in the picker. The picker-returned
  // name becomes optional display metadata only.

  let handlers: RefPointHandlers;
  let mockStore: RecorderStore;

  // GPS position for Loc 2 from the investigation (50.7475, 6.4812)
  const testGpsPoint = createMockGpsPoint({
    latitude: 50.7475,
    longitude: 6.4812,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockStore = createMockStore([testGpsPoint]);
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => mockStore })
    );
  });

  it('should use H3 index as the dispatched ref point ID, not the picker name', async () => {
    // User types "Bank" in the picker, but the ID must be the H3 index
    mockShowRefPointPicker.mockResolvedValue({ id: 'Bank', isNew: true });

    await handlers.handleMarkRefPoint();

    // The dispatched action must use the H3 index, not "Bank"
    expect(mockMarkReferencePoint).toHaveBeenCalled();
    const payload = mockMarkReferencePoint.mock.calls[0][0] as { id: string };
    // H3 res-11 indices are 15-char hex strings
    expect(payload.id).toMatch(/^[0-9a-f]{15}$/);
    expect(payload.id).not.toBe('Bank');
  });

  it('should persist the ref point using H3 index as ID and picker name as display name', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'Bank', isNew: true });

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const [, persistedId, persistedName] =
      mockSaveRefPointObservation.mock.calls[0];
    // ID = H3 index (not "Bank")
    expect(persistedId).toMatch(/^[0-9a-f]{15}$/);
    // Display name = what the user typed
    expect(persistedName).toBe('Bank');
  });

  it('should produce the same H3 ID for the same GPS coordinates', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'Name1', isNew: true });
    await handlers.handleMarkRefPoint();

    const id1 = (mockMarkReferencePoint.mock.calls[0][0] as { id: string }).id;

    // Reset and mark again at the same GPS position but with different user name
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);

    mockShowRefPointPicker.mockResolvedValue({ id: 'Name2', isNew: true });
    await handlers.handleMarkRefPoint();

    const id2 = (mockMarkReferencePoint.mock.calls[0][0] as { id: string }).id;
    expect(id1).toBe(id2);
  });

  it('should visualize ref point with H3 index as ID', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'MyRef', isNew: true });

    await handlers.handleMarkRefPoint();

    const mark = getDispatchedCurrentMark(mockStore);
    expect(mark.id).toMatch(/^[0-9a-f]{15}$/);
    expect(mark.id).not.toBe('MyRef');
  });

  it('should track session usage by H3 index, not picker name', async () => {
    mockShowRefPointPicker.mockResolvedValue({ id: 'Bank', isNew: true });

    await handlers.handleMarkRefPoint();

    const usage = handlers.getSessionRefPointUsage();
    expect(usage.has('Bank')).toBe(false);
    // Should have exactly one entry keyed by the H3 index
    expect(usage.size).toBe(1);
    const [key] = [...usage.keys()];
    expect(key).toMatch(/^[0-9a-f]{15}$/);
  });
});

/**
 * Tests for checkNearbyRefPoint.
 *
 * Why these tests matter:
 * The live ref point button needs to reactively show the name of a nearby
 * known ref point as the user walks. checkNearbyRefPoint is the bridge
 * between the GPS subscription and the button label update.
 * See: docs/2026-03-21-live-ref-point-button-plan.md, Change B.
 */
describe('checkNearbyRefPoint', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    const deps = createDefaultDeps();
    handlers = createRefPointHandlers(deps);
  });

  /**
   * Why this test matters:
   * When the user is near a known imported ref point, the method should
   * return an info object with its display name so the button label can be updated.
   */
  it('returns display name when within gridDisk of an imported ref point', () => {
    // Set imported ref points at a known location
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // Check from the same location â€” should match
    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result?.displayName).toBe('Bank');
  });

  /**
   * Why this test matters:
   * When the user is far from any known ref point, the method should
   * return undefined so the button reverts to the default label.
   */
  it('returns undefined when far from any imported ref point', () => {
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // Check from a distant location (~111 km away) â€” should not match
    const result = handlers.checkNearbyRefPoint(50.0, 9.0);
    expect(result).toBeUndefined();
  });

  /**
   * Why this test matters:
   * When no ref points have been imported, the method should always
   * return undefined regardless of position.
   */
  it('returns undefined when no imported ref points exist', () => {
    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result).toBeUndefined();
  });

  /**
   * Why this test matters:
   * After reset(), imported ref points are cleared, so proximity
   * checks should return undefined.
   */
  it('returns undefined after reset', () => {
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    handlers.reset();

    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result).toBeUndefined();
  });

  /**
   * Regression: cache invalidation on setImportedRefPoints.
   *
   * Why this test matters:
   * knownRefPoints are cached eagerly when setImportedRefPoints is called.
   * If someone removes the cache invalidation, the old ref points would
   * still be returned after updating â€” this test catches that.
   */
  it('reflects updated ref points after a second setImportedRefPoints call', () => {
    // Initial set: "Bank" at (49.0, 8.0)
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);
    expect(handlers.checkNearbyRefPoint(49.0, 8.0)?.displayName).toBe('Bank');

    // Replace with "Library" at a completely different location
    handlers.setImportedRefPoints([
      {
        id: 'Library',
        name: 'Library',
        lat: 52.0,
        lon: 13.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // Old location should no longer match
    expect(handlers.checkNearbyRefPoint(49.0, 8.0)).toBeUndefined();
    // New location should match
    expect(handlers.checkNearbyRefPoint(52.0, 13.0)?.displayName).toBe(
      'Library'
    );
  });

  /**
   * Regression: gpsToH3 is not recomputed on every checkNearbyRefPoint call.
   *
   * Why this test matters:
   * checkNearbyRefPoint is called at ~1 Hz from the GPS subscription.
   * The H3 indices for imported ref points are deterministic and only
   * change when setImportedRefPoints is called. This test verifies that
   * repeated proximity checks return consistent results without relying
   * on re-mapping â€” if the cache were accidentally removed, the test
   * still passes behaviorally but documents the expected invariant.
   */
  it('returns consistent results across many rapid calls', () => {
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
      {
        id: 'Church',
        name: 'Church',
        lat: 49.001,
        lon: 8.001,
        sourceZipName: 'test.zip',
      },
    ]);

    // Simulate ~5 seconds of 1 Hz GPS updates at the same position
    for (let i = 0; i < 5; i++) {
      expect(handlers.checkNearbyRefPoint(49.0, 8.0)?.displayName).toBe('Bank');
    }
  });
});

// ============================================================================
// fusedGpsPoint in observation (Step 2 â€” prior ref points plan)
// ============================================================================

describe('buildRefPointObservation â€” fusedGpsPoint', () => {
  // Identity matrix â€” transforms odom position 1:1 to aligned position
  const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function setupFullFlowMocks(alignmentMatrix: number[] | null = null) {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint], {
      alignmentMatrix: alignmentMatrix ?? undefined,
    });
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'marker', isNew: true });
    mockExtractOdomPosition.mockReturnValue([5, 10, 15] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockCalcGpsCoords.mockReturnValue({ lat: 49.123, lon: 8.456 });
    mockFusedGpsFromOdom.mockReturnValue({ lat: 49.123, lon: 8.456 });
    return { store };
  }

  // Why: When the alignment matrix is available at mark time,
  // the observation should include a fused GPS position computed from
  // fusedGpsFromOdom(alignmentMatrix, odomPosition, zeroRef).
  it('should include fusedGpsPoint when alignment matrix is available', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeDefined();
    expect(observation.fusedGpsPoint!.latitude).toBe(49.123);
    expect(observation.fusedGpsPoint!.longitude).toBe(8.456);
  });

  // Why: Legacy recordings may not have an alignment matrix at mark time.
  // The observation should omit fusedGpsPoint gracefully.
  it('should omit fusedGpsPoint when alignment matrix is null', async () => {
    const { store } = setupFullFlowMocks(null);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockSaveRefPointObservation).toHaveBeenCalled();
    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeUndefined();
  });

  // Why: fusedGpsFromOdom must receive the alignment matrix, NUE odom position,
  // and zero reference. The odom position from extractOdomPosition is raw WebXR,
  // so it must be converted via webxrToNUE before being passed to fusedGpsFromOdom.
  it('should call fusedGpsFromOdom with alignmentMatrix, NUE odomPosition, zeroRef', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockFusedGpsFromOdom).toHaveBeenCalledTimes(1);
    // First arg: alignment matrix
    expect(mockFusedGpsFromOdom.mock.calls[0][0]).toEqual(IDENTITY_MATRIX);
    // Second arg: odom position converted to NUE via webxrToNUE([5, 10, 15]) = [-15, 10, 5]
    expect(mockFusedGpsFromOdom.mock.calls[0][1]).toEqual([-15, 10, 5]);
    // Third arg: zero reference from store
    expect(mockFusedGpsFromOdom.mock.calls[0][2]).toEqual({
      lat: 49.0,
      lng: 8.0,
    });
  });

  // Why: Without alignment matrix, fusedGpsFromOdom should not be called â€”
  // there is no fused GPS to compute.
  it('should not call fusedGpsFromOdom when alignment matrix is absent', async () => {
    const { store } = setupFullFlowMocks(null);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expect(mockFusedGpsFromOdom).not.toHaveBeenCalled();
  });

  // Why: When fusedGpsFromOdom returns altitude (origin has altitude),
  // the observation's fusedGpsPoint must include it â€” otherwise altitude
  // from the aligned VIO pipeline is silently lost.
  it('should include altitude when fusedGpsFromOdom returns it', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    mockFusedGpsFromOdom.mockReturnValue({
      lat: 49.123,
      lon: 8.456,
      altitude: 150.5,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeDefined();
    expect(observation.fusedGpsPoint!.altitude).toBe(150.5);
  });

  // Why: fusedGpsFromOdom expects NUE-convention input because the alignment
  // matrix is computed from NUE state data. Passing raw WebXR swaps axes.
  // webxrToNUE([x,y,z]) = [-z, y, x], so [10, 5, -3] â†’ [3, 5, 10].
  it('should convert odomPosition to NUE before calling fusedGpsFromOdom', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    // Override with asymmetric values to detect axis swap
    mockExtractOdomPosition.mockReturnValue([10, 5, -3] as Vector3);

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    await handlers.handleMarkRefPoint();

    expect(mockFusedGpsFromOdom).toHaveBeenCalledTimes(1);
    // webxrToNUE([10, 5, -3]) = [-(-3), 5, 10] = [3, 5, 10]
    expect(mockFusedGpsFromOdom.mock.calls[0][1]).toEqual([3, 5, 10]);
  });

  // Why: When the GPS origin has no altitude, fusedGpsFromOdom returns
  // altitude: undefined. The observation must reflect that (not NaN, not 0).
  it('should have undefined altitude when fusedGpsFromOdom returns no altitude', async () => {
    const { store } = setupFullFlowMocks(IDENTITY_MATRIX);
    mockFusedGpsFromOdom.mockReturnValue({
      lat: 49.123,
      lon: 8.456,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const observation: RefPointObservation =
      mockSaveRefPointObservation.mock.calls[0][3];
    expect(observation.fusedGpsPoint).toBeDefined();
    expect(observation.fusedGpsPoint!.altitude).toBeUndefined();
  });
});

// ============================================================================
// Current-session visualization â€” prefer fused GPS over raw
// ============================================================================

/**
 * Why these tests matter: the red sphere shown immediately after marking
 * must sit at the same spot where a future session's green sphere will
 * appear. The saved observation already carries fusedGpsPoint (Â§7 of
 * 2026-04-24-refpoint-positioning-investigation.md), and the loader now
 * prefers fused â€” so the in-session visualizer must match. Otherwise the
 * red sphere jumps position the next time the scenario is opened.
 */
describe('visualizeRefPoint â€” prefers fused GPS', () => {
  const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function setup(alignmentMatrix: number[] | null) {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    const store = createMockStore([createMockGpsPoint()], {
      alignmentMatrix: alignmentMatrix ?? undefined,
    });
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockListRefPointIds.mockResolvedValue([]);
    mockShowRefPointPicker.mockResolvedValue({ id: 'marker', isNew: true });
    mockExtractOdomPosition.mockReturnValue([5, 10, 15] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    return { store };
  }

  // Raw GPS from createMockGpsPoint is (49.0, 8.0). Fused below is (49.5, 8.5)
  // so the two sources are distinguishable.
  it('uses fused lat/lon for the current-session sphere when alignment is available', async () => {
    const { store } = setup(IDENTITY_MATRIX);
    mockFusedGpsFromOdom.mockReturnValue({
      lat: 49.5,
      lon: 8.5,
      altitude: 123,
    });
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    expectCurrentRefPointDispatched(store);
    const mark = getDispatchedCurrentMark(store);
    expect(mark.gpsPosition).toEqual({
      lat: 49.5,
      lon: 8.5,
      altitude: 123,
    });
  });

  it('falls back to raw lat/lon when no alignment matrix is available', async () => {
    const { store } = setup(null);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );

    await handlers.handleMarkRefPoint();

    const mark = getDispatchedCurrentMark(store);
    // createMockGpsPoint() raw GPS is (49.0, 8.0)
    expect(mark.gpsPosition?.lat).toBe(49.0);
    expect(mark.gpsPosition?.lon).toBe(8.0);
    // fusedGpsFromOdom must not have been called in this path
    expect(mockFusedGpsFromOdom).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Part B: isNeighborCell detection + forceNew (2026-04-18)
// ============================================================================

/**
 * Tests for checkNearbyRefPoint neighbor-cell detection.
 *
 * Why these tests matter:
 * The secondary "+" button should only appear when the user is in a
 * neighboring H3 cell (gridDisk match, different center cell) of a known
 * ref point. isNeighborCell drives the visibility of this button.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
describe('checkNearbyRefPoint â€” isNeighborCell', () => {
  let handlers: RefPointHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = createRefPointHandlers(createDefaultDeps());
  });

  // Why: When the user is in the exact same H3 cell as the ref point,
  // isNeighborCell should be false (no need to add a new ref point here).
  it('returns isNeighborCell=false when in the same center cell', () => {
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    const result = handlers.checkNearbyRefPoint(49.0, 8.0);
    expect(result).toBeDefined();
    expect(result!.isNeighborCell).toBe(false);
  });

  // Why: When the user is in a neighbor cell (within gridDisk but different
  // center cell), isNeighborCell should be true. At H3 res-11, a shift of
  // ~0.0003Â° (~33m) should land in a neighbor cell while still in the gridDisk.
  it('returns isNeighborCell=true when in a neighbor gridDisk cell', () => {
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    // ~33m north â€” should be in a neighbor cell at H3 res-11 (~25m edge)
    const result = handlers.checkNearbyRefPoint(49.0003, 8.0);
    expect(result).toBeDefined();
    expect(result!.displayName).toBe('Bank');
    expect(result!.isNeighborCell).toBe(true);
  });

  // Why: When the user is far away (no match), undefined should be returned,
  // even with the new return type.
  it('returns undefined when outside all gridDisk zones', () => {
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    const result = handlers.checkNearbyRefPoint(50.0, 9.0);
    expect(result).toBeUndefined();
  });
});

/**
 * Tests for handleMarkRefPoint with forceNew option.
 *
 * Why these tests matter:
 * The "+" button calls handleMarkRefPoint({ forceNew: true }) to bypass
 * the re-observation fast-path and show the picker for a new ref point
 * even when the user is near a known one.
 * See: docs/2026-04-18-ref-point-proximity-button-improvements.md, Part B.
 */
describe('handleMarkRefPoint â€” forceNew', () => {
  // Why: When forceNew is true and re-observation would normally
  // fire, the picker should be shown instead of skipping.
  it('shows picker when forceNew=true even near a known ref point', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockGpsPoint = createMockGpsPoint({ latitude: 49.0, longitude: 8.0 });
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    mockShowRefPointPicker.mockResolvedValue({ id: 'NewPoint', isNew: true });

    const handlers = createRefPointHandlers({
      getStore: () => store,
      getCurrentSessionName: () => 'test-session',
    });

    // Import a ref point at the user's location â€” normally would trigger re-observation
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    await handlers.handleMarkRefPoint({ forceNew: true });

    // Picker should have been shown (forceNew bypassed re-observation)
    expect(mockShowRefPointPicker).toHaveBeenCalledOnce();
  });

  // Why: Without forceNew, the same scenario should NOT show the picker
  // because re-observation kicks in.
  it('skips picker without forceNew when near a known ref point', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockGpsPoint = createMockGpsPoint({ latitude: 49.0, longitude: 8.0 });
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());

    const handlers = createRefPointHandlers({
      getStore: () => store,
      getCurrentSessionName: () => 'test-session',
    });

    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'test.zip',
      },
    ]);

    await handlers.handleMarkRefPoint();

    // Picker should NOT have been shown (re-observation path)
    expect(mockShowRefPointPicker).not.toHaveBeenCalled();
  });
});

// ============================================================================
// handleMarkRefPoint â€” re-observation toast feedback (Finding 3)
// ============================================================================

/**
 * Why these tests matter
 * ----------------------
 * Field test 2026-04-29 â€” Finding 3 in
 * `GpsPlusSlamJs_Docs/docs/2026-04-29-ref-points-user-feedback.md`: pressing
 * the capture button gives no visible feedback when the press lands on the
 * single-click re-observation branch (no picker is shown, so the user has no
 * confirmation that anything happened).
 *
 * Decision: show a toast **only** on the re-observation branch. The
 * picker-driven path (new ref point) already has implicit feedback via the
 * picker UI. The toast must fire after the on-disk persistence has settled
 * so it reflects the durable end state.
 */
describe('handleMarkRefPoint â€” re-observation toast feedback', () => {
  function setupReObservationFixture() {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    const mockArPose = createMockArPose();
    const mockGpsPoint = createMockGpsPoint();
    mockGetCurrentArPose.mockReturnValue(mockArPose);
    const store = createMockStore([mockGpsPoint]);
    const handle = createMockScenarioHandle();
    mockGetCurrentScenarioHandle.mockReturnValue(handle);
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    handlers.setImportedRefPoints([
      {
        id: 'Bank',
        name: 'Bank',
        lat: 49.0,
        lon: 8.0,
        sourceZipName: 'prev.zip',
      },
    ]);
    return { handlers, store };
  }

  it('shows a toast naming the ref point on a single-click re-observation', async () => {
    const { handlers } = setupReObservationFixture();

    await handlers.handleMarkRefPoint();

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [message] = mockShowToast.mock.calls[0];
    expect(message).toContain('Bank');
  });

  it('fires the toast after the OPFS write resolves (durable state)', async () => {
    const { handlers } = setupReObservationFixture();

    // Order observers: capture call sequence across persist + toast.
    const callOrder: string[] = [];
    mockSaveRefPointObservation.mockImplementation(() => {
      callOrder.push('save');
      return Promise.resolve();
    });
    mockShowToast.mockImplementation(() => {
      callOrder.push('toast');
    });

    await handlers.handleMarkRefPoint();

    expect(callOrder).toEqual(['save', 'toast']);
  });

  it('does NOT show a toast on the picker-driven new ref point path', async () => {
    vi.clearAllMocks();
    mockIsRefPointPickerVisible.mockReturnValue(false);
    mockGetCurrentArPose.mockReturnValue(createMockArPose());
    const store = createMockStore([createMockGpsPoint()]);
    mockGetCurrentScenarioHandle.mockReturnValue(createMockScenarioHandle());
    mockExtractOdomPosition.mockReturnValue([1, 2, 3] as Vector3);
    mockExtractOdomRotation.mockReturnValue([0, 0, 0, 1] as Quaternion);
    mockShowRefPointPicker.mockResolvedValue({ id: 'New Point', isNew: true });

    const handlers = createRefPointHandlers(
      createDefaultDeps({ getStore: () => store })
    );
    // No imported ref points near GPS â†’ picker path
    await handlers.handleMarkRefPoint();

    expect(mockShowRefPointPicker).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does NOT show a toast when re-observation is rejected by the cooldown', async () => {
    const { handlers } = setupReObservationFixture();

    await handlers.handleMarkRefPoint();
    expect(mockShowToast).toHaveBeenCalledTimes(1);

    // Second tap inside the 10s cooldown window
    await handlers.handleMarkRefPoint();
    // Still only the first toast â€” cooldown rejections are silent
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('does NOT show a toast when the OPFS write fails', async () => {
    const { handlers } = setupReObservationFixture();
    mockSaveRefPointObservation.mockRejectedValueOnce(new Error('disk full'));

    await handlers.handleMarkRefPoint();

    // showError is the existing failure feedback channel
    expect(mockShowError).toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
