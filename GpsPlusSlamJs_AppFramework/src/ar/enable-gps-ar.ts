/**
 * Headless "Enable GPS AR" seam (Decision B3).
 *
 * Composes the framework's existing building blocks — WebXR support check,
 * the individual permission requesters, the GPS/orientation sensor watches and
 * `initAR` — into a single in-gesture orchestration with an observable status,
 * so an app can render its **own** `<button>` over the state instead of
 * inheriting a framework-owned button DOM (unlike three.js' `ARButton`).
 *
 * Why a seam and not a button: per the plan
 * (`2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback.md` §4 / §6.5),
 * the permission/enter-AR *sequence* is the reusable core; the button DOM, toast
 * surface and copy are app-specific UX and stay app-local.
 *
 * All collaborators are injected (defaulting to the real framework functions),
 * so the orchestration is unit-testable headlessly without WebXR, GPS hardware
 * or a DOM.
 *
 * Permission scope (RECORDED decision): the default path is **minimal** — WebXR
 * support + geolocation + orientation. `requestDepth` is opt-in and is the only
 * thing that triggers `requestWebXRWithDepthPermission`. We deliberately do
 * **not** call `requestAllPermissions()` on the default path because it
 * unconditionally probes depth ("3D map") *and* camera, which the minimal set
 * excludes.
 */

import type { ArCrashIsolationOptions } from '../state/recording-options';
import type { GpsPosition, RawDeviceOrientation } from '../sensors/gps';
import {
  requestGeolocationPermission as defaultRequestGeolocationPermission,
  requestOrientationPermission as defaultRequestOrientationPermission,
  requestWebXRWithDepthPermission as defaultRequestWebXRWithDepthPermission,
  type PermissionStatus,
} from '../sensors/permission-checker';
import {
  startGpsWatch as defaultStartGpsWatch,
  startOrientationWatch as defaultStartOrientationWatch,
} from '../sensors/gps';
import {
  initAR as defaultInitAR,
  isWebXRSupported as defaultIsWebXRSupported,
  type SessionFeatureOptions,
} from './webxr-session';
import { createLogger } from '../utils/logger';

const log = createLogger('EnableGpsAr');

/**
 * Lifecycle status of the controller. The app maps these onto its button:
 * - `checking`   — support probe in flight (initial / after `refreshSupport`)
 * - `unsupported`— WebXR immersive-ar is unavailable; button stays disabled
 * - `ready`      — supported and idle; button is the live "Enable GPS AR" CTA
 * - `starting`   — in-gesture orchestration in flight (button shows progress)
 * - `running`    — AR session started; button reflects the durable end state
 * - `error`      — orchestration failed; button reverts to a retryable CTA
 */
export type EnableGpsArStatus =
  | 'checking'
  | 'unsupported'
  | 'ready'
  | 'starting'
  | 'running'
  | 'error';

/** Observable controller state. */
export interface EnableGpsArState {
  readonly status: EnableGpsArStatus;
  /** Human-readable failure reason when `status === 'error'`. */
  readonly error?: string;
}

/** Per-`enable()` configuration. */
export interface EnableGpsArConfig {
  /** DOM element hosting the AR canvas / dom-overlay (passed to `initAR`). */
  container: HTMLElement;
  /**
   * Opt-in to the depth ("3D map") permission probe. Default `false` — the
   * minimal default set is WebXR + geolocation + orientation only.
   */
  requestDepth?: boolean;
  /**
   * Forward `requestHitTest` to `initAR` so the session requests the WebXR
   * `hit-test` feature (the minimal AR example needs this for its reticle).
   */
  requestHitTest?: boolean;
  /** Crash-isolation diagnostic flags forwarded verbatim to `initAR`. */
  isolationOptions?: Partial<ArCrashIsolationOptions>;
  /** Receives every GPS fix from the started watch. */
  onGpsPosition?: (position: GpsPosition) => void;
  /** Receives every device-orientation sample from the started watch. */
  onOrientation?: (orientation: RawDeviceOrientation) => void;
}

/** Result of a single `enable()` attempt. */
export interface EnableGpsArResult {
  readonly ok: boolean;
  /** Failure reason when `ok === false`. */
  readonly error?: string;
}

/** Injectable collaborators (default to the real framework functions). */
export interface EnableGpsArDeps {
  isWebXRSupported: () => Promise<boolean>;
  requestGeolocationPermission: () => Promise<PermissionStatus>;
  requestOrientationPermission: () => Promise<PermissionStatus>;
  requestWebXRWithDepthPermission: () => Promise<PermissionStatus>;
  startGpsWatch: (
    onPosition: (position: GpsPosition) => void,
    onError?: (error: GeolocationPositionError) => void
  ) => void;
  startOrientationWatch: (
    onOrientation: (orientation: RawDeviceOrientation) => void
  ) => void;
  initAR: (
    container: HTMLElement,
    isolationOptions?: Partial<ArCrashIsolationOptions>,
    sessionFeatures?: SessionFeatureOptions
  ) => Promise<void>;
}

