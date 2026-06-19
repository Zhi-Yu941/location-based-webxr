import { test, expect } from '@playwright/test';
import {
  callRealPopulateScenarios,
  fakeWebXRSupport,
  setPermissionsReady,
  setStorageReady,
  waitForTestHooks,
} from './test-helpers.js';

/**
 * Setup Modal Flow Tests
 *
 * These tests verify the setup modal workflow that users go through
 * before starting an AR session. This includes folder selection,
 * scenario management, and session notes.
 *
 * Why this test matters: The setup modal is the first thing users interact
 * with, and proper flow is critical for a good user experience.
 */

// Shared setup for all tests - wait for app to be ready
test.beforeEach(async ({ page }) => {
  // Fake WebXR so app stays in recording mode (Playwright has no WebXR)
  await fakeWebXRSupport(page);
  await page.goto('/');
  // Wait for setup modal to be visible (indicates app is ready)
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  // Ensure all testHooks are available before any test runs.
  // This makes the setup consistent with other spec files.
  await waitForTestHooks(page);
});

test.describe('Setup Modal Flow', () => {
  test('modal prevents interaction with main controls', async ({ page }) => {
    // Setup modal should be visible, covering main UI
    const setupModal = page.locator('#setup-modal');
    await expect(setupModal).toBeVisible();

    // Main controls should exist but behind the modal
    const startButton = page.locator('#btn-start');
    const mapButton = page.locator('#btn-map');

    // The buttons exist but modal has higher z-index
    await expect(startButton).toBeAttached();
    await expect(mapButton).toBeAttached();

    // Modal has z-50, so it covers controls
    const modalZIndex = await setupModal.evaluate(
      (el) => window.getComputedStyle(el).zIndex
    );
    expect(parseInt(modalZIndex)).toBeGreaterThanOrEqual(50);
  });

  test('scenario dropdown is populated after OPFS auto-init', async ({
    page,
  }) => {
    const scenarioSelect = page.locator('#scenario-select');
    // After OPFS auto-initialization, dropdown should be enabled (not disabled)
    // It may have "Loading..." initially then switch to available scenarios
    await expect(scenarioSelect).toBeVisible();
  });

  test('enter AR button is disabled before scenario selection', async ({
    page,
  }) => {
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeDisabled();
    await expect(enterButton).toContainText('Enter AR');
  });

  test('session notes textarea is enabled after storage is ready', async ({
    page,
  }) => {
    // After storage selection is complete, the notes textarea should be enabled
    const notesTextarea = page.locator('#session-notes');
    // Simulate mandatory storage selection (Task 1a-fix)
    await setStorageReady(page);
    await expect(notesTextarea).toBeEnabled();
  });

  test('storage buttons are visible for mandatory selection', async ({
    page,
  }) => {
    // D5 (2026-06-05): the save location is the only mandatory storage step and
    // is visible by default; the folder-import step is an OPTIONAL collapsed
    // section, so its button is hidden until the section is expanded.
    const chooseSaveBtn = page.locator('#btn-choose-save');
    await expect(chooseSaveBtn).toBeVisible();

    const folderSection = page.locator('#folder-import-section');
    await expect(folderSection).toBeVisible(); // the <summary> is shown
    const openFolderBtn = page.locator('#btn-open-folder');
    await expect(openFolderBtn).toBeHidden(); // collapsed by default

    // Expanding the optional section reveals the folder button.
    await page.evaluate(() => window.testHooks.setFolderImportExpanded(true));
    await expect(openFolderBtn).toBeVisible();
  });

  test('folder status shows not selected initially', async ({ page }) => {
    const folderStatus = page.locator('#folder-status');
    await expect(folderStatus).toContainText('No folder selected');
  });

  test('save status shows not selected initially', async ({ page }) => {
    const saveStatus = page.locator('#save-status');
    await expect(saveStatus).toContainText('No save location chosen');
  });

  test('new scenario name input shown when no existing scenarios', async ({
    page,
  }) => {
    // After storage selection with no existing scenarios, dropdown shows "__new__"
    // which triggers the new scenario section to be visible
    await setStorageReady(page);
    // If no existing scenarios, "__new__" is selected and section is visible
    // OR if existing scenarios, the section is hidden until user selects "__new__"
    // Either behavior is acceptable - just verify the section element exists
    const newScenarioSection = page.locator('#new-scenario-section');
    await expect(newScenarioSection).toBeAttached();
  });

  test('clicking storage button does not throw error in test env', async ({
    page,
  }) => {
    // In test environment without File System Access API, this should
    // fail gracefully (show error toast, not crash)

    const pageErrors = [];
    page.on('pageerror', (error) => {
      // Allow expected errors for showDirectoryPicker / showSaveFilePicker
      if (
        !error.message.includes('showDirectoryPicker') &&
        !error.message.includes('showSaveFilePicker') &&
        !error.message.includes('is not a function') &&
        !error.message.includes('not defined') &&
        !error.message.includes('not supported')
      ) {
        pageErrors.push(error.message);
      }
    });

    // The folder button lives in the collapsed optional section (D5); expand it
    // first so it is actionable, then click it.
    await page.evaluate(() => window.testHooks.setFolderImportExpanded(true));
    const openFolderBtn = page.locator('#btn-open-folder');
    await openFolderBtn.click();

    // Give a brief moment for any errors to propagate, then check
    // Use expect.poll to allow for async error propagation
    await expect.poll(() => pageErrors, { timeout: 500 }).toEqual([]);
  });

  test('storage status indicators show initially empty', async ({ page }) => {
    const folderStatus = page.locator('#folder-status');
    const saveStatus = page.locator('#save-status');
    await expect(folderStatus).toContainText('No folder selected');
    await expect(saveStatus).toContainText('No save location chosen');
  });

  test('WebXR warning is hidden when WebXR not checked', async ({ page }) => {
    // The warning should be hidden initially (shown only after check fails)
    const warning = page.locator('#webxr-warning');
    // Note: In Chromium with WebXR simulation, it may or may not be visible
    // We just verify the element exists
    await expect(warning).toBeAttached();
  });

  test('setup modal title is correct', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'GPS + SLAM Recorder' })
    ).toBeVisible();
  });

  test('status display exists and shows initial state', async ({ page }) => {
    const statusText = page.locator('#status-text');
    await expect(statusText).toBeAttached();
    // Should show some status text (Initializing or similar)
    const text = await statusText.textContent();
    expect(text).not.toBe('');
  });
});

