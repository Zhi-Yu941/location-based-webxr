/**
 * Recorder-app-specific global TypeScript declarations.
 *
 * These extensions are used for E2E testing with Playwright, allowing tests to
 * call real application functions instead of simulating DOM interactions.
 *
 * NOTE: These hooks are only assigned in development mode (import.meta.env.DEV)
 * and are not assigned during unit tests (import.meta.env.VITEST is truthy).
 *
 * File System Access API types and common global declarations are provided by
 * gps-plus-slam-app-framework/types/global.d.ts.
 */

import type { RefPointPickerResult } from './ui/ref-point-picker';
import type { PermissionCheckResult } from 'gps-plus-slam-app-framework/sensors/permission-checker';
import type { TrackingQualityReport } from 'gps-plus-slam-app-framework';
import type { SessionSummaryData } from './ui/session-summary';

declare global {
  var __BUILD_COMMIT__: string | undefined;
  var __BUILD_TIME__: string | undefined;
  var __APP_VERSION__: string | undefined;
  var __LIB_VERSION__: string | undefined;
  var __FW_VERSION__: string | undefined;

  interface Window {
    /**
     * Test hooks exposed for Playwright E2E tests.
     * Only available in dev mode, not in unit tests or production.
     */
    testHooks?: {
      populateScenarios: (scenarios: string[]) => void;
      validateEnterButton: () => void;
      showRecordingControls: () => void;
      hideRecordingControls: () => void;
      showSessionSummary: (data: SessionSummaryData) => void;
      updateGpsInfo: (accuracy: number) => void;
      updateArInfo: (tracking: string) => void;
      updatePermissionStatus: (result: PermissionCheckResult) => void;
      setPermissionsReady: (ready: boolean) => void;
      // Log panel hooks (Issue #5)
      showLogPanel: () => void;
      hideLogPanel: () => void;
      toggleLogPanel: () => void;
      logInfo: (tag: string, message: string) => void;
      logWarn: (tag: string, message: string) => void;
      logError: (tag: string, message: string) => void;
      // GPS event visualization hooks
      getGpsEventVisualizerCounts: () => { raw: number; fused: number };
      setGpsEventVisualizerZeroRef: (lat: number, lng: number) => void;
      clearGpsEventVisualizer: () => void;
      /**
       * §3c — Replay-mode diagnostic. Adds a GPS event with optional 1σ
       * accuracy to the visualizer. Creates an offline scene + arWorldGroup
       * via `setSceneForTesting` so the visualizer can run without an
       * active WebXR session.
       */
      addGpsEventForTest: (
        gpsCoords: [number, number, number],
        odomPosition: [number, number, number],
        accuracy?: { horizontal?: number; vertical?: number }
      ) => void;
      /**
       * §3c — Reads back the world-space bounding-box size of each raw-GPS
       * marker via `THREE.Box3.setFromObject` in insertion order.
       */
      getRawGpsMarkerWorldSizes: () => Array<{
        x: number;
        y: number;
        z: number;
      }>;
      // Tracking quality indicator hook
      updateTrackingQuality: (report: TrackingQualityReport) => void;
      // Mandatory storage selection hooks (Task 1a-fix)
      setFolderSelected: (selected: boolean) => void;
      setSaveLocationSelected: (selected: boolean) => void;
    };

    /**
     * Reference point picker API exposed for E2E testing.
     * Allows Playwright tests to trigger the real picker modal behavior.
     */
    refPointPickerApi?: {
      showRefPointPicker: (
        existingIds: string[]
      ) => Promise<RefPointPickerResult | null>;
    };
  }
}

// This export is required to make this file a module
export {};
