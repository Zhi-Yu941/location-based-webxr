/**
 * Device seam — unit test.
 *
 * Why this matters: the DEV override that lets the e2e fake WebXR must be
 * PROD-INERT and inert during unit tests (`VITEST`). Here we confirm `getSeams`
 * returns the real seams and that the real surface exposes every device function
 * `main.ts` depends on — a missing key would only surface as a runtime crash on
 * device otherwise.
 */

import { describe, it, expect } from "vitest";
import { getSeams, realSeams } from "./seams";

describe("getSeams", () => {
  it("returns the real seams under VITEST (override is inert)", () => {
    expect(getSeams()).toBe(realSeams);
  });

  it("exposes every device function main.ts wires", () => {
    expect(typeof realSeams.checkSupport).toBe("function");
    expect(typeof realSeams.initAR).toBe("function");
    expect(typeof realSeams.endARSession).toBe("function");
    expect(typeof realSeams.getArWorldGroup).toBe("function");
    expect(typeof realSeams.createDetect).toBe("function");
    expect(typeof realSeams.getDepthContext).toBe("function");
    expect(typeof realSeams.startFrameSource).toBe("function");
  });
});
