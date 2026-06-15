/**
 * QR-tracking demo — application entry point (glue).
 *
 * The "framework wiring — don't touch" layer. It composes the tested seams into
 * the demo flow:
 *
 *   1. Capability-gate: no WebXR → honest message, no crash.
 *   2. On the Start gesture: boot the store (with the `qrDetected` slice), the
 *      AR session, the debug view under `arWorldGroup`, and the demo controller.
 *   3. Per frame, hand the captured RGBA image to the controller; it detects,
 *      measures the size from depth, fits a pose, records into `qrDetected`, and
 *      glues the axis + cube to the code. The HUD renders the live size readout.
 *
 * Pure, unit-tested logic lives in the sibling modules (`capability`,
 * `pose-from-corners`, `qr-debug-view`, `hud-view`, `demo-store`,
 * `demo-controller`). This file is verified manually via `pnpm dev` on an AR
 * device (the §5 on-device gate) and through the faked Playwright e2e.
 */

import {
  recordQrDetection,
  recordQrSizeEstimate,
  selectQrSize,
} from "gps-plus-slam-app-framework/state";
import { applyChromiumProjectionLayerWorkaround } from "gps-plus-slam-app-framework/ar/chromium-camera-access-workaround";

import { getSeams } from "./seams.js";
import { createQrDemoStore, type QrDemoStore } from "./demo-store.js";
import { createQrDebugView, type QrDebugView } from "./qr-debug-view.js";
import { createQrDemoController } from "./demo-controller.js";
import { toHudView, type DemoStatus } from "./hud-view.js";
import { isDemoSupported, capabilityMessage } from "./capability.js";
import {
  createDebugLog,
  formatDetectionLine,
  formatStatusLine,
} from "./debug-log.js";

/**
 * Detection cadence (ms between detection STARTS) — ~8 Hz, within the plan §9
 * 5–10 Hz target. NOT per-frame: a phone renders ~30–60 fps and running the
 * detector + depth unproject every frame would waste CPU/battery and never
 * improve a throttled, coalesced pipeline.
 */
const DETECT_INTERVAL_MS = 125;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} element in index.html`);
  return node as T;
}

const dom = {
  app: el("app"),
  startScreen: el("start-screen"),
  startButton: el<HTMLButtonElement>("start-button"),
  capabilityMessage: el("capability-message"),
  hud: el("hud"),
  hudStatus: el("hud-status"),
  hudSize: el("hud-size"),
  hudSamples: el("hud-samples"),
  hudSpread: el("hud-spread"),
  hudLifecycle: el("hud-lifecycle"),
  debugLog: el("debug-log"),
  error: el("error"),
} as const;

let store: QrDemoStore | null = null;
let view: QrDebugView | null = null;
let stopFrames: (() => void) | null = null;
let status: DemoStatus = "idle";
/** The most-recently detected payload — drives which marker the HUD shows. */
let activeText: string | null = null;

/** On-screen detection log (cadence/tuning aid — see debug-log.ts). */
const debugLog = createDebugLog();
/** Clock of the previous lock, for the per-line Δt. */
let lastLockMs: number | null = null;

function renderDebugLog(): void {
  dom.debugLog.textContent = debugLog.lines.join("\n");
  // Keep the newest line in view.
  dom.debugLog.scrollTop = dom.debugLog.scrollHeight;
}

function renderHud(): void {
  const size =
    store && activeText
      ? selectQrSize(store.getState(), activeText)
      : undefined;
  const v = toHudView(status, size);
  dom.hudStatus.textContent = v.statusLabel;
  dom.hudSize.textContent = v.sizeLabel;
  dom.hudSamples.textContent = v.sampleLabel;
  dom.hudSpread.textContent = v.spreadLabel;
  dom.hudLifecycle.textContent = v.lifecycleLabel;
}

function failStart(err: unknown): void {
  stopFrames?.();
  stopFrames = null;
  view?.dispose();
  view = null;
  dom.startButton.disabled = false;
  dom.startButton.textContent = "Start AR";
  dom.startScreen.hidden = false;
  dom.hud.hidden = true;
  dom.capabilityMessage.hidden = false;
  dom.capabilityMessage.textContent =
    err instanceof Error ? err.message : "Failed to start the AR session.";
  console.error("[qr-tracking-demo] AR boot failed; rolled back.", err);
}

async function startAr(): Promise<void> {
  dom.startButton.disabled = true;
  dom.startButton.textContent = "Starting…";

  const seams = getSeams();
  store = createQrDemoStore();
  store.subscribe(renderHud);

  try {
    await seams.initAR(dom.app);
  } catch (err) {
    failStart(err);
    return;
  }

  const group = seams.getArWorldGroup();
  if (!group) {
    failStart(new Error("AR scene not ready — cannot place debug objects"));
    return;
  }

  view = createQrDebugView(group);
  const detect = seams.createDetect();
  const controller = createQrDemoController({
    detect,
    getDepthContext: () => seams.getDepthContext(),
    recordDetection: (event) => {
      activeText = event.text;
      store?.dispatch(recordQrDetection(event));
    },
    recordSize: (text, estimate) => {
      store?.dispatch(recordQrSizeEstimate({ text, estimate }));
      // Log every lock with the Δt since the previous one — the cadence signal
      // for tuning the throttle + accumulator thresholds on a real device.
      const nowMs = performance.now();
      debugLog.append(
        formatDetectionLine({
          clockMs: nowMs,
          deltaMs: lastLockMs === null ? null : nowMs - lastLockMs,
          text,
          sizeStatus: estimate.status,
          estimateM: estimate.estimateM,
          sampleCount: estimate.sampleCount,
        }),
      );
      lastLockMs = nowMs;
      renderDebugLog();
    },
    updateScene: (pose, sizeM) => {
      // Need a measured size to draw the cube; skip until one is available.
      if (sizeM !== null) view?.update(pose, sizeM);
    },
    onStatus: (next) => {
      status = next;
      debugLog.append(formatStatusLine(performance.now(), next));
      renderDebugLog();
      renderHud();
    },
    minIntervalMs: DETECT_INTERVAL_MS,
  });

  stopFrames = seams.startFrameSource((image) => controller.offerFrame(image));

  dom.startScreen.hidden = true;
  dom.hud.hidden = false;
  status = "scanning";
  renderHud();
}

async function main(): Promise<void> {
  // Chromium WebXR camera-access tab-crash workaround (safe to call always).
  applyChromiumProjectionLayerWorkaround();
  renderHud();

  const support = await getSeams().checkSupport();
  // Depth-less but WebXR-capable browsers still run (manual-size fallback), so
  // only a hard WebXR gap blocks; the message is informational otherwise.
  const message = capabilityMessage(support);
  if (!isDemoSupported(support)) {
    dom.startButton.disabled = true;
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent = message ?? "";
    return;
  }
  if (message) {
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent = message;
  }

  dom.startButton.addEventListener("click", () => {
    void startAr();
  });
}

window.addEventListener("beforeunload", () => {
  stopFrames?.();
  view?.dispose();
});

void main();
