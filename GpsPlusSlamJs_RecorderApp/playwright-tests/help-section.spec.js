import { test, expect } from '@playwright/test';

/**
 * Help Section Tests (Issue 2 - User Feedback 2026-01-27)
 *
 * Tests the collapsible "What is this?" help section on the setup screen.
 * The help section explains key concepts: app purpose, scenarios, sessions,
 * and reference points.
 *
 * Why this test matters: Users reported confusion about the terminology
 * on the setup screen. This help section addresses that by providing
 * contextual explanation that's visible by default for first-time users.
 */

// ⚠️ Also defined in src/ui/hud.ts — keep in sync!
const HELP_COLLAPSED_KEY = 'gps-recorder-help-collapsed';

/**
 * Helper to toggle the help section by dispatching a click on the summary.
 * We use evaluate to bypass Playwright's viewport checks since the modal
 * content may extend beyond the viewport on smaller screens.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function toggleHelpSection(page) {
  await page.evaluate(() => {
    const summary = document.querySelector('#help-section summary');
    if (summary) {
      summary.click();
    }
  });
}

test.describe('Help Section', () => {
  // For most tests, clear localStorage before navigating to simulate fresh user
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear localStorage after navigating but before app initializes help state
    await page.evaluate((key) => {
      localStorage.removeItem(key);
    }, HELP_COLLAPSED_KEY);
    // Reload to pick up the cleared state
    await page.reload();
    // Wait for setup modal to be visible
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
  });

  test('help section is visible by default for first-time users', async ({
    page,
  }) => {
    // The help section should exist and be expanded (open) by default
    const helpDetails = page.locator('#help-section');
    await expect(helpDetails).toBeVisible();

    // The content should be visible (details is open)
    const helpContent = page.locator('#help-section-content');
    await expect(helpContent).toBeVisible();
  });

  test('help section contains key concept explanations', async ({ page }) => {
    const helpContent = page.locator('#help-section-content');

    // Should explain what the app is for. `[\s\S]*` (not `.*`) so the match
    // tolerates the prettier-wrapped multi-line Purpose paragraph — "Record
    // synchronized AR + GPS data …" spans several source lines.
    await expect(helpContent).toContainText(/record[\s\S]*AR[\s\S]*GPS/i);

    // Should explain what a Scenario is
    await expect(helpContent).toContainText(/scenario/i);

    // Should explain what a Session is
    await expect(helpContent).toContainText(/session/i);

    // Should explain what Reference Points are
    await expect(helpContent).toContainText(/reference point/i);
  });

  test('help section can be collapsed by clicking', async ({ page }) => {
    const helpContent = page.locator('#help-section-content');

    // Initially visible
    await expect(helpContent).toBeVisible();

    // Click to collapse using helper (bypasses viewport issues)
    await toggleHelpSection(page);

    // Content should now be hidden
    await expect(helpContent).not.toBeVisible();
  });

  test('collapsed state is saved to localStorage', async ({ page }) => {
    // Collapse the help section using helper
    await toggleHelpSection(page);

    // Check localStorage was updated
    const collapsed = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, HELP_COLLAPSED_KEY);

    expect(collapsed).toBe('true');
  });

  test('help section stays collapsed on page reload if user collapsed it', async ({
    page,
  }) => {
    const helpContent = page.locator('#help-section-content');

    // Collapse the help section using helper
    await toggleHelpSection(page);
    await expect(helpContent).not.toBeVisible();

    // Reload the page
    await page.reload();
    await page.locator('#setup-modal').waitFor({ state: 'visible' });

    // Help content should still be collapsed
    await expect(helpContent).not.toBeVisible();
  });

  test('help section can be re-expanded after collapsing', async ({ page }) => {
    const helpContent = page.locator('#help-section-content');

    // Collapse using helper
    await toggleHelpSection(page);
    await expect(helpContent).not.toBeVisible();

    // Re-expand using helper
    await toggleHelpSection(page);
    await expect(helpContent).toBeVisible();
  });
});
