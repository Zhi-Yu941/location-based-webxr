/**
 * Persistent-anchor starter — application entry point (glue).
 *
 * This is the "framework wiring — don't touch" layer. It composes the
 * tested seams into the persistent-anchor flow:
 *
 *   1. Capability-gate (E1): no WebXR/GPS → honest message, no crash.
 *   2. On a user gesture, boot the store + AR session + GPS/orientation.
 *   3. Coach the user to move using `computeOnboardingGuidance`.
 *   4. cache-miss → soft-gated "Place anchor" → `createGpsAnchor` + encode the
 *      anchor into the `?show=` URL param (decision F1).
 *      cache-hit  → seed `createGpsAnchor` from the URL-decoded anchor and let
 *                   it re-converge, then reveal the marker in its `ui` style.
 *
 * The ONE place a new developer edits to drop in their own use case is
 * `createAnchorMarker()` in `./marker.ts`. Everything here is plumbing.
 *
 * Pure, unit-tested logic lives in the sibling modules
 * (`setup-state-machine`, `url-anchor-state`, `guidance-view`,
 * `placement-view`, `capability`). This file is verified manually via
 * `pnpm dev` on an AR device, the same convention as the MinimalExample.
 */

import {
  createSlamAppStore,
  createGpsPositionHandler,
  updateDeviceOrientation,
  startSession,
  selectTrackingQuality,
  computeOnboardingGuidance,
  selectAlignmentMatrix,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import {
  initAR,
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  setTrackingStore,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import {
  startGpsWatch,
  stopGpsWatch,
  startOrientationWatch,
  requestDeviceOrientationPermission,
  type GpsPosition,
} from "gps-plus-slam-app-framework/sensors";
import {
  checkWebXRSupport,
  checkGeolocationPermission,
} from "gps-plus-slam-app-framework/sensors";
import {
  createGpsAnchor,
  type GpsAnchor,
} from "gps-plus-slam-app-framework/visualization";
import type { LatLong, LatLongAlt } from "gps-plus-slam-app-framework/core";

import {
  initialSetupState,
  setupReducer,
  canPlaceAnchor,
  type SetupState,
  type SetupEvent,
} from "./setup-state-machine.js";
import {
  decodeShowParam,
  encodeAnchorsToShowParam,
  type AnchorSpec,
} from "./url-anchor-state.js";
import { toGuidanceView } from "./guidance-view.js";
import { toPlacementView } from "./placement-view.js";
import { isFullySupported, capabilityMessage } from "./capability.js";
// --- your content here -----------------------------------------------------
import { createAnchorMarker, type MarkerOptions } from "./marker.js";
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DOM lookup
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} element in index.html`);
  return node as T;
}

const dom = {
  startScreen: el("start-screen"),
  startButton: el<HTMLButtonElement>("start-button"),
  capabilityMessage: el("capability-message"),
  guidance: el("guidance"),
  guidanceTitle: el("guidance-title"),
  guidanceBarFill: el("guidance-bar-fill"),
  guidancePercent: el("guidance-percent"),
  guidanceHint: el("guidance-hint"),
  placement: el("placement"),
  banner: el("banner"),
  error: el("error"),
  placeButton: el<HTMLButtonElement>("place-button"),
  copyLinkButton: el<HTMLButtonElement>("copy-link-button"),
  reloadPrompt: el("reload-prompt"),
} as const;

// ---------------------------------------------------------------------------
// App state (mutable glue)
// ---------------------------------------------------------------------------

type AppStore = ReturnType<typeof createSlamAppStore>;

let store: AppStore | null = null;
let setupState: SetupState = initialSetupState;
let anchor: GpsAnchor | null = null;
let lastGps: LatLongAlt | null = null;
let lastTrackingReady = false;

/**
 * Run a framework selector against the live store. Each selector is typed
 * against a slightly different internal root shape; only the slices it reads
 * exist at runtime, so the cast through `unknown` is safe (same pattern as
 * the MinimalExample).
 */
function sel<S, R>(selector: (state: S) => R): R {
  if (!store) throw new Error("store not initialised");
  return selector(store.getState() as unknown as S);
}

function toLatLongAlt(pos: GpsPosition): LatLongAlt {
  return typeof pos.altitude === "number" && Number.isFinite(pos.altitude)
    ? { lat: pos.lat, lon: pos.lon, altitude: pos.altitude }
    : { lat: pos.lat, lon: pos.lon, altitude: 0 };
}

// ---------------------------------------------------------------------------
// Rendering — copy the tested view-models onto the DOM (no logic here)
// ---------------------------------------------------------------------------

function renderGuidance(): void {
  const report = store ? sel(selectTrackingQuality) : null;
  const view = toGuidanceView(computeOnboardingGuidance(report));
  dom.guidanceTitle.textContent = view.title;
  dom.guidanceBarFill.style.width = `${view.barWidthPct}%`;
  dom.guidanceBarFill.className = `tone-${view.tone}`;
  dom.guidancePercent.textContent = view.percentText;
  dom.guidanceHint.textContent = view.hint;
}

function renderPlacement(): void {
  const view = toPlacementView(setupState);
  dom.banner.textContent = view.banner;
  dom.placeButton.hidden = !view.button.visible;
  dom.placeButton.textContent = view.button.label;
  dom.placeButton.disabled = view.button.disabled;
  dom.error.hidden = view.error === null;
  dom.error.textContent = view.error ?? "";
  dom.copyLinkButton.hidden = !view.copyLink.visible;
  dom.reloadPrompt.hidden = !view.reloadPrompt;
}

function render(): void {
  renderGuidance();
  renderPlacement();
}

// ---------------------------------------------------------------------------
// Setup FSM dispatch
// ---------------------------------------------------------------------------

function dispatchSetup(event: SetupEvent): void {
  const next = setupReducer(setupState, event);
  if (next === setupState) return;
  setupState = next;
  render();
}

/** Translate the onboarding guidance into the FSM's trackingReady flag. */
function syncTrackingReady(): void {
  if (!store) return;
  const report = sel(selectTrackingQuality);
  const ready = computeOnboardingGuidance(report).phase === "ready";
  if (ready !== lastTrackingReady) {
    lastTrackingReady = ready;
    dispatchSetup({ type: "TRACKING_READY_CHANGED", ready });
  }
}

function onStoreChanged(): void {
  syncTrackingReady();
  renderGuidance();
}

// ---------------------------------------------------------------------------
// Anchor creation — anchors `createAnchorMarker()` to a GPS coordinate
// ---------------------------------------------------------------------------

function spawnAnchor(
  gpsPoint: LatLong | LatLongAlt,
  skipBootstrap: boolean,
  markerOptions: MarkerOptions = {},
): GpsAnchor {
  const arWorldGroup = getArWorldGroup();
  const camera = getCamera();
  if (!arWorldGroup || !camera) {
    throw new Error("AR scene not ready — cannot place anchor");
  }
  const marker = createAnchorMarker(markerOptions);
  arWorldGroup.add(marker);
  return createGpsAnchor({
    object3D: marker,
    arWorldGroup,
    camera,
    gpsPoint,
    skipBootstrap,
    getAlignmentMatrix: () => sel(selectAlignmentMatrix),
    getGpsZeroRef: (): LatLong | null => sel(selectZeroReference),
    getCurrentGpsPoint: () => lastGps,
  });
}

// ---------------------------------------------------------------------------
// URL `?show=` persistence (decision F1) — the anchor lives in the page link,
// so reloading restores it and the link can be shared to another device.
// ---------------------------------------------------------------------------

/** Build the minimal default-styled anchor spec from a live GPS fix. */
function anchorSpecFromGps(gps: LatLongAlt): AnchorSpec {
  return {
    lat: gps.lat,
    lon: gps.lon,
    alt: gps.altitude ?? 0,
    ui: 1,
    scale: 1,
    rotationDeg: 0,
  };
}

/** Encode the anchors into `?show=` without adding a history entry. */
function writeShowParam(anchors: readonly AnchorSpec[]): void {
  const param = encodeAnchorsToShowParam(anchors);
  const url = `${location.pathname}?show=${param}${location.hash}`;
  history.replaceState(null, "", url);
}

/** Decode the first anchor from the current `?show=` param, or null. */
function readCachedAnchor(): AnchorSpec | null {
  const raw = new URLSearchParams(location.search).get("show");
  const decoded = decodeShowParam(raw);
  return decoded?.[0] ?? null;
}

/** Copy the shareable page link, flipping the button label as feedback. */
async function copyShareLink(): Promise<void> {
  const idleLabel = dom.copyLinkButton.textContent ?? "Copy link";
  try {
    await navigator.clipboard.writeText(location.href);
    dom.copyLinkButton.textContent = "Link copied ✓";
  } catch {
    dom.copyLinkButton.textContent = "Copy failed — long-press the link";
  }
  window.setTimeout(() => {
    dom.copyLinkButton.textContent = idleLabel;
  }, 2000);
}

// ---------------------------------------------------------------------------
// Placement action (cache-miss branch) — synchronous (URL `?show=` write via
// history.replaceState), but still routed through the setup FSM's
// saving → saved / revert + error transitions so the placement view-model
// renders the in-progress → final states consistently.
// ---------------------------------------------------------------------------

function placeAnchor(): void {
  if (!canPlaceAnchor(setupState)) return;
  dispatchSetup({ type: "PLACE_REQUESTED" });
  try {
    const gps = lastGps;
    if (!gps)
      throw new Error("No GPS fix yet — wait for a location, then retry");
    anchor = spawnAnchor(gps, false);
    writeShowParam([anchorSpecFromGps(gps)]);
    dispatchSetup({ type: "PLACE_SUCCEEDED" });
  } catch (err) {
    dispatchSetup({
      type: "PLACE_FAILED",
      message: err instanceof Error ? err.message : "Failed to place anchor",
    });
  }
}

// ---------------------------------------------------------------------------
// AR boot (user gesture)
// ---------------------------------------------------------------------------

async function startAr(): Promise<void> {
  dom.startButton.disabled = true;
  dom.startButton.textContent = "Starting…";

  store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
  store.subscribe(onStoreChanged);

  // Tracking restart detection must be wired before initAR.
  setTrackingStore(store);

  const appContainer = el("app");
  try {
    await initAR(appContainer);
  } catch (err) {
    dom.startButton.disabled = false;
    dom.startButton.textContent = "Start AR";
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent =
      err instanceof Error ? err.message : "Failed to start the AR session.";
    return;
  }

  // Recording must be active for the GPS coordinator to feed alignment.
  store.dispatch(
    startSession({
      scenarioName: "anchor-starter",
      sessionName: "live",
      startTime: Date.now(),
    }),
  );

  // GPS → store (+ remember the latest fix for the anchor's getCurrentGpsPoint).
  const gpsHandler = createGpsPositionHandler({
    store,
    getArPose: getCurrentArPose,
  });
  startGpsWatch((pos) => {
    lastGps = toLatLongAlt(pos);
    gpsHandler(pos);
  });

  // Device orientation (compass) feeds the GPS event payload.
  await requestDeviceOrientationPermission();
  startOrientationWatch((orientation) => updateDeviceOrientation(orientation));

  // Reveal the live UI and choose the branch from the cache.
  dom.startScreen.hidden = true;
  dom.guidance.hidden = false;
  dom.placement.hidden = false;

  // Wire the soft-gated "Place anchor" button to the cache-miss placement
  // flow. `placeAnchor` itself no-ops unless the FSM currently allows it.
  dom.placeButton.addEventListener("click", () => placeAnchor());
  dom.copyLinkButton.addEventListener("click", () => {
    void copyShareLink();
  });

  const cached = readCachedAnchor();
  if (cached) {
    // cache-hit: seed from the URL-decoded GPS and let it re-converge as
    // alignment settles (skipBootstrap — no live median accumulation), then
    // reveal the marker in its requested `ui` style.
    lastGps = { lat: cached.lat, lon: cached.lon, altitude: cached.alt };
    anchor = spawnAnchor(lastGps, true, {
      ui: cached.ui,
      scale: cached.scale,
      rotationDeg: cached.rotationDeg,
    });
  }
  dispatchSetup({ type: "BOOTED", hasCachedAnchor: cached !== null });
  render();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  render();

  const [webxr, geolocation] = await Promise.all([
    checkWebXRSupport(),
    checkGeolocationPermission(),
  ]);
  const support = {
    webxr: webxr.supported,
    geolocation: geolocation.supported,
  };

  if (!isFullySupported(support)) {
    // E1: honest, capability-gated message instead of a crash.
    dom.startButton.disabled = true;
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent = capabilityMessage(support) ?? "";
    return;
  }

  dom.startButton.addEventListener("click", () => {
    void startAr();
  });
}

window.addEventListener("beforeunload", () => {
  stopGpsWatch();
  anchor?.dispose();
});

void main();
