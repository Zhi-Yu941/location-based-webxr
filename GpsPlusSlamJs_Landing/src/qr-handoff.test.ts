/**
 * Why these tests matter: the QR handoff (v2 B2) is the page's only
 * desktop→phone bridge — showing it on the wrong device class (or not
 * showing it on a desktop without WebXR) silently kills the desktop
 * conversion path. The decision matrix and the DOM injection contract
 * are pinned here; the e2e suite only checks structural presence.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  QR_HANDOFF_CAPTION,
  QR_HANDOFF_CONTAINER_ID,
  QR_HANDOFF_MIN_VIEWPORT_WIDTH,
  applyQrHandoff,
  shouldShowQrHandoff,
} from "./qr-handoff";

/** Minimal stand-in for the #qr-handoff element. */
function fakeContainer(): { hidden: boolean; innerHTML: string } {
  return { hidden: true, innerHTML: "" };
}

function fakeDoc(
  container: { hidden: boolean; innerHTML: string } | null,
): Pick<Document, "getElementById"> {
  return {
    getElementById: (id: string) =>
      id === QR_HANDOFF_CONTAINER_ID
        ? (container as unknown as HTMLElement)
        : null,
  };
}

describe("shouldShowQrHandoff — device-class decision matrix", () => {
  it("shows on a desktop-class viewport without immersive-ar", () => {
    expect(
      shouldShowQrHandoff({
        arSupported: false,
        viewportWidth: 1280,
        hasFinePointer: true,
      }),
    ).toBe(true);
  });

  it("never shows on an AR-capable device (the CTA claim upgrade covers it)", () => {
    expect(
      shouldShowQrHandoff({
        arSupported: true,
        viewportWidth: 1280,
        hasFinePointer: true,
      }),
    ).toBe(false);
  });

  it("never shows on a phone-sized viewport, even with a fine pointer (shoot --mobile emulation)", () => {
    expect(
      shouldShowQrHandoff({
        arSupported: false,
        viewportWidth: 412,
        hasFinePointer: true,
      }),
    ).toBe(false);
  });

  it("never shows on a coarse-pointer device, even when the viewport is wide (landscape phone)", () => {
    expect(
      shouldShowQrHandoff({
        arSupported: false,
        viewportWidth: 915,
        hasFinePointer: false,
      }),
    ).toBe(false);
  });

  it("property: shows exactly when unsupported AND fine pointer AND desktop-wide", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 4000 }),
        fc.boolean(),
        (arSupported, viewportWidth, hasFinePointer) => {
          const expected =
            !arSupported &&
            hasFinePointer &&
            viewportWidth >= QR_HANDOFF_MIN_VIEWPORT_WIDTH;
          expect(
            shouldShowQrHandoff({ arSupported, viewportWidth, hasFinePointer }),
          ).toBe(expected);
        },
      ),
    );
  });
});

describe("applyQrHandoff — DOM injection & degrade paths", () => {
  it("injects an SVG QR of the given URL plus the caption, and unhides", () => {
    const container = fakeContainer();
    applyQrHandoff(fakeDoc(container), true, "https://gps.csutil.com/");
    expect(container.hidden).toBe(false);
    expect(container.innerHTML).toContain("<svg");
    expect(container.innerHTML).toContain(QR_HANDOFF_CAPTION);
  });

  it("leaves the container hidden and empty when the decision is false", () => {
    const container = fakeContainer();
    applyQrHandoff(fakeDoc(container), false, "https://gps.csutil.com/");
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe("");
  });

  it("does nothing when the container is missing from the DOM", () => {
    expect(() =>
      applyQrHandoff(fakeDoc(null), true, "https://gps.csutil.com/"),
    ).not.toThrow();
  });

  it("stays hidden on an empty URL (defensive: bad input must never break boot)", () => {
    const container = fakeContainer();
    expect(() => applyQrHandoff(fakeDoc(container), true, "")).not.toThrow();
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe("");
  });

  it("property: any non-empty URL string yields a scannable SVG injection", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (url) => {
        const container = fakeContainer();
        applyQrHandoff(fakeDoc(container), true, url);
        expect(container.hidden).toBe(false);
        expect(container.innerHTML).toContain("<svg");
      }),
    );
  });
});
