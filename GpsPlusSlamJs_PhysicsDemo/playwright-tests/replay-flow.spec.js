import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "sample-recording.zip");

/**
 * End-to-end replay flow against a REAL recorded walk (a small, current-era
 * capture in playwright-tests/fixtures/).
 *
 * Why this test matters:
 * It is the only fully-automated proof of the demo's headline promise on the
 * desktop: load a recording → the occupancy mesh reconstructs from the replayed
 * depth stream → the Rapier collider is rebuilt from that mesh → dropped balls
 * spawn, are stepped, and can be cleared. The physics maths is pinned separately
 * by the headless real-Rapier unit tests; this pins the whole browser pipeline
 * (replay engine → depth → grid → occlusion mesh → collider → spawn) end to end.
 * The live-AR path stays device-only (no navigator.xr in Playwright).
 */
test.describe("Physics Demo — desktop replay end-to-end", () => {
  test("reconstructs the mesh from a real recording and spawns bouncing balls", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.getByTestId("recording-input").setInputFiles(FIXTURE);

    // The replay session starts → the controls appear.
    await expect(page.getByTestId("replay-panel")).toBeVisible({
      timeout: 30_000,
    });

    // Replay faster so the mesh reconstructs quickly under test.
    await page.getByTestId("replay-speed").fill("4");

    // The occupancy mesh reconstructs from the replayed depth stream and the
    // physics collider is rebuilt from it — the stats line reports the box count.
    const stats = page.getByTestId("stats");
    await expect(stats).toContainText(/collider [1-9]\d* boxes/, {
      timeout: 90_000,
    });

    // Drop a ball → the count increments (spawn + the physics step loop are live).
    await page.getByTestId("drop-ball-button").click();
    await expect(stats).toContainText(/balls 1 /, { timeout: 10_000 });
    await page.getByTestId("drop-ball-button").click();
    await expect(stats).toContainText(/balls 2 /, { timeout: 10_000 });

    // Clear removes them.
    await page.getByTestId("clear-balls-button").click();
    await expect(stats).toContainText(/balls 0 /, { timeout: 10_000 });

    // The live mesh-view toggle (Cubes ↔ Detailed, hide/show) must not crash.
    await page.getByTestId("mesh-style").selectOption("detailed");
    await page.getByTestId("mesh-visible").uncheck();
    await page.getByTestId("mesh-visible").check();

    // No uncaught exceptions across the whole flow.
    expect(pageErrors).toEqual([]);
  });
});
