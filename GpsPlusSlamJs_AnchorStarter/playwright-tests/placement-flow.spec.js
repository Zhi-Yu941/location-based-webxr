import { test, expect } from "@playwright/test";
import {
  installAnchorStarterFakes,
  bootAnchorStarter,
  pushGpsFix,
} from "./fakes.js";

/**
 * Tier 1 placement-flow e2e for the persistent-anchor starter.
 *
 * Why this suite matters (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-anchor-starter-e2e-test-plan.md §6 Tier 1):
 * Tier 0 can only prove the desktop capability gate. With the DEV seam faked
 * (real WebXR/GPS are absent in Playwright Chromium), these tests cover the
 * actual application flow a real user walks through: boot → onboarding
 * guidance → soft-gated placement → URL `?show=` persistence (write + reload
 * round-trip) → placement-failure revert.
 *
 * Async-UX caveat: `placeAnchor()` is synchronous (it writes `?show=` via
 * `history.replaceState` in the same call stack), so the transient `Saving…`
 * button state is never observable from e2e. We therefore assert ONLY the
 * durable final state (`Saved ✓`), per the pinned rationale in the plan §6.
 */

const SAMPLE_FIX = { lat: 48.20817, lon: 16.37381, altitude: 171, accuracy: 4 };

test.describe("Anchor starter — Tier 1 placement flow", () => {
  test.beforeEach(async ({ page }) => {
    await installAnchorStarterFakes(page);
  });

  test("reveals the live HUD with a placeable button after boot", async ({
    page,
  }) => {
    await bootAnchorStarter(page);

    // Soft-gate (D2): the button is placeable immediately after boot, before
    // any tracking-readiness — only the recommendation differs.
    const placeButton = page.getByTestId("place-button");
    await expect(placeButton).toBeVisible();
    await expect(placeButton).toBeEnabled();
    await expect(placeButton).toHaveText("Place anchor");

    // Nothing is saved yet, so the share/reload affordances stay hidden.
    await expect(page.getByTestId("copy-link-button")).toBeHidden();
    await expect(page.getByTestId("reload-prompt")).toBeHidden();
    await expect(page.getByTestId("start-screen")).toBeHidden();
  });

  test("renders the onboarding guidance from a ready tracking report", async ({
    page,
  }) => {
    // Default fake report is `ok` → the guidance maps to the ready band.
    await bootAnchorStarter(page);

    await expect(page.locator("#guidance-title")).toHaveText("Ready");
    await expect(page.locator("#guidance-percent")).toHaveText("100%");
    await expect(page.locator("#guidance-bar-fill")).toHaveClass("tone-good");
  });

  test("renders a warming-up tracking report as a progress phase", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page, {
      trackingReport: {
        state: "warming-up",
        confidence: 0.4,
        subScores: { coverage: 1, freshness: 0.5, agreement: 0.5 },
      },
    });
    await bootAnchorStarter(page);

    await expect(page.locator("#guidance-title")).toHaveText("Move around");
    // warming-up percentReady = coverage * 0.6 → 60%.
    await expect(page.locator("#guidance-percent")).toHaveText("60%");
    await expect(page.locator("#guidance-bar-fill")).toHaveClass(
      "tone-progress",
    );
  });

  test("saves the anchor and surfaces the share/reload affordances", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);

    await page.getByTestId("place-button").click();

    // Assert only the durable final state (see the async-UX caveat above).
    const placeButton = page.getByTestId("place-button");
    await expect(placeButton).toHaveText("Saved ✓");
    await expect(placeButton).toBeDisabled();
    await expect(page.getByTestId("banner")).toContainText(
      "Saved into the page link",
    );
    await expect(page.getByTestId("copy-link-button")).toBeVisible();
    await expect(page.getByTestId("reload-prompt")).toBeVisible();
  });

  test("writes the anchor into the ?show= URL param on place", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);

    await page.getByTestId("place-button").click();
    await expect(page.getByTestId("place-button")).toHaveText("Saved ✓");

    const search = await page.evaluate(() => location.search);
    expect(search).toMatch(/[?&]show=/);
    const showValue = new URLSearchParams(search).get("show");
    expect(
      showValue,
      "?show= must carry a non-trivial encoded anchor",
    ).toBeTruthy();
    expect(showValue.length).toBeGreaterThan(4);
  });

  test("round-trips ?show= — reloading the saved link restores the anchor", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);
    await page.getByTestId("place-button").click();
    await expect(page.getByTestId("place-button")).toHaveText("Saved ✓");

    // The anchor lives entirely in the page link — reload it and boot again.
    const savedUrl = page.url();
    await page.goto(savedUrl);
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("placement")).toBeVisible();

    // cache-hit branch: the place button is hidden (we are relocalising), and
    // the marker is rebuilt from the URL-decoded spec (default style).
    await expect(page.getByTestId("place-button")).toBeHidden();
    await expect(page.getByTestId("banner")).toContainText("re-localise");

    const markerCalls = await page.evaluate(
      () => window.__anchorStarterTest.markerCalls,
    );
    expect(markerCalls.length).toBeGreaterThan(0);
    expect(markerCalls[markerCalls.length - 1]).toEqual({
      ui: 1,
      scale: 1,
      rotationDeg: 0,
    });
  });

  test("reverts and surfaces an error when anchor creation fails", async ({
    page,
  }) => {
    await bootAnchorStarter(page);
    await pushGpsFix(page, SAMPLE_FIX);

    // Force the faked createGpsAnchor to throw, exercising the PLACE_FAILED
    // revert (async-UX rule: in-progress state reverts and the error surfaces).
    await page.evaluate(() => {
      window.__anchorStarterTest.failCreateAnchor = true;
    });
    await page.getByTestId("place-button").click();

    const error = page.getByTestId("error");
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();

    // Button reverts to a placeable state; nothing was saved.
    const placeButton = page.getByTestId("place-button");
    await expect(placeButton).toHaveText("Place anchor");
    await expect(placeButton).toBeEnabled();
    await expect(page.getByTestId("copy-link-button")).toBeHidden();
  });
});

test.describe("Anchor starter — boot rollback", () => {
  /**
   * Why this test matters: every step after `initAR` succeeds has a side effect
   * (sensor watches start, the cache-hit branch may spawn an anchor). If one of
   * those awaited steps rejects, the app must NOT linger half-started — Start
   * stuck on "Starting…", the start screen hidden, GPS still watching. The
   * post-`initAR` try/catch in `startAr` calls `failStart`, which rolls every
   * side effect back and restores the start screen so the user can retry. Here
   * we force the awaited `requestDeviceOrientationPermission` to reject and
   * assert the UI is fully rewound.
   */
  test("rewinds to the start screen when a post-initAR step rejects", async ({
    page,
  }) => {
    await installAnchorStarterFakes(page, { failOrientationPermission: true });
    await page.goto("/");

    await page.getByTestId("start-button").click();

    // The start screen comes back and Start is re-enabled for a retry.
    const startScreen = page.getByTestId("start-screen");
    await expect(startScreen).toBeVisible();
    const startButton = page.getByTestId("start-button");
    await expect(startButton).toBeEnabled();
    await expect(startButton).toHaveText("Start AR");

    // The failure reason is surfaced, and the live HUD stays hidden.
    const message = page.getByTestId("capability-message");
    await expect(message).toBeVisible();
    await expect(message).not.toBeEmpty();
    await expect(page.getByTestId("guidance")).toBeHidden();
    await expect(page.getByTestId("placement")).toBeHidden();
  });
});
