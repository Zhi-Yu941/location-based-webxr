/**
 * Tests for the Stage-0 cold-start override toggle (URL-param reader).
 *
 * Why this matters: Stage 0 is a default-ON feature, so this reader defaults to
 * enabled and only an explicit `?coldStartOverride=0` (or `=false`) opts out.
 * This pins the exact opt-out values so a field tester can disable it (e.g. for
 * §6a calibration captures) and it never silently disables by accident.
 */

import { describe, it, expect } from "vitest";
import { coldStartOverrideEnabledFromSearch } from "./cold-start-override-flag";

describe("coldStartOverrideEnabledFromSearch", () => {
  it("is true by default — absent, empty, or any non-opt-out value", () => {
    expect(coldStartOverrideEnabledFromSearch("")).toBe(true);
    expect(coldStartOverrideEnabledFromSearch("?other=1")).toBe(true);
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=1")).toBe(
      true,
    );
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=true")).toBe(
      true,
    );
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=")).toBe(
      true,
    );
    expect(
      coldStartOverrideEnabledFromSearch("?foo=bar&coldStartOverride=yes"),
    ).toBe(true);
  });

  it("is false only for explicit opt-out: ?coldStartOverride=0 or =false", () => {
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=0")).toBe(
      false,
    );
    expect(coldStartOverrideEnabledFromSearch("?coldStartOverride=false")).toBe(
      false,
    );
    expect(
      coldStartOverrideEnabledFromSearch("?foo=bar&coldStartOverride=0"),
    ).toBe(false);
  });
});
