/**
 * Why these tests matter: round-9 turned the hero code snippet from
 * desktop-only (display:none on phones) into a <details> expander that
 * is collapsed by default on small viewports and expanded on desktop.
 * If the decision flips, phones lose their fold (the v2 B3 constraint)
 * or desktops hide the page's strongest developer hook behind a click.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  HERO_SNIPPET_ID,
  applyHeroSnippetDefault,
  shouldExpandHeroSnippet,
} from "./hero-snippet";

describe("shouldExpandHeroSnippet — viewport decision", () => {
  it("expands on a desktop viewport", () => {
    expect(shouldExpandHeroSnippet({ width: 1280, height: 800 })).toBe(true);
  });

  it("stays collapsed on phone-width viewports (the v2 fold constraint)", () => {
    expect(shouldExpandHeroSnippet({ width: 412, height: 915 })).toBe(false);
  });

  it("stays collapsed on short landscape viewports", () => {
    expect(shouldExpandHeroSnippet({ width: 915, height: 412 })).toBe(false);
  });

  it("property: expands exactly when wider than 720 AND taller than 500", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 0, max: 4000 }),
        (width, height) => {
          expect(shouldExpandHeroSnippet({ width, height })).toBe(
            width > 720 && height > 500,
          );
        },
      ),
    );
  });
});

describe("applyHeroSnippetDefault", () => {
  function fakeDetails(open: boolean): { open: boolean } {
    return { open };
  }

  function fakeDoc(
    details: { open: boolean } | null,
  ): Pick<Document, "getElementById"> {
    return {
      getElementById: (id: string) =>
        id === HERO_SNIPPET_ID ? (details as unknown as HTMLElement) : null,
    };
  }

  it("opens the details on desktop and collapses it on phones", () => {
    const details = fakeDetails(false);
    applyHeroSnippetDefault(fakeDoc(details), true);
    expect(details.open).toBe(true);
    applyHeroSnippetDefault(fakeDoc(details), false);
    expect(details.open).toBe(false);
  });

  it("does nothing when the element is missing (static floor must not break)", () => {
    expect(() => applyHeroSnippetDefault(fakeDoc(null), true)).not.toThrow();
  });
});
