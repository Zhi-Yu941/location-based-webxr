/**
 * Tests for the Stage-0 cold-start override debug toggle (URL-param reader).
 *
 * Why this matters: the override is a debug/experiment opt-in surfaced via
 * `?coldStartOverride=1`. This pins the exact accepted values so the field
 * toggle behaves predictably and never enables by accident.
 */

import { describe, it, expect } from "vitest";
import { coldStartOverrideEnabledFromSearch } from "./cold-start-override-flag";

describe("coldStartOverrideEnabledFromSearch", () => {
  it("is true for ?coldStartOverride=1 and =true", () => {
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=1")).toBe(
      true,
    );
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=true")).toBe(
      true,
    );
    expect(
      coldStartOverrideEnabledFromSearch("?foo=bar&coldStartOverride=1"),
    ).toBe(true);
  });

  it("is false when absent, empty, or any other value", () => {
    expect(coldStartOverrideEnabledFromSearch("")).toBe(false);
    expect(coldStartOverrideEnabledFromSearch("?other=1")).toBe(false);
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=0")).toBe(
      false,
    );
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=")).toBe(
      false,
    );
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=yes")).toBe(
      false,
    );
  });
});