/** Public controller surface the app drives from its button. */
export interface EnableGpsArController {
  /** Current observable state (button derives its label/disabled from this). */
  getState: () => EnableGpsArState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe: (listener: (state: EnableGpsArState) => void) => () => void;
  /**
   * Probe WebXR support and move `checking → ready | unsupported`. Call once on
   * boot (and optionally on resume). No-op effect on permissions.
   */
  refreshSupport: () => Promise<void>;
  /**
   * In-gesture orchestration: request the configured permissions, start the
   * sensor watches and `initAR`. Must be called synchronously from a user
   * gesture so the permission prompts are allowed. Idempotent while
   * `starting`/`running`.
   */
  enable: (config: EnableGpsArConfig) => Promise<EnableGpsArResult>;
}

const defaultDeps: EnableGpsArDeps = {
  isWebXRSupported: defaultIsWebXRSupported,
  requestGeolocationPermission: defaultRequestGeolocationPermission,
  requestOrientationPermission: defaultRequestOrientationPermission,
  requestWebXRWithDepthPermission: defaultRequestWebXRWithDepthPermission,
  startGpsWatch: defaultStartGpsWatch,
  startOrientationWatch: defaultStartOrientationWatch,
  initAR: defaultInitAR,
};

/**
 * Create an "Enable GPS AR" controller. Pass partial `deps` in tests to inject
 * fakes; production callers use the defaults.
 */
export function createEnableGpsArController(
  deps: Partial<EnableGpsArDeps> = {}
): EnableGpsArController {
  const resolved: EnableGpsArDeps = { ...defaultDeps, ...deps };

  let state: EnableGpsArState = { status: 'checking' };
  const listeners = new Set<(state: EnableGpsArState) => void>();

  function setState(next: EnableGpsArState): void {
    state = next;
    // Snapshot so a listener that (un)subscribes during dispatch cannot mutate
    // the set mid-iteration. Each listener is isolated in a try/catch so one
    // throwing subscriber cannot abort the dispatch and destabilize the
    // refreshSupport()/enable() state transitions that drive it.
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (err) {
        log.error('State listener threw; continuing dispatch:', err);
      }
    }
  }

  async function refreshSupport(): Promise<void> {
    setState({ status: 'checking' });
    setState({ status: (await probeSupport()) ? 'ready' : 'unsupported' });
  }

  async function probeSupport(): Promise<boolean> {
    try {
      return await resolved.isWebXRSupported();
    } catch {
      // A throwing probe (e.g. a broken navigator.xr shim) is treated as
      // "unsupported" rather than crashing the controller.
      return false;
    }
  }

  /**
   * Request the configured permissions. Returns an error message when a
   * *blocking* permission (geolocation, or depth when opted in) is not granted,
   * or `null` on success. Orientation is best-effort and never blocks.
   */
  async function requestPermissions(
    config: EnableGpsArConfig
  ): Promise<string | null> {
    const geolocation = await resolved.requestGeolocationPermission();
    if (geolocation.granted !== true) {
      return geolocation.error ?? 'Location permission is required for GPS AR.';
    }

    // Orientation is recommended, not blocking: many Android devices grant it
    // implicitly, and a denial should not stop AR (the compass simply degrades).
    // We still request it so iOS shows its prompt inside the gesture. A
    // *rejecting* probe (broken shim / future impl that throws) must degrade
    // just like a denial — never bubble to enable()'s catch and fail the
    // session — so we swallow the rejection here.
    try {
      await resolved.requestOrientationPermission();
    } catch {
      // Best-effort: orientation never blocks AR startup.
    }

    if (config.requestDepth) {
      const depth = await resolved.requestWebXRWithDepthPermission();
      if (depth.granted !== true) {
        return depth.error ?? 'Depth (3D map) permission was denied.';
      }
    }

    return null;
  }

  async function enable(config: EnableGpsArConfig): Promise<EnableGpsArResult> {
    // Idempotency guard: never run two orchestrations concurrently.
    if (state.status === 'starting' || state.status === 'running') {
      return { ok: false, error: 'AR is already starting or running.' };
    }

    setState({ status: 'starting' });

    try {
      const permissionError = await requestPermissions(config);
      if (permissionError !== null) {
        return fail(permissionError);
      }

      // --- Sensor watches ---
      if (config.onGpsPosition) {
        resolved.startGpsWatch(config.onGpsPosition);
      }
      if (config.onOrientation) {
        resolved.startOrientationWatch(config.onOrientation);
      }

      // --- AR session ---
      await resolved.initAR(config.container, config.isolationOptions, {
        requestHitTest: config.requestHitTest,
      });

      setState({ status: 'running' });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(message);
    }
  }

  function fail(error: string): EnableGpsArResult {
    setState({ status: 'error', error });
    return { ok: false, error };
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refreshSupport,
    enable,
  };
}
