import { expect } from "@playwright/test";

/**
 * Tier 1 e2e fakes for the persistent-anchor starter.
 *
 * Why this file exists (see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-anchor-starter-e2e-test-plan.md §5–§6):
 * Playwright Chromium has no WebXR and no real GPS, so the *application flow*
 * (boot → guidance → soft-gated placement → `?show=` round-trip → copy-link)
 * cannot be exercised against real sensors. Instead of mocking individual
 * browser APIs, the app exposes a DEV-only seam (`window.__anchorStarterSeams`,
 * guarded by `import.meta.env.DEV && !import.meta.env.VITEST` so it is statically
 * stripped from production). This helper installs deterministic fakes over that
 * seam *before* page scripts run (`addInitScript`) and a small control surface
 * (`window.__anchorStarterTest`) the specs drive from `page.evaluate`.
 *
 * Design notes:
 * - The fakes are duck-typed: `createGpsAnchor`/`createAnchorMarker` are faked,
 *   so the fake AR world-group/camera/marker need no real THREE objects.
 * - `selectTrackingQuality` returns a *controllable* `TrackingQualityReport`
 *   (read lazily on every render), letting a spec pin the onboarding phase.
 * - `startGpsWatch`'s callback is stashed so a spec can push a GPS fix on
 *   demand via `pushGps(...)`; the real coordinator inside the app early-returns
 *   (no AR pose), but `main.ts` still records `lastGps` in its wrapper, which is
 *   all the soft-gated placement flow needs.
 */

/**
 * @typedef {object} InstallFakesOptions
 * @property {object} [trackingReport] Initial `TrackingQualityReport` the faked
 *   `selectTrackingQuality` returns. Defaults to an `ok` (ready) report.
 * @property {boolean} [failClipboard] When true, override
 *   `navigator.clipboard.writeText` to reject so the copy-link failure path can
 *   be exercised.
 * @property {boolean} [failOrientationPermission] When true, the faked
 *   `requestDeviceOrientationPermission` rejects so the post-`initAR` boot
 *   rollback (`failStart`) can be exercised end-to-end.
 */

/**
 * Install the DEV seam fakes + test control surface. MUST be called BEFORE
 * `page.goto('/')` — `addInitScript` runs before any page script, so the seam
 * is in place when `main()` first reads `getSeams()`.
 *
 * @param {import('@playwright/test').Page} page Playwright page object.
 * @param {InstallFakesOptions} [options] Per-test configuration.
 */
export async function installAnchorStarterFakes(page, options = {}) {
  const config = {
    trackingReport: options.trackingReport ?? {
      state: "ok",
      confidence: 1,
      subScores: { coverage: 1, freshness: 1, agreement: 1 },
    },
    failClipboard: options.failClipboard ?? false,
    failOrientationPermission: options.failOrientationPermission ?? false,
  };

  await page.addInitScript((cfg) => {
    /** Mutable control surface the specs drive from `page.evaluate`. */
    const control = {
      /** GPS callback stashed by the faked `startGpsWatch`. */
      gpsCallback: null,
      /** Arguments captured on every `createAnchorMarker` call. */
      markerCalls: [],
      /** Current report returned by the faked `selectTrackingQuality`. */
      trackingReport: cfg.trackingReport,
      /** When true, the faked `createGpsAnchor` throws (placement failure). */
      failCreateAnchor: false,
    };

    /** Drive a GPS fix through the stashed watch callback. */
    control.pushGps = (fix) => {
      if (!control.gpsCallback) {
        throw new Error("GPS watch not started yet — click Start first");
      }
      control.gpsCallback({
        lat: fix.lat,
        lon: fix.lon,
        altitude: typeof fix.altitude === "number" ? fix.altitude : 0,
        accuracy: typeof fix.accuracy === "number" ? fix.accuracy : 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        timestamp: Date.now(),
      });
    };

    window.__anchorStarterTest = control;

    window.__anchorStarterSeams = {
      checkWebXRSupport: () =>
        Promise.resolve({ supported: true, granted: true }),
      checkGeolocationPermission: () =>
        Promise.resolve({ supported: true, granted: true }),
      initAR: () => Promise.resolve(),
      getArWorldGroup: () => ({ add() {} }),
      getCamera: () => ({}),
      startGpsWatch: (onPosition) => {
        control.gpsCallback = onPosition;
      },
      startOrientationWatch: () => {},
      requestDeviceOrientationPermission: () =>
        cfg.failOrientationPermission
          ? Promise.reject(new Error("forced orientation-permission failure (e2e)"))
          : Promise.resolve(),
      createGpsAnchor: () => {
        if (control.failCreateAnchor) {
          throw new Error("forced anchor failure (e2e)");
        }
        return { dispose() {} };
      },
      selectTrackingQuality: () => control.trackingReport,
      createAnchorMarker: (markerOptions) => {
        control.markerCalls.push(markerOptions ?? {});
        return {};
      },
    };

    if (cfg.failClipboard && navigator.clipboard) {
      navigator.clipboard.writeText = () =>
        Promise.reject(new Error("forced clipboard failure (e2e)"));
    }
  }, config);
}

/**
 * Boot the app through the start gesture and wait until the live HUD is
 * revealed (guidance + placement panels visible). Assumes fakes are installed.
 *
 * @param {import('@playwright/test').Page} page Playwright page object.
 */
export async function bootAnchorStarter(page) {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await expect(page.getByTestId("placement")).toBeVisible();
}

/**
 * Push a single GPS fix into the running app via the test control surface.
 *
 * @param {import('@playwright/test').Page} page Playwright page object.
 * @param {{ lat: number, lon: number, altitude?: number, accuracy?: number }} fix
 */
export async function pushGpsFix(page, fix) {
  await page.evaluate((value) => {
    window.__anchorStarterTest.pushGps(value);
  }, fix);
}
