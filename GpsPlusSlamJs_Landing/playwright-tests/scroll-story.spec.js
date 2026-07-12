// @ts-check
import { test, expect } from "@playwright/test";

// Why these tests matter: the landing's logic is unit-tested, but only a
// real browser exercises the WebGL boot, the anime.js scrub, and the DOM
// wiring together. A headless smoke run of exactly this shape caught two
// real visual defects during initial implementation. The suite stays
// small on purpose: boot + scroll integrity, fallback floor, theme
// persistence, demo links, reduced motion.

/** Must match src/chapters.ts (CHAPTERS order). */
const CHAPTER_IDS = [
  "hero",
  "qr",
  "fusion",
  "dive",
  "anywhere",
  "gallery",
  "cta",
];

/** @param {import('@playwright/test').Page} page */
function collectErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(String(err));
  });
  return errors;
}

test("boots and activates every chapter while scrolling, with zero errors", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/");
  for (const id of CHAPTER_IDS) {
    await expect(page.locator(`#chapter-${id}`)).toBeAttached();
  }
  for (const id of CHAPTER_IDS) {
    await page.locator(`#chapter-${id}`).scrollIntoViewIfNeeded();
    // The active class is set by the scroll state machine; expect() polls,
    // so no fixed timeouts are needed.
    await expect(page.locator(`#chapter-${id}.active`)).toBeAttached();
    await expect(page.locator(`#chapter-${id} .copy`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("renders the 3D canvas, or engages the static-DOM floor cleanly", async ({
  page,
}) => {
  await page.goto("/");
  const usesFloor = await page.evaluate(() =>
    document.body.classList.contains("no-webgl"),
  );
  if (usesFloor) {
    // No WebGL in this environment: the canvas layer must be hidden and
    // the copy fully readable — that IS the correct behavior, not a bug.
    await expect(page.locator("#scene-root")).toBeHidden();
    await expect(page.locator("#chapter-hero .copy")).toBeVisible();
  } else {
    const canvas = page.locator("#scene-root canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
  }
});

test("theme toggle flips the page theme and persists across reload", async ({
  page,
}) => {
  await page.goto("/");
  const initial = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await page.locator("#theme-toggle").click();
  const flipped = initial === "dark" ? "light" : "dark";
  await expect(page.locator(`html[data-theme="${flipped}"]`)).toBeAttached();
  await page.reload();
  // The FOUC guard must restore the persisted choice before/at first paint.
  await expect(page.locator(`html[data-theme="${flipped}"]`)).toBeAttached();
});

test("all four demo apps stay launchable from the demos hub", async ({
  page,
}) => {
  await page.goto("/");
  for (const href of ["/starter/", "/minimal/", "/qr-demo/", "/recorder/"]) {
    await expect(page.locator(`a.demo-card[href="${href}"]`)).toBeAttached();
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("still presents every chapter readable, without errors", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    for (const id of CHAPTER_IDS) {
      await page.locator(`#chapter-${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#chapter-${id} .copy`)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
