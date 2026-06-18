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
 * wiring): it uses the framework's public **camera-frame RGBA** capture
 * (`setCameraFrameCallback` + `startCameraFrameCapture`, B2 — top-left RGBA at
 * the detection cadence, no JPEG
 * round-trip) and the depth capture callback. The tested demo logic + the faked
 * e2e do not depend on its runtime behaviour. `startFrameSource` stays as the
 * e2e frame-injection seam; in PROD its body just points the framework QR
 * callback at the controller.
 */

import {
  initAR,
  endARSession,
  getArWorldGroup,
  setCameraFrameCallback,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  setDepthCaptureCallback,
  startDepthCapture,
  stopDepthCapture,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import {
  createBarcodeDetectorFrontEnd,
  createQrSizeDepthContext,
  type RgbaImage,
  type QrDetection,
} from "gps-plus-slam-app-framework/ar";
import { checkWebXRSupport } from "gps-plus-slam-app-framework/sensors";
import type { DepthSample } from "gps-plus-slam-app-framework/types";
import { parseCaptureSizeParam } from "./capture-size-param.js";
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
  /**
   * Start delivering frames to `onImage` at the given detection cadence
   * (`intervalMs`); returns a stop function. The frame source is the SINGLE
   * cadence owner (Option A): the controller it feeds runs `minIntervalMs: 0`.
   */
  startFrameSource(
    onImage: (image: RgbaImage) => void,
    options?: { intervalMs?: number },
  ): () => void;
}

declare global {
  interface Window {
    /** DEV-only e2e override; `undefined` in production (see prod-inert note). */
    __qrDemoSeams?: Partial<QrDemoSeams>;
  }
}

// --- PROD frame/depth state (the on-device-verified layer) -----------------

let latestDepthSample: DepthSample | null = null;

/**
 * The active QR-frame consumer (the controller's `offerFrame`), set by
 * `startFrameSource`. The framework QR callback (registered in `initAR`, before
 * the framework `initAR` runs — it must be set first, like the depth callback)
 * forwards each throttled RGBA frame here. `null` when no source is running.
 */
let qrFrameConsumer: ((image: RgbaImage) => void) | null = null;

/**
 * Depth capture tuning for the QR demo (WS-A 2a). A DENSER grid than the SLAM
 * default (16) so a small QR has several depth nodes across its face, sampled
 * FASTER than the 1 Hz default so the size correlates with the ~8 Hz detection
 * cadence. `rgb: false` skips the per-point colour blit (the demo only needs
 * depth for sizing). The effective resolution is still capped by the native
 * WebXR depth buffer; `depthAt` bilinearly interpolates this grid.
 */
const QR_DEPTH_CONFIG = { gridSize: 64, intervalMs: 250, rgb: false };

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
    // Depth + QR-frame callbacks must both be registered BEFORE initAR (the
    // framework creates the depth sampler and the QR frame source inside it).
    setDepthCaptureCallback((sample) => {
      latestDepthSample = sample;
    });
    // The framework now delivers top-left RGBA directly (B2) — no JPEG
    // round-trip. Forward each throttled frame to the active consumer.
    setCameraFrameCallback((image) => qrFrameConsumer?.(image));
    await initAR(container, {
      enableCameraAccess: true,
      enableDepthSensingFeature: true,
      enableCameraTextureAcquisition: true,
    });
    startDepthCapture(QR_DEPTH_CONFIG);
  },
  async endARSession(): Promise<void> {
    stopDepthCapture();
    stopCameraFrameCapture();
    qrFrameConsumer = null;
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
    // The shared framework factory builds the unprojector + bilinear grid lookup
    // (WS-A: depth varies smoothly across a small QR face, not nearest-node) —
    // the SAME piece the Recorder's as-of resolver uses, so the two apps can't
    // diverge. The demo adds the PnP-only extras (camera pose + projection).
    const base = createQrSizeDepthContext(sample);
    if (!base) return null;
    return {
      ...base,
      cameraPose: { position: sample.cameraPos, rotation: sample.cameraRot },
      projectionMatrix: sample.projectionMatrix,
    };
  },
  startFrameSource(
    onImage: (image: RgbaImage) => void,
    options?: { intervalMs?: number },
  ): () => void {
    // The framework camera-frame callback (wired in initAR) forwards frames to
    // whatever consumer is active. Point it at this controller and start the
    // throttled capture — the source is the single cadence owner (Option A).
    qrFrameConsumer = onImage;
    // WS-C: allow a device tester to sweep the RGB capture resolution via
    // `?capture=<px>` (no rebuild). Absent → the framework default (1024, raised
    // from 512 by the 2026-06-17 on-device sweep).
    const captureSize =
      typeof window !== "undefined"
        ? parseCaptureSizeParam(window.location.search)
        : undefined;
    const captureConfig: { intervalMs?: number; captureSize?: number } = {};
    if (options?.intervalMs !== undefined)
      captureConfig.intervalMs = options.intervalMs;
    if (captureSize !== undefined) captureConfig.captureSize = captureSize;
    startCameraFrameCapture(
      Object.keys(captureConfig).length > 0 ? captureConfig : undefined,
    );
    return () => {
      qrFrameConsumer = null;
      stopCameraFrameCapture();
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
