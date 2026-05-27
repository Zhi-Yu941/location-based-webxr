import { test, expect } from '@playwright/test';
import {
  fakeWebXRSupport,
  setPermissionsReady,
  setStorageReady,
  waitForTestHooks,
} from './test-helpers.js';

/**
 * Test Hooks Verification Tests
 *
 * These tests verify that window.testHooks functions produce the same
 * observable outcomes as real user interactions. This guards against
 * the test hooks diverging from actual application behavior.
 *
 * Why this test matters: If testHooks and real user flows diverge,
 * our e2e tests could pass while real users experience bugs.
 * See docs/2026-01-23-e2e-test-problems.md for background.
 */

test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  await waitForTestHooks(page);
});

test.describe('Test Hooks Match Real Behavior', () => {
  test('populateScenarios via testHook matches expected DOM state', async ({
    page,
  }) => {
    // Call the real function via testHooks
    await page.evaluate(() => {
      window.testHooks.populateScenarios(['Scenario A', 'Scenario B']);
    });

    // Verify the dropdown has the expected structure
    const dropdown = page.locator('#scenario-select');
    await expect(dropdown).toBeEnabled();

    // Should have: "New Scenario" + our 2 scenarios = 3 options
    // (no placeholder - first existing scenario is auto-selected)
    const options = dropdown.locator('option');
    await expect(options).toHaveCount(3);

    // Verify option values match what a user would see
    await expect(options.nth(0)).toHaveText('+ Create new scenario');
    await expect(options.nth(1)).toHaveText('Scenario A');
    await expect(options.nth(2)).toHaveText('Scenario B');

    // First existing scenario should be auto-selected
    await expect(dropdown).toHaveValue('Scenario A');
  });

  test('showRecordingControls via testHook produces correct button visibility', async ({
    page,
  }) => {
    // Initial state: start visible, stop/ref hidden
    const startBtn = page.locator('#btn-start');
    const stopBtn = page.locator('#btn-stop');
    const refBtn = page.locator('#btn-ref-point');

    await expect(startBtn).not.toHaveClass(/hidden/);
    await expect(stopBtn).toHaveClass(/hidden/);
    await expect(refBtn).toHaveClass(/hidden/);

    // Call showRecordingControls via testHook
    await page.evaluate(() => {
      window.testHooks.showRecordingControls();
    });

    // After: start hidden, stop/ref visible
    await expect(startBtn).toHaveClass(/hidden/);
    await expect(stopBtn).not.toHaveClass(/hidden/);
    await expect(refBtn).not.toHaveClass(/hidden/);
  });

  test('hideRecordingControls via testHook restores initial button state', async ({
    page,
  }) => {
    const startBtn = page.locator('#btn-start');
    const stopBtn = page.locator('#btn-stop');
    const refBtn = page.locator('#btn-ref-point');

    // First show, then hide
    await page.evaluate(() => {
      window.testHooks.showRecordingControls();
    });
    await page.evaluate(() => {
      window.testHooks.hideRecordingControls();
    });

    // Should be back to initial state
    await expect(startBtn).not.toHaveClass(/hidden/);
    await expect(stopBtn).toHaveClass(/hidden/);
    await expect(refBtn).toHaveClass(/hidden/);
  });

  test('updateGpsInfo via testHook displays GPS accuracy correctly', async ({
    page,
  }) => {
    const gpsInfo = page.locator('#gps-info');
    const gpsAccuracy = page.locator('#gps-accuracy');

    // Initially hidden
    await expect(gpsInfo).toHaveClass(/hidden/);

    // updateGpsInfo takes only accuracy (not lat/lon)
    await page.evaluate(() => {
      window.testHooks.updateGpsInfo(5.5);
    });

    // GPS info should be visible and show formatted accuracy
    await expect(gpsInfo).toBeVisible();
    await expect(gpsAccuracy).toContainText('±5.5m');
    // Good accuracy (<10m) should have green color class
    await expect(gpsAccuracy).toHaveClass(/text-green-400/);
  });

  test('updateArInfo via testHook displays AR tracking status', async ({
    page,
  }) => {
    const arInfo = page.locator('#ar-info');

    await page.evaluate(() => {
      window.testHooks.updateArInfo('normal');
    });

    await expect(arInfo).toBeVisible();
    await expect(arInfo).toContainText('normal');
  });

  test('validateEnterButton via testHook correctly enables/disables button', async ({
    page,
  }) => {
    // Set storage and permissions ready first
    await setStorageReady(page);
    await setPermissionsReady(page);

    const enterBtn = page.locator('#btn-enter-ar');

    // Clear the index.html prefill (UX feedback 2026-05-03) — otherwise OPFS
    // auto-init may have already populated `__new__` with the prefilled name,
    // which would enable the button before any explicit scenario selection.
    await page.locator('#new-scenario-name').clear();
    await page.evaluate(() => window.testHooks.validateEnterButton());

    // Initially disabled (no scenario selected, no name typed)
    await expect(enterBtn).toBeDisabled();

    // Simulate existing scenario chosen
    await page.evaluate(() => {
      window.testHooks.populateScenarios(['Existing']);
    });

    // Select the existing scenario
    await page.locator('#scenario-select').selectOption('Existing');

    // Now validate - should enable
    await page.evaluate(() => {
      window.testHooks.validateEnterButton();
    });

    await expect(enterBtn).toBeEnabled();
  });

  test('validateEnterButton disables when new scenario has no name', async ({
    page,
  }) => {
    // Set storage and permissions ready first
    await setStorageReady(page);
    await setPermissionsReady(page);

    const enterBtn = page.locator('#btn-enter-ar');

    // Setup: populate and select "new scenario"
    await page.evaluate(() => {
      window.testHooks.populateScenarios(['Existing']);
    });
    await page.locator('#scenario-select').selectOption('__new__');

    // Clear the index.html prefill (UX feedback 2026-05-03) so we exercise
    // the empty-name path.
    await page.locator('#new-scenario-name').clear();

    // Validate with empty name input
    await page.evaluate(() => {
      window.testHooks.validateEnterButton();
    });

    // Should remain disabled
    await expect(enterBtn).toBeDisabled();

    // Now fill in a name
    await page.locator('#new-scenario-name').fill('My New Scenario');
    await page.evaluate(() => {
      window.testHooks.validateEnterButton();
    });

    // Should be enabled now
    await expect(enterBtn).toBeEnabled();
  });

  test('all exposed testHooks are waited for in waitForTestHooks', async ({
    page,
  }) => {
    // Why this test matters: If new hooks are added to window.testHooks in main.ts
    // but not included in waitForTestHooks(), tests using those hooks may become flaky.
    // This test ensures the wait condition covers all exposed hooks.
    const exposedHooks = await page.evaluate(() =>
      Object.keys(window.testHooks)
    );

    // These are the hooks we wait for in waitForTestHooks - must match all exposed hooks
    const expectedHooks = [
      'populateScenarios',
      'showRecordingControls',
      'hideRecordingControls',
      'showSessionSummary',
      'updateGpsInfo',
      'updateArInfo',
      'validateEnterButton',
      'updatePermissionStatus',
      'setPermissionsReady',
      // Log panel hooks (Issue #5)
      'showLogPanel',
      'hideLogPanel',
      'toggleLogPanel',
      'logInfo',
      'logWarn',
      'logError',
      // GPS event visualizer hooks
      'getGpsEventVisualizerCounts',
      'setGpsEventVisualizerZeroRef',
      'clearGpsEventVisualizer',
      // GPS accuracy ellipsoid hooks (§3c)
      'addGpsEventForTest',
      'getRawGpsMarkerWorldSizes',
      // Tracking quality indicator hook (F1)
      'updateTrackingQuality',
      // Mandatory storage selection hooks (Task 1a-fix)
      'setFolderSelected',
      'setSaveLocationSelected',
    ];

    // Verify no hook is missing from our wait condition
    for (const hook of exposedHooks) {
      expect(
        expectedHooks,
        `Hook '${hook}' is exposed but not waited for in waitForTestHooks(). ` +
          `Add it to both waitForTestHooks() and expectedHooks in this test.`
      ).toContain(hook);
    }

    // Verify we're not waiting for hooks that don't exist
    for (const hook of expectedHooks) {
      expect(
        exposedHooks,
        `Hook '${hook}' is in expectedHooks but not exposed by window.testHooks. ` +
          `Remove it from waitForTestHooks() and expectedHooks.`
      ).toContain(hook);
    }
  });
});
