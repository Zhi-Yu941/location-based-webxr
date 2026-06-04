/**
 * Minimal GPS + AR hit-test example for gps-plus-slam-app-framework.
 *
 * Structural port of the stock three.js `webxr_ar_hittest` example
 * (button → AR session → hit-test reticle → tap-to-place), adapted for a
 * GPS-aligned framework. See ../README.md for the "ladder" narrative and the
 * plan doc
 * GpsPlusSlamJs_Docs/docs/2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md.
 *
 * What is testable vs. glue:
 * - The reticle view-model (./reticle.ts) and status formatter (./status.ts)
 *   are pure and unit-tested.
 * - Everything in this file is WebXR glue: it needs a real device with an
 *   immersive-ar session and is verified manually via `pnpm dev` on an
 *   AR-capable phone. It is deliberately kept small and copy-pasteable.
 *
 * Two framework deltas a porting developer must not get wrong:
 * 1. The "Enable GPS AR" button is app-rendered over `createEnableGpsArController`
 *    state — the framework owns the permission/enter-AR *sequence*, not the DOM.
 * 2. Placed AR content is parented under `getArWorldGroup()` (AR-local space),
 *    NOT the GPS-aligned scene root. The reticle below follows this rule.
 */
import {
  applyChromiumProjectionLayerWorkaround,
  createEnableGpsArController,
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  getScene,
  registerXrFrameUpdate,
  type EnableGpsArState,
} from 'gps-plus-slam-app-framework/ar';
import {
  createGpsPositionHandler,
  createSlamAppStore,
  selectAlignmentMatrix,
  selectGpsPositions,
  selectZeroReference,
  startSession,
  updateDeviceOrientation,
} from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import type {
  GpsPosition,
  RawDeviceOrientation,
} from 'gps-plus-slam-app-framework/sensors';
import { createGpsAnchor } from 'gps-plus-slam-app-framework/visualization';
import type { LatLong, LatLongAlt } from 'gps-plus-slam-app-framework/core';
import { Vector3 } from 'three';