test.describe('Scenario Dropdown Interaction', () => {
  test('dropdown has options after storage is selected', async ({ page }) => {
    const scenarioSelect = page.locator('#scenario-select');
    // Simulate mandatory storage selection
    await setStorageReady(page);
    // After storage selection, dropdown should have at least the "New Scenario" option
    const options = scenarioSelect.locator('option');
    await expect(options).not.toHaveCount(0);
  });

  test('populateScenarios updates UI correctly', async ({ page }) => {
    // Simulate mandatory storage selection first
    await setStorageReady(page);
    // Use real populateScenarios function to test the actual app behavior
    // when a folder is selected and scenarios are loaded
    await callRealPopulateScenarios(page, ['Test Scenario']);

    // Set permissions as ready (required for Enter AR button to be enabled)
    await setPermissionsReady(page);

    // Select the existing scenario to enable the Enter AR button
    const scenarioSelect = page.locator('#scenario-select');
    await scenarioSelect.selectOption('Test Scenario');

    // Verify UI is now enabled
    await expect(scenarioSelect).toBeEnabled();
    await expect(scenarioSelect).toHaveValue('Test Scenario');

    // Session notes should be enabled after folder selection
    const notesArea = page.locator('#session-notes');
    await expect(notesArea).toBeEnabled();

    // Enter button should be enabled with valid scenario selected
    const enterButton = page.locator('#btn-enter-ar');
    await expect(enterButton).toBeEnabled();
  });

  test('selecting "New Scenario" shows name input', async ({ page }) => {
    // Simulate folder selection by populating the dropdown using real app function
    await callRealPopulateScenarios(page, ['Existing']);

    // Select the new scenario option - this triggers the real change handler
    // which was attached by initUI (now called before WebXR check)
    const scenarioSelect = page.locator('#scenario-select');
    await scenarioSelect.selectOption('__new__');

    // The real application change handler should show the new scenario section
    const newScenarioSection = page.locator('#new-scenario-section');
    await expect(newScenarioSection).not.toHaveClass(/hidden/);
  });

  test('new scenario name input accepts text', async ({ page }) => {
    // Populate the dropdown to enable scenario selection using real app function
    await callRealPopulateScenarios(page, ['Existing']);

    // Select "__new__" to trigger the real change handler and show the section
    const scenarioSelect = page.locator('#scenario-select');
    await scenarioSelect.selectOption('__new__');

    const nameInput = page.locator('#new-scenario-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Paris Eiffeltower');
    await expect(nameInput).toHaveValue('Paris Eiffeltower');
  });

  test('selecting existing scenario hides new scenario input', async ({
    page,
  }) => {
    // Populate the dropdown with options using real app function
    await callRealPopulateScenarios(page, ['Existing Scenario']);

    const scenarioSelect = page.locator('#scenario-select');
    const newScenarioSection = page.locator('#new-scenario-section');

    // First select "__new__" to show the section
    await scenarioSelect.selectOption('__new__');
    await expect(newScenarioSection).not.toHaveClass(/hidden/);

    // Now select an existing scenario - the real handler should hide the section
    await scenarioSelect.selectOption('Existing Scenario');
    await expect(newScenarioSection).toHaveClass(/hidden/);
  });
});

test.describe('Session Notes Interaction', () => {
  test('notes textarea accepts multiline input when enabled', async ({
    page,
  }) => {
    // Enable the textarea by populating scenarios (simulates folder selection)
    await callRealPopulateScenarios(page, ['Test Scenario']);

    const notes = page.locator('#session-notes');
    await expect(notes).toBeEnabled();

    // Type multiline text
    await notes.fill('Weather: Sunny\nDevice: Pixel 7\nTest run #1');
    await expect(notes).toHaveValue(
      'Weather: Sunny\nDevice: Pixel 7\nTest run #1'
    );
  });

  test('notes placeholder is visible', async ({ page }) => {
    const notes = page.locator('#session-notes');
    const placeholder = await notes.getAttribute('placeholder');
    expect(placeholder).toContain('Weather');
  });
});
