import { test, expect } from "@playwright/test";
import {
  installAnchorStarterFakes,
  bootAnchorStarter,
  pushGpsFix,
} from "./fakes.js";

/**
 * Tier 1 copy-link (share) e2e for the persistent-anchor starter.
 *
 * Why this suite matters (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-anchor-starter-e2e-test-plan.md §6 Tier 1):
 * Once an anchor is saved into `?show=`, the user shares the page link to open
 * the same anchor on another device (decision F1). The copy-link button is the
 * only async-UX affordance in the app that has a real success/failure label
 * flip and a timed revert. These tests pin both outcomes plus the revert.
 *
 * The clipboard *contents* are asserted as a soft, secondary check (clipboard
 * access is environment-sensitive); the label flip is the primary contract.
 */

const SAMPLE_FIX = { lat: 48.20817, lon: 16.37381, altitude: 171, accuracy: 4 };

/** Boot, push a fix, place the anchor, and wait until it is saved. */
async function placeAndSave(page) {
  await bootAnchorStarter(page);
  await pushGpsFix(page, SAMPLE_FIX);
  await page.getByTestId("place-button").click();
  await expect(page.getByTestId("place-button")).toHaveText("Saved ✓");
}

test.describe("Anchor starter — Tier 1 copy-link sharing", () => {
  test("flips the label to a success confirmation, then reverts", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page);
    await placeAndSave(page);

    const copyButton = page.getByTestId("copy-link-button");
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // In-progress → final: the label confirms the copy succeeded.
    await expect(copyButton).toHaveText("Link copied ✓");

    // Soft, secondary: the clipboard holds the shareable page link.
    const clipboard = await page
      .evaluate(() => navigator.clipboard.readText())
      .catch(() => null);
    if (clipboard !== null) {
      expect.soft(clipboard).toContain("show=");
    }

    // The label reverts to the idle affordance (~2 s; expect auto-retries,
    // so no fixed-time wait is needed).
    await expect(copyButton).toHaveText("Copy link");
  });

  test("clicking twice within the revert window still reverts to idle", async ({
    page,
  }) => {
    // Regression: a second click used to capture the transient "Link copied ✓"
    // as the idle label, locking the button to it permanently after the timer.
    await installAnchorStarterFakes(page);
    await placeAndSave(page);

    const copyButton = page.getByTestId("copy-link-button");
    await copyButton.click();
    await expect(copyButton).toHaveText("Link copied ✓");

    // Second click before the ~2 s revert fires.
    await copyButton.click();
    await expect(copyButton).toHaveText("Link copied ✓");

    // The single (latest) timer must restore the idle affordance, not lock it.
    await expect(copyButton).toHaveText("Copy link");
  });

  test("shows a fallback hint when clipboard write fails", async ({ page }) => {
    await installAnchorStarterFakes(page, { failClipboard: true });
    await placeAndSave(page);

    const copyButton = page.getByTestId("copy-link-button");
    await copyButton.click();

    // Failure path surfaces an actionable fallback instead of silent failure.
    await expect(copyButton).toHaveText("Copy failed — long-press the link");

    // And it too reverts to the idle affordance afterwards.
    await expect(copyButton).toHaveText("Copy link");
  });
});
