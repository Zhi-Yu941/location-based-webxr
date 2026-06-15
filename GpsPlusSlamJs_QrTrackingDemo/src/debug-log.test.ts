/**
 * Debug log — unit tests.
 *
 * Why this matters: the on-device tuning relies on the Δt-per-lock readout being
 * accurate, and the buffer must stay bounded (it appends at the detection
 * cadence for the whole session).
 */

import { describe, it, expect } from "vitest";
import {
  createDebugLog,
  formatDetectionLine,
  formatStatusLine,
} from "./debug-log";

describe("createDebugLog", () => {
  it("keeps lines oldest-first and bounded to the cap", () => {
    const log = createDebugLog(3);
    log.append("a");
    log.append("b");
    log.append("c");
    log.append("d");
    expect(log.lines).toEqual(["b", "c", "d"]);
  });
});

describe("formatDetectionLine", () => {
  it("shows clock, Δt, payload, stage, median cm and sample count", () => {
    expect(
      formatDetectionLine({
        clockMs: 12340,
        deltaMs: 132,
        text: "https://demo/qr",
        sizeStatus: "estimated",
        estimateM: 0.201,
        sampleCount: 9,
      }),
    ).toBe('[12.34s Δ132ms] "https://demo/qr" estimated 20.1cm (9)');
  });

  it("uses — for the first lock and ? for an unknown size, and truncates long payloads", () => {
    const line = formatDetectionLine({
      clockMs: 0,
      deltaMs: null,
      text: "https://example.com/very/long/level/url",
      sizeStatus: "measuring",
      estimateM: null,
      sampleCount: 0,
    });
    expect(line).toContain("Δ—");
    expect(line).toContain("measuring ?");
    expect(line).toContain("…"); // truncated
  });
});

describe("formatStatusLine", () => {
  it("stamps a status transition", () => {
    expect(formatStatusLine(5000, "tracking")).toBe("[5.00s] → tracking");
  });
});
