/**
 * QR-tracking demo controller — unit tests.
 *
 * Why this matters: this pins the orchestration the whole demo rests on —
 * detect → sample depth → unproject → fit pose → measure size → (on lock)
 * record into the store + glue the scene. Every device dependency is faked, so
 * the flow is exercised without WebXR/camera/depth. The fake depth context maps
 * the corner screen points to a planar square in world space, so the measured
 * size is constant and converges.
 */

import { describe, it, expect } from "vitest";
import type {
  RgbaImage,
  QrDetection,
  Pose,
} from "gps-plus-slam-app-framework/ar";
import type { Vector3 } from "gps-plus-slam-app-framework/core";
import { createQrDemoController, type DepthContext } from "./demo-controller";

const TEXT = "https://demo/qr";
const IMG: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 100,
  height: 100,
};

// A pixel square on a 100×100 frame → a planar world square (z = −1).
const detection: QrDetection = {
  corners: [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ],
  text: TEXT,
};

/** Linear screen→world map; a square frame keeps the world quad square. */
const SCALE = 1 / 3;
function fakeDepthContext(): DepthContext {
  return {
    unprojector: {
      unproject: (dp): Vector3 | null => [
        dp.screenX * SCALE,
        dp.screenY * SCALE,
        -1,
      ],
    },
    depthAt: () => 1,
    cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function setup(
  overrides: Partial<Parameters<typeof createQrDemoController>[0]> = {},
) {
  const detections: string[] = [];
  const sizes: { text: string; estimateM: number | null }[] = [];
  const sceneUpdates: { pose: Pose; sizeM: number | null }[] = [];
  const statuses: string[] = [];
  const controller = createQrDemoController({
    detect: () => Promise.resolve<QrDetection | null>(detection),
    getDepthContext: () => fakeDepthContext(),
    recordDetection: (e) => detections.push(e.text),
    recordSize: (text, est) => sizes.push({ text, estimateM: est.estimateM }),
    updateScene: (pose, sizeM) => sceneUpdates.push({ pose, sizeM }),
    onStatus: (s) => statuses.push(s),
    requiredLockCount: 2,
    ...overrides,
  });
  return { controller, detections, sizes, sceneUpdates, statuses };
}

async function feed(
  controller: { offerFrame: (i: RgbaImage) => void },
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    controller.offerFrame(IMG);
    await flush();
  }
}

describe("createQrDemoController", () => {
  it("locks after N detections and records detection + size + scene update", async () => {
    const { controller, detections, sizes, sceneUpdates, statuses } = setup();
    await feed(controller, 4);

    expect(detections).toContain(TEXT);
    expect(sizes.length).toBeGreaterThan(0);
    // The measured square has side 60/100 * SCALE = 0.2 m.
    expect(sizes.at(-1)?.estimateM).toBeCloseTo(0.2, 3);
    expect(sceneUpdates.length).toBeGreaterThan(0);
    expect(sceneUpdates.at(-1)?.sizeM).toBeCloseTo(0.2, 3);
    expect(controller.status).toBe("tracking");
    expect(statuses).toContain("scanning");
    expect(statuses).toContain("tracking");
  });

  it('converges the size to "estimated" after enough samples', async () => {
    const { controller, sizes } = setup();
    await feed(controller, 12);
    // Constant square → spread 0 → estimated once minSamples is reached.
    expect(sizes.at(-1)?.estimateM).toBeCloseTo(0.2, 3);
    expect(controller.status).toBe("tracking");
  });

  it("does not record or lock when depth is unavailable", async () => {
    const { controller, detections, sceneUpdates } = setup({
      getDepthContext: () => null,
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not record when a corner has no depth read", async () => {
    const ctx = fakeDepthContext();
    const { controller, detections } = setup({
      getDepthContext: () => ({ ...ctx, depthAt: () => null }),
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
  });

  it("stays scanning when nothing is detected", async () => {
    const { controller, detections } = setup({
      detect: () => Promise.resolve(null),
    });
    await feed(controller, 3);
    expect(detections).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("reset() clears accumulators and returns to idle", async () => {
    const { controller } = setup();
    await feed(controller, 4);
    controller.reset();
    expect(controller.status).toBe("idle");
  });
});
