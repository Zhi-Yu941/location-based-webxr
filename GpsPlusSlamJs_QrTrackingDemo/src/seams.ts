/**
 * Device seam (DEV-overridable) for the QR-tracking demo.
 *
 * `main.ts` is glue-only: it composes the tested modules (controller, debug
 * view, HUD, store) with the device-specific functions here. In a desktop
 * Playwright browser there is no WebXR / camera / depth, so the e2e suite swaps
 * a fake implementation in via `window.__qrDemoSeams` (installed with
 * `addInitScript` before page scripts run).
 *
 * PROD-INERT GUARANTEE: the override is consulted only under
 * `import.meta.env.DEV && !import.meta.env.VITEST`. A production build statically
 * sets `import.meta.env.DEV` to `false`, so Vite strips the branch and the
 * `window` read never ships; unit tests (`VITEST`) ignore it too. Covered by
 * `seams.test.ts`.
 *
 * The PROD frame/depth source is the **on-device-verified layer** (the §5 gate
 * is manual, exactly as the parent QR plan defers the Recorder's live camera
 * wiring): it uses the framework's public image/depth capture callbacks. The
 * tested demo logic + the faked e2e do not depend on its runtime behaviour.
 */

import {
  initAR,
  endARSession,
  getArWorldGroup,
  setImageCaptureCallback,
  startImageCapture,
  stopImageCapture,
  setDepthCaptureCallback,
  startDepthCapture,
  stopDepthCapture,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import {
  createBarcodeDetectorFrontEnd,
  createDepthUnprojector,
  type RgbaImage,
  type QrDetection,
} from "gps-plus-slam-app-framework/ar";
import { checkWebXRSupport } from "gps-plus-slam-app-framework/sensors";
import type {
  DepthSample,
  DepthPoint,
} from "gps-plus-slam-app-framework/types";
import type { Object3D } from "three";
import type { DemoCapabilitySupport } from "./capability.js";
import type { DepthContext } from "./demo-controller.js";

/** The device functions a Playwright e2e fake may override. */
export interface QrDemoSeams {
  checkSupport(): Promise<DemoCapabilitySupport>;
  initAR(container: HTMLElement): Promise<void>;
  endARSession(): Promise<void>;
  getArWorldGroup(): Object3D | null;
  /** A detect+decode function (BarcodeDetector front-end), or always-null. */
  createDetect(): (image: RgbaImage) => Promise<QrDetection | null>;
  /** Latest frame's depth context (unprojector + depth lookup + camera pose). */
  getDepthContext(): DepthContext | null;
  /** Start delivering frames to `onImage`; returns a stop function. */
  startFrameSource(onImage: (image: RgbaImage) => void): () => void;
}

declare global {
  interface Window {
    /** DEV-only e2e override; `undefined` in production (see prod-inert note). */
    __qrDemoSeams?: Partial<QrDemoSeams>;
  }
}

// --- PROD frame/depth state (the on-device-verified layer) -----------------

let latestDepthSample: DepthSample | null = null;

/** Nearest-neighbour depth lookup over the sample's grid (screen-space). */
function nearestDepth(
  points: readonly DepthPoint[],
  screenX: number,
  screenY: number,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dx = p.screenX - screenX;
    const dy = p.screenY - screenY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = p.depthM;
    }
  }
  return best;
}

/** Decode a captured JPEG blob to RGBA and hand it to the controller. */
async function decodeToRgba(blob: Blob): Promise<RgbaImage | null> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  bitmap.close();
  return { data: imageData.data, width, height };
}

/** The production seams — the unmodified framework device wiring. */
export const realSeams: QrDemoSeams = {
  async checkSupport(): Promise<DemoCapabilitySupport> {
    const xr = await checkWebXRSupport();
    // Depth support is confirmed at runtime when samples actually arrive; treat
    // it as available wherever WebXR is, and degrade if the depth callback never
    // fires (the auto-size path simply stays in 'unknown').
    return { webxr: xr.supported, depthSensing: xr.supported };
  },
  async initAR(container: HTMLElement): Promise<void> {
    // Depth callback must be registered before initAR.
    setDepthCaptureCallback((sample) => {
      latestDepthSample = sample;
    });
    await initAR(container, {
      enableCameraAccess: true,
      enableDepthSensingFeature: true,
      enableCameraTextureAcquisition: true,
    });
    startDepthCapture();
  },
  async endARSession(): Promise<void> {
    stopDepthCapture();
    latestDepthSample = null;
    await endARSession();
  },
  getArWorldGroup,
  createDetect() {
    const frontEnd = createBarcodeDetectorFrontEnd();
    if (!frontEnd) return () => Promise.resolve(null);
    return (image) => frontEnd.detect(image);
  },
  getDepthContext(): DepthContext | null {
    const sample = latestDepthSample;
    if (!sample?.projectionMatrix) return null;
    const unprojector = createDepthUnprojector(
      sample.cameraPos,
      sample.cameraRot,
      sample.projectionMatrix,
    );
    if (!unprojector) return null;
    return {
      unprojector,
      depthAt: (x, y) => nearestDepth(sample.points, x, y),
      cameraPose: { position: sample.cameraPos, rotation: sample.cameraRot },
    };
  },
  startFrameSource(onImage: (image: RgbaImage) => void): () => void {
    let stopped = false;
    setImageCaptureCallback(
      (captured) => {
        void decodeToRgba(captured.blob).then((rgba) => {
          if (!stopped && rgba) onImage(rgba);
        });
      },
      () => 0,
    );
    startImageCapture();
    return () => {
      stopped = true;
      stopImageCapture();
    };
  },
};

/**
 * Resolve the active device seams — the real framework wiring unless a DEV-only
 * `window.__qrDemoSeams` override is present (e2e). Inert in production and unit
 * tests (see the prod-inert guarantee above).
 */
export function getSeams(): QrDemoSeams {
  if (
    import.meta.env.DEV &&
    !import.meta.env.VITEST &&
    typeof window !== "undefined" &&
    window.__qrDemoSeams
  ) {
    return { ...realSeams, ...window.__qrDemoSeams };
  }
  return realSeams;
}
