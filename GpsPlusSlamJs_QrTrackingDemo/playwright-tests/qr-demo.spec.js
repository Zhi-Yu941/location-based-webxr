import { test, expect } from "@playwright/test";
import { installQrDemoFakes, bootQrDemo, feedFrames } from "./fakes.js";

/**
 * Tier 1 application flow for the QR-tracking demo, with the device seam faked
 * (real WebXR/camera/depth are absent in desktop Chromium). It covers the whole
 * point of the app: boot → per-frame detect + depth-size measurement → the
 * running median converges and the debug axis + cube get glued under
 * `arWorldGroup`. This is the desktop stand-in for the manual §5 on-device gate.
 */
test.describe("QR-tracking demo — measure + glue flow", () => {
  test.beforeEach(async ({ page }) => {
    await installQrDemoFakes(page);
  });

  test("starts scanning with no measured size yet", async ({ page }) => {
    await bootQrDemo(page);
    await expect(page.getByTestId("hud-status")).toContainText("Scanning");
    await expect(page.getByTestId("hud-size")).toHaveText("—");
    await expect(page.getByTestId("hud-lifecycle")).toHaveText("unknown");
  });

  test('measures the QR size from depth and converges to "estimated"', async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    // The faked planar square is 0.2 m on a side, every frame → median 20.0 cm.
    await expect(page.getByTestId("hud-lifecycle")).toHaveText("estimated");
    await expect(page.getByTestId("hud-size")).toHaveText("20.0 cm");
    await expect(page.getByTestId("hud-spread")).toHaveText("±0 mm");
    await expect(page.getByTestId("hud-status")).toContainText("Locked");
  });

  test("glues the debug axis + cube under arWorldGroup once locked", async ({
    page,
  }) => {
    await bootQrDemo(page);
    await feedFrames(page, 12);

    const scene = await page.evaluate(() => {
      const kids = window.__qrDemoTest.worldGroupChildren;
      return {
        count: kids.length,
        lastVisible: kids[kids.length - 1]?.visible,
      };
    });
    // Two objects (axis + cube) added; revealed after the lock.
    expect(scene.count).toBe(2);
    expect(scene.lastVisible).toBe(true);
  });
});
