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
 * - The reticle view-model (the framework's `hit-test-reticle.ts`) and status
 *   formatter (./status.ts) are pure and unit-tested.
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
  type SubscribableStore,
} from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import type {
  GpsPosition,
  RawDeviceOrientation,
} from 'gps-plus-slam-app-framework/sensors';
import {
  createGpsAnchor,
  createReticleMesh,
  enableArWorldGroupAlignment,
  updateReticle,
  worldNueToGps,
} from 'gps-plus-slam-app-framework/visualization';
import type { LatLong, LatLongAlt } from 'gps-plus-slam-app-framework/core';
import { Vector3 } from 'three';

import { ANCHOR_MODE, coSpawnAtWorldPose } from './co-spawn.js';
import { createConnectorLine } from './connector-line.js';
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
    case 'stopping':
      return { label: 'Stopping…', disabled: true };
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
  let unregisterFrameUpdate: (() => void) | null = null;

  unregisterFrameUpdate = registerXrFrameUpdate(({ frame, referenceSpace, session }) => {
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
      // Registered once with the other per-session setup so a hit-test retry
      // (which re-enters the request block below) cannot add duplicate listeners.
      session.addEventListener('end', () => {
        hitTestSource = null;
        hitTestSourceRequested = false;
        // Unregister THIS session's frame callback. `startArInteraction` runs
        // once per `running` transition against a fresh arWorldGroup + reticle,
        // so without this a later AR re-entry would leave the old callback (and
        // any source it resolved after `end`) running against the new session.
        unregisterFrameUpdate?.();
        unregisterFrameUpdate = null;
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

    const { cube, anchorObject } = coSpawnAtWorldPose({ scene, arWorldGroup, worldPosition });

    // Draw a red line from the anchored sphere to its floater cube so the pair
    // (and the drift that opens between them) is identifiable with several pairs
    // on screen. The line is a child of the sphere — end A is the sphere origin,
    // end B tracks the cube's world pose each frame.
    const connector = createConnectorLine({ sphere: anchorObject, cube });
    registerXrFrameUpdate(connector.update);

    // Default bootstrap (NO skipBootstrap): the anchor holds the tapped pose
    // while sampling its own GPS-world pose, then makes its first lazy
    // correction off-screen. The bootstrap source is the OBJECT's world pose
    // (where it was actually placed), converted to GPS via `worldNueToGps` —
    // NOT the phone's GPS fix. This pins the anchor to the tapped point, not the
    // device, and only works because `enableArWorldGroupAlignment` makes the
    // object's world position GPS-world NUE. Each framework selector is typed
    // against a slightly different internal root shape; only the slices it reads
    // exist at runtime, so the cast through `unknown` is safe (same pattern as
    // selectGpsPositions / AnchorStarter).
    const sampleScratch = new Vector3();
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
      getCurrentGpsPoint: (): LatLongAlt | null => {
        const zero = selectZeroReference(
          store.getState() as unknown as Parameters<typeof selectZeroReference>[0]
        );
        const alignment = selectAlignmentMatrix(
          store.getState() as unknown as Parameters<typeof selectAlignmentMatrix>[0]
        );
        // No GPS-world frame yet — skip this bootstrap tick (mirrors "no fix").
        if (zero === null || alignment === null) return null;
        return worldNueToGps(anchorObject.getWorldPosition(sampleScratch), zero);
      },
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
      // GPS-register the AR view: lerp the store's alignment onto arWorldGroup
      // so the camera and every anchored child ride the alignment together (the
      // scene-root contrast cube deliberately does NOT, so it visibly slides).
      // Without this the camera is pure-VIO and anchors must absorb the full
      // alignment delta on each re-registration. Fire-and-forget: the framework
      // ties this binding's disposal to the AR session teardown (it registers a
      // session disposer that `resetWebXRState()` flushes), so re-entering AR
      // never leaks the previous session's lerp + store subscription.
      const arWorldGroup = getArWorldGroup();
      if (arWorldGroup) {
        enableArWorldGroupAlignment({
          store: store as unknown as SubscribableStore,
          arWorldGroup,
        });
      }
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
      // This example only places content under a hit-test reticle — it never
      // reads the camera image or depth. Disable the camera/depth crash-surface
      // features (which default to `true`) so the session doesn't request
      // `camera-access` / `depth-sensing` or acquire the camera texture each
      // frame. `dom-overlay` / CSS3D stay on for the status hint UI.
      isolationOptions: {
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
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
