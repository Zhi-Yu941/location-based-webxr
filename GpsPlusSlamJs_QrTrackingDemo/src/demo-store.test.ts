/**
 * Demo store — unit test.
 *
 * Why this matters: the demo's whole observation surface is the opt-in
 * `qrDetected` slice wired via `extraReducers`. This pins that the slice is
 * actually present and that a detection + size estimate round-trips through it.
 */

import { describe, it, expect } from "vitest";
import {
  recordQrDetection,
  recordQrSizeEstimate,
  selectQrSize,
  selectLatestQrDetection,
  type RootWithQrDetected,
} from "gps-plus-slam-app-framework/state";
import { createQrDemoStore } from "./demo-store";

describe("createQrDemoStore", () => {
  it("wires the qrDetected slice and round-trips a detection + size", () => {
    const store = createQrDemoStore();
    const root = () => store.getState() as unknown as RootWithQrDetected;

    store.dispatch(
      recordQrDetection({
        text: "https://demo/qr",
        qrPoseWorld: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
        qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
        reprojectionErrorPx: 0,
        timestamp: 1,
      }),
    );
    store.dispatch(
      recordQrSizeEstimate({
        text: "https://demo/qr",
        estimate: {
          status: "estimated",
          estimateM: 0.2,
          sampleCount: 9,
          spreadM: 0.001,
        },
      }),
    );

    expect(selectLatestQrDetection(root(), "https://demo/qr")?.text).toBe(
      "https://demo/qr",
    );
    expect(selectQrSize(root(), "https://demo/qr")?.estimateM).toBe(0.2);
  });
});
