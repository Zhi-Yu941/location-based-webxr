/**
 * Shared Test Helpers for Playwright E2E Tests
 *
 * This module consolidates commonly used helper functions across multiple
 * test files to reduce code duplication and improve maintainability.
 *
 * Why this file exists: Multiple spec files (enter-ar-flow, setup-modal,
 * test-hooks-verification) contained duplicated helper functions for common
 * operations like setting storage/permission states. Centralizing them ensures
 * consistent behavior and easier maintenance.
 */

/**
 * Default timeout (ms) for waitForFunction calls that wait for testHooks.
 *
 * Why this constant exists: Centralises the timeout so every helper and
 * spec file uses the same value. Changing it in one place updates all
 * waitForFunction calls.  The value must cover the slowest observed
 * Vite-module-graph evaluation time (see GpsPlusSlamJs_Docs/docs/implementation-progress.md
 * for measured baselines).
 *
 * Measured baselines (Feb 2026):
 *   - Typical: 100-200 ms, Max observed: ~350 ms
 *   - 5 000 ms gives a ~14× safety margin over worst case.
 *   - If this ever fires, investigate module-load time rather than
 *     increasing the value — see root-cause analysis in progress docs.
 */
export const TEST_HOOKS_TIMEOUT_MS = 5_000;

/**
 * Inject a fake `navigator.xr` so the app sees WebXR as "supported" and
 * stays in recording mode instead of switching to replay mode.
 *
 * MUST be called BEFORE `page.goto('/')` — `addInitScript` runs before any
 * page script so the fake is in place when `checkAllPermissions()` probes
 * `navigator.xr.isSessionSupported('immersive-ar')`.
 *
 * Why this helper exists: Playwright's Chromium does not support WebXR.
 * Without this fake, the app enters replay mode on every page load, hiding
 * recording-specific UI elements (settings button, enter-AR flow, etc.) and
 * causing all recording-UI e2e tests to time out.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function fakeWebXRSupport(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'xr', {
      value: {
        isSessionSupported: () => Promise.resolve(true),
        requestSession: () =>
          Promise.reject(
            new Error('Fake WebXR — session not available in Playwright')
          ),
      },
      writable: true,
      configurable: true,
    });
  });
}

/**
 * Helper that calls the real populateScenarios function via window.testHooks.
 * This ensures we're testing the actual app behavior, not a simulation.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string[]} scenarios - Array of existing scenario names
 */
export async function callRealPopulateScenarios(page, scenarios) {
  // Wait for test hooks to be available (they're set up asynchronously)
  await page.waitForFunction(() => window.testHooks?.populateScenarios, {
    timeout: TEST_HOOKS_TIMEOUT_MS,
  });

  await page.evaluate((scenarioList) => {
    window.testHooks.populateScenarios(scenarioList);
  }, scenarios);
}

/**
 * Helper to set permissions as ready via testHooks.
 * This simulates the user granting all required device permissions.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.validate=true] - Whether to call validateEnterButton after setting
 */
export async function setPermissionsReady(page, { validate = true } = {}) {
  await page.waitForFunction(() => window.testHooks?.setPermissionsReady, {
    timeout: TEST_HOOKS_TIMEOUT_MS,
  });
  await page.evaluate((shouldValidate) => {
    window.testHooks.setPermissionsReady(true);
    if (shouldValidate) {
      window.testHooks.validateEnterButton();
    }
  }, validate);
}

/**
 * Helper to set mandatory storage as selected via testHooks.
 * This simulates completing the two-step storage setup (Task 1a-fix).
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.validate=true] - Whether to call validateEnterButton after setting
 */
export async function setStorageReady(page, { validate = true } = {}) {
  await page.waitForFunction(() => window.testHooks?.setFolderSelected, {
    timeout: TEST_HOOKS_TIMEOUT_MS,
  });
  await page.evaluate((shouldValidate) => {
    window.testHooks.setFolderSelected(true);
    window.testHooks.setSaveLocationSelected(true);
    if (shouldValidate) {
      window.testHooks.validateEnterButton();
    }
  }, validate);
}

/**
 * Wait for core testHooks to be available.
 * Use this in beforeEach when tests depend on testHooks being ready.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function waitForTestHooks(page) {
  await page.waitForFunction(
    () =>
      window.testHooks?.populateScenarios &&
      window.testHooks?.showRecordingControls &&
      window.testHooks?.hideRecordingControls &&
      window.testHooks?.showSessionSummary &&
      window.testHooks?.updateGpsInfo &&
      window.testHooks?.updateArInfo &&
      window.testHooks?.validateEnterButton &&
      window.testHooks?.updatePermissionStatus &&
      window.testHooks?.setPermissionsReady &&
      // Log panel hooks (Issue #5)
      window.testHooks?.showLogPanel &&
      window.testHooks?.hideLogPanel &&
      window.testHooks?.toggleLogPanel &&
      window.testHooks?.logInfo &&
      window.testHooks?.logWarn &&
      window.testHooks?.logError &&
      // GPS event visualizer hooks
      window.testHooks?.getGpsEventVisualizerCounts &&
      window.testHooks?.setGpsEventVisualizerZeroRef &&
      window.testHooks?.clearGpsEventVisualizer &&
      // GPS accuracy ellipsoid hooks (§3c)
      window.testHooks?.addGpsEventForTest &&
      window.testHooks?.getRawGpsMarkerWorldSizes &&
      // Tracking quality indicator hook (F1)
      window.testHooks?.updateTrackingQuality &&
      // Mandatory storage selection hooks (Task 1a-fix)
      window.testHooks?.setFolderSelected &&
      window.testHooks?.setSaveLocationSelected,
    { timeout: TEST_HOOKS_TIMEOUT_MS }
  );
}

/**
 * Wait for specific testHooks to be available.
 * Prefer this over a local waitForFunction when a spec only needs a
 * subset of hooks — it keeps the timeout centralised.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(hooks: Record<string, unknown>) => boolean} predicate
 *   Function evaluated in the browser context that receives
 *   `window.testHooks` and returns `true` when the required hooks exist.
 */
export async function waitForTestHooksSubset(page, predicate) {
  await page.waitForFunction(predicate, { timeout: TEST_HOOKS_TIMEOUT_MS });
}