import { ANCHOR_MODE, coSpawnAtWorldPose } from './co-spawn.js';
import { createReticleMesh, updateReticle } from './reticle.js';
import { decideTapPlacement } from './placement.js';
import { formatStatus } from './status.js';

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element in index.html`);
  }
  return element as T;
}

/**
 * Derive the button's label + disabled state from the controller status. Pure
 * mapping so the (verified-on-device) wiring stays a one-liner.
 */
function buttonView(state: EnableGpsArState): { label: string; disabled: boolean } {
  switch (state.status) {
    case 'checking':
      return { label: 'Checking AR support…', disabled: true };
    case 'unsupported':
      return { label: 'AR not supported on this device', disabled: true };
    case 'ready':
      return { label: 'Enable GPS AR', disabled: false };
    case 'starting':
      return { label: 'Starting…', disabled: true };
    case 'running':
      return { label: 'AR running', disabled: true };
    case 'error':
      return { label: `Retry — ${state.error ?? 'failed to start'}`, disabled: false };
  }
}

/**
 * Request a screen-centre hit-test source from the live session. Returns `null`
 * when the runtime does not expose `requestHitTestSource` (older WebXR builds).
 */
async function requestHitTestSource(
  session: XRSession
): Promise<XRHitTestSource | null> {
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const source = await session.requestHitTestSource?.({ space: viewerSpace });
  return source ?? null;
}

/**
 * Install the hit-test reticle and tap-to-place once AR is running. Ordinary
 * three.js example code apart from parenting the reticle under `arWorldGroup`
 * (AR-local). The actual placement (the contrast co-spawn) is delegated to
 * `onPlace` so the store-bound `createGpsAnchor` wiring stays in `main()`.
 */
function startArInteraction(deps: {
  hasGpsFix: () => boolean;
  onWaitingForGps: () => void;
  onPlace: (worldPosition: Vector3) => void;
}): void {
  const arWorldGroup = getArWorldGroup();
  if (!arWorldGroup) {
    return;
  }
  const reticle = createReticleMesh();
  arWorldGroup.add(reticle);

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  let selectWired = false;

  registerXrFrameUpdate(({ frame, referenceSpace, session }) => {
    if (!selectWired) {
      selectWired = true;
      // A `select` is the AR "tap". The GPS gate (decideTapPlacement) ignores
      // taps until the first fix so both objects share a start pose (Step 4).
      session.addEventListener('select', () => {
        const decision = decideTapPlacement({
          hasGpsFix: deps.hasGpsFix(),
          reticleVisible: reticle.visible,
        });
        if (decision.kind === 'waiting-for-gps') {
          deps.onWaitingForGps();
          return;
        }
        if (decision.kind === 'no-surface') {
          return;
        }
        // The reticle's world transform is current from the last rendered frame.
        deps.onPlace(reticle.getWorldPosition(new Vector3()));
      });
    }

    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true;
      requestHitTestSource(session)
        .then((source) => {
          hitTestSource = source;
        })
        .catch(() => {
          // Allow a later frame to retry if the request failed transiently.
          hitTestSourceRequested = false;
        });
      session.addEventListener('end', () => {
        hitTestSource = null;
        hitTestSourceRequested = false;
      });
    }

    if (!hitTestSource) {
      updateReticle(reticle, null);
      return;
    }

    const [hit] = frame.getHitTestResults(hitTestSource);
    const pose = hit?.getPose(referenceSpace);
    updateReticle(reticle, pose ? pose.transform.matrix : null);
  });
}

/** Narrow a GPS fix to the anchor's seed shape (drop altitude when absent). */
function toGpsSeed(position: GpsPosition): LatLong | LatLongAlt {
  return typeof position.altitude === 'number'
    ? { lat: position.lat, lon: position.lon, altitude: position.altitude }
    : { lat: position.lat, lon: position.lon };
}

function main(): void {
  // Apply the Chromium WebXR camera-access tab-crash workaround before any
  // session setup. It always forces the XRWebGLLayer fallback (required on
  // every affected Chrome build, incl. Chrome 150) and additionally persists
  // the baseLayer only on the affected Chrome window, so calling it
  // unconditionally here is safe.
  applyChromiumProjectionLayerWorkaround();

  const statusEl = getElement<HTMLPreElement>('status');
  const button = getElement<HTMLButtonElement>('enter-ar');
  const arRoot = getElement<HTMLDivElement>('ar-root');

  // The store boots the framework end-to-end (covered by boot.test.ts) and,
  // once recording, fuses GPS + AR pose into the alignment matrix that
  // createGpsAnchor reads.
  const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
  let gpsFixCount = 0;
  let lastGps: LatLong | LatLongAlt | null = null;

  function refreshStatus(): void {
    statusEl.textContent = formatStatus({
      isRecording: store.getState().recording.isRecording,
      actionCount: store.getState().recording.actionCount,
      gpsPositionCount: gpsFixCount,
      failedWriteCount: store.getState().recording.failedWriteCount,
    });
  }

  // Flash a transient hint when the user taps before the first GPS fix, then
  // restore the normal status panel (honours the async/feedback UX rule).
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  function showHint(message: string): void {
    statusEl.textContent = message;
    if (hintTimer !== undefined) {
      clearTimeout(hintTimer);
    }
    hintTimer = setTimeout(refreshStatus, 1500);
  }

  // GPS → store. The coordinator only records while a session is active and an
  // AR pose is available, so it is created once and driven from onGpsPosition.
  const gpsHandler = createGpsPositionHandler({
    store,
    getArPose: getCurrentArPose,
  });

  /**
   * The Step 4 contrast co-spawn: place the deliberate floater cube under the
   * scene root and an anchored marker under arWorldGroup at the same world pose,
   * then hand the marker to createGpsAnchor in its default bootstrap.
   */
  function placeContrastPair(worldPosition: Vector3): void {
    const scene = getScene();
    const arWorldGroup = getArWorldGroup();
    const camera = getCamera();
    if (!scene || !arWorldGroup || !camera || lastGps === null) {
      return;
    }

    const { anchorObject } = coSpawnAtWorldPose({ scene, arWorldGroup, worldPosition });

    // Default bootstrap (NO skipBootstrap): the anchor holds the tapped pose
    // while sampling GPS, then makes its first lazy correction off-screen.
    // Each framework selector is typed against a slightly different internal
    // root shape; only the slices it reads exist at runtime, so the cast through
    // `unknown` is safe (same pattern as selectGpsPositions / AnchorStarter).
    createGpsAnchor({
      object3D: anchorObject,
      arWorldGroup,
      camera,
      gpsPoint: lastGps,
      mode: ANCHOR_MODE,
      getAlignmentMatrix: () =>
        selectAlignmentMatrix(
          store.getState() as unknown as Parameters<typeof selectAlignmentMatrix>[0]
        ),
      getGpsZeroRef: (): LatLong | null =>
        selectZeroReference(
          store.getState() as unknown as Parameters<typeof selectZeroReference>[0]
        ),
      getCurrentGpsPoint: () => lastGps,
    });
  }

  const controller = createEnableGpsArController();
  controller.subscribe((state) => {
    const view = buttonView(state);
    button.textContent = view.label;
    button.disabled = view.disabled;
    if (state.status === 'running') {
      // Recording must be active for the GPS coordinator to feed alignment.
      store.dispatch(
        startSession({
          scenarioName: 'minimal-example',
          sessionName: 'live',
          startTime: Date.now(),
        })
      );
      startArInteraction({
        hasGpsFix: () => gpsFixCount > 0,
        onWaitingForGps: () => {
          showHint('waiting for GPS…');
        },
        onPlace: placeContrastPair,
      });
    }
  });

  button.addEventListener('click', () => {
    void controller.enable({
      container: arRoot,
      requestHitTest: true,
      onGpsPosition: (position: GpsPosition) => {
        gpsFixCount += 1;
        lastGps = toGpsSeed(position);
        gpsHandler(position);
        refreshStatus();
      },
      onOrientation: (orientation: RawDeviceOrientation) => {
        updateDeviceOrientation(orientation);
      },
    });
  });

  store.subscribe(refreshStatus);
  refreshStatus();
  // `selectGpsPositions` is exercised in boot.test.ts; referenced here so the
  // smoke test's selector stays wired to the example's real import graph.
  void selectGpsPositions;

  void controller.refreshSupport();
}

main();
