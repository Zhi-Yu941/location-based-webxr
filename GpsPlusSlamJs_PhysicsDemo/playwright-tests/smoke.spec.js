import { test, expect } from "@playwright/test";

/**
 * Tier-0 smoke test for the physics demo.
 *
 * Why this test matters:
 * It guards the app's baseline health from a fresh consumer of the framework's
 * replay composer: the page must load without console errors, the static
 * mode-entry UI must render, and — because Playwright's Chromium has no
 * `navigator.xr` — the desktop-replay path must be offered honestly (recording
 * input present, "Start AR" hidden) instead of the app crashing on an AR
 * assumption.
 */
test.describe("Physics Demo Smoke", () => {
  test("loads without console errors and offers the replay path on desktop", async ({
    page,
  }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // Static mode-entry UI renders.
    await expect(page.getByTestId("mode-screen")).toBeVisible();
    await expect(page.getByTestId("recording-input")).toBeVisible();

    // No WebXR in Playwright → the AR button stays hidden, replay is offered.
    await expect(page.getByTestId("start-ar-button")).toBeHidden();
    // Replay controls are not shown until a recording is loaded.
    await expect(page.getByTestId("replay-panel")).toBeHidden();

    expect(errors).toEqual([]);
  });
});
