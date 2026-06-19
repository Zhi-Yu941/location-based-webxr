import { describe, expect, it, vi } from 'vitest';
import {
  createEnableGpsArController,
  type EnableGpsArDeps,
  type EnableGpsArState,
  type EnableGpsArStatus,
} from './enable-gps-ar';
import type { PermissionStatus } from '../sensors/permission-checker';

// Why this test matters:
// The "Enable GPS AR" seam (Decision B3) is the reusable permission/enter-AR
// orchestration the example's button drives. It is headless and DI-based on
// purpose so we can prove — without WebXR/GPS hardware — that:
//  * the DEFAULT path is the *minimal* permission set (no depth/camera probe),
//    guarding against an accidental `requestAllPermissions()` regression;
//  * a required-permission denial surfaces an error and never reaches `initAR`;
//  * the async UX rule holds: a transitional `starting` state is reached before
//    the durable `running`/`error` final state, on BOTH the success and the
//    denied path;
//  * sensor watches and `initAR` (incl. the `requestHitTest` opt-in) are wired.
// See plan 2026-06-03-threejs-arbutton-minimal-ar-example-user-feedback §5 Step 1.

const granted: PermissionStatus = { supported: true, granted: true };
const denied: PermissionStatus = {
  supported: true,
  granted: false,
  error: 'denied by user',
};

function makeDeps(overrides: Partial<EnableGpsArDeps> = {}): EnableGpsArDeps {
  return {
    isWebXRSupported: vi.fn(() => Promise.resolve(true)),
    requestGeolocationPermission: vi.fn(() => Promise.resolve(granted)),
    requestOrientationPermission: vi.fn(() => Promise.resolve(granted)),
    requestWebXRWithDepthPermission: vi.fn(() => Promise.resolve(granted)),
    startGpsWatch: vi.fn(),
    startOrientationWatch: vi.fn(),
    initAR: vi.fn(() => Promise.resolve()),
    stopGpsWatch: vi.fn(),
    stopOrientationWatch: vi.fn(),
    endARSession: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function fakeContainer(): HTMLElement {
  return { id: 'ar-root' } as unknown as HTMLElement;
}

describe('createEnableGpsArController — support probe', () => {
  it('moves checking → ready when WebXR is supported', async () => {
    const controller = createEnableGpsArController(makeDeps());
    expect(controller.getState().status).toBe('checking');

    await controller.refreshSupport();

    expect(controller.getState().status).toBe('ready');
  });

  it('moves checking → unsupported when WebXR is unavailable', async () => {
    const controller = createEnableGpsArController(
      makeDeps({ isWebXRSupported: vi.fn(() => Promise.resolve(false)) })
    );

    await controller.refreshSupport();

    expect(controller.getState().status).toBe('unsupported');
  });

  it('treats a throwing support probe as unsupported (defensive)', async () => {
    const controller = createEnableGpsArController(
      makeDeps({
        isWebXRSupported: vi.fn(() =>
          Promise.reject(new Error('navigator.xr blew up'))
        ),
      })
    );

    await controller.refreshSupport();

    expect(controller.getState().status).toBe('unsupported');
  });

  // Why this test matters: refreshSupport() awaits the probe, so the status can
  // advance during that gap. enable() is NOT blocked from the `checking` state,
  // and refreshSupport may be called on resume while a session already runs.
  // A late probe result must not clobber an active starting/running state and
  // wrongly revert the button to a "not started" CTA.
  it('does not clobber an active running state when a slow probe resolves', async () => {
    let releaseProbe: (supported: boolean) => void = () => undefined;
    const deps = makeDeps({
      isWebXRSupported: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            releaseProbe = resolve;
          })
      ),
    });
    const controller = createEnableGpsArController(deps);

    // Start the support probe but leave it in flight (still `checking`).
    const refreshing = controller.refreshSupport();
    expect(controller.getState().status).toBe('checking');

    // A concurrent enable() drives the controller to `running` while the probe
    // is still pending.
    await controller.enable({ container: fakeContainer() });
    expect(controller.getState().status).toBe('running');

    // The slow probe now resolves — it must NOT overwrite the running state.
    releaseProbe(true);
    await refreshing;

    expect(controller.getState().status).toBe('running');
  });

  // Why this test matters: refreshSupport() may be called on resume/visibility
  // change while a session is ALREADY running (the comment in refreshSupport
  // explicitly names this case). The first setState({ status: 'checking' }) must
  // not fire in that situation — otherwise it clobbers the active `running`
  // state to `checking` (and then `ready`) BEFORE the post-probe guard can run,
  // wrongly reverting the button to a "not started" CTA. The probe must not even
  // be invoked, since support is moot while a session runs.
  it('does not clobber an already-running session when refreshSupport is called', async () => {
    const isWebXRSupported = vi.fn(() => Promise.resolve(true));
    const controller = createEnableGpsArController(
      makeDeps({ isWebXRSupported })
    );

    await controller.enable({ container: fakeContainer() });
    expect(controller.getState().status).toBe('running');
    isWebXRSupported.mockClear();

    await controller.refreshSupport();

    expect(controller.getState().status).toBe('running');
    expect(isWebXRSupported).not.toHaveBeenCalled();
  });

  // Same hazard for the in-gesture `starting` state: a resume-triggered
  // refreshSupport() while enable() is mid-orchestration must leave `starting`
  // untouched rather than flipping the button back to `checking`.
  it('does not clobber an in-flight starting state when refreshSupport is called', async () => {
    let releaseGeo: (status: PermissionStatus) => void = () => undefined;
    const controller = createEnableGpsArController(
      makeDeps({
        requestGeolocationPermission: vi.fn(
          () =>
            new Promise<PermissionStatus>((resolve) => {
              releaseGeo = resolve;
            })
        ),
      })
    );

    // enable() sets `starting` synchronously, then parks on the geolocation
    // permission request — leaving the controller deterministically `starting`.
    const enabling = controller.enable({ container: fakeContainer() });
    expect(controller.getState().status).toBe('starting');

    await controller.refreshSupport();
    expect(controller.getState().status).toBe('starting');

    releaseGeo(granted);
    await enabling;
    expect(controller.getState().status).toBe('running');
  });
});

describe('createEnableGpsArController — enable() success path', () => {
  it('requests the MINIMAL permission set (geo + orientation, NOT depth)', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({ container: fakeContainer() });

    expect(result.ok).toBe(true);
    expect(deps.requestGeolocationPermission).toHaveBeenCalledTimes(1);
    expect(deps.requestOrientationPermission).toHaveBeenCalledTimes(1);
    // The default path must NOT probe depth ("3D map") — that is the
    // requestAllPermissions over-request the minimal set deliberately excludes.
    expect(deps.requestWebXRWithDepthPermission).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('running');
  });

  it('passes through a transitional starting state before running', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    const seen: EnableGpsArStatus[] = [];
    controller.subscribe((s: EnableGpsArState) => seen.push(s.status));

    await controller.enable({ container: fakeContainer() });

    expect(seen).toContain('starting');
    expect(seen[seen.length - 1]).toBe('running');
    // starting must come before running (in-progress → durable end state).
    expect(seen.indexOf('starting')).toBeLessThan(seen.indexOf('running'));
  });

  it('starts the sensor watches with the provided callbacks', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    const onGpsPosition = vi.fn();
    const onOrientation = vi.fn();

    await controller.enable({
      container: fakeContainer(),
      onGpsPosition,
      onOrientation,
    });

    expect(deps.startGpsWatch).toHaveBeenCalledWith(onGpsPosition);
    expect(deps.startOrientationWatch).toHaveBeenCalledWith(onOrientation);
  });

  it('forwards requestHitTest to initAR', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    const container = fakeContainer();

    await controller.enable({ container, requestHitTest: true });

    expect(deps.initAR).toHaveBeenCalledWith(container, undefined, {
      requestHitTest: true,
    });
  });

  it('probes depth only when requestDepth is opted in', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({
      container: fakeContainer(),
      requestDepth: true,
    });

    expect(result.ok).toBe(true);
    expect(deps.requestWebXRWithDepthPermission).toHaveBeenCalledTimes(1);
  });
});

describe('createEnableGpsArController — enable() failure paths', () => {
  it('surfaces an error and never calls initAR when geolocation is denied', async () => {
    const deps = makeDeps({
      requestGeolocationPermission: vi.fn(() => Promise.resolve(denied)),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({ container: fakeContainer() });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('denied by user');
    expect(deps.initAR).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().error).toBe('denied by user');
  });

  it('reverts through starting → error so the button can recover (denied path)', async () => {
    const deps = makeDeps({
      requestGeolocationPermission: vi.fn(() => Promise.resolve(denied)),
    });
    const controller = createEnableGpsArController(deps);
    const seen: EnableGpsArStatus[] = [];
    controller.subscribe((s: EnableGpsArState) => seen.push(s.status));

    await controller.enable({ container: fakeContainer() });

    expect(seen).toContain('starting');
    expect(seen[seen.length - 1]).toBe('error');
    expect(seen.indexOf('starting')).toBeLessThan(seen.indexOf('error'));
  });

  it('rolls back the AR session and started watches when a watch start throws after initAR', async () => {
    // If a sensor-watch start throws synchronously *after* initAR has already
    // started the XR session (e.g. geolocation absent on a locked-down browser),
    // the catch must tear down what was started — otherwise the session and the
    // already-started GPS watch are stranded (disable() only runs from
    // 'running', and a retry from 'error' re-enters enable() without cleaning
    // up first, so the leak accumulates).
    const deps = makeDeps({
      startOrientationWatch: vi.fn(() => {
        throw new Error('orientation sensor unavailable');
      }),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
      onOrientation: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(controller.getState().status).toBe('error');
    // initAR succeeded and the GPS watch started before orientation threw, so
    // both the session and the started watch must be unwound, not left active.
    expect(deps.endARSession).toHaveBeenCalledTimes(1);
    expect(deps.stopGpsWatch).toHaveBeenCalledTimes(1);
  });

  it('does not tear down the session when the failure is before initAR', async () => {
    // Symmetry guard: a permission denial (pre-initAR) must NOT call
    // endARSession — there is no session to tear down, and doing so would be a
    // spurious teardown of nothing.
    const deps = makeDeps({
      requestGeolocationPermission: vi.fn(() => Promise.resolve(denied)),
    });
    const controller = createEnableGpsArController(deps);

    await controller.enable({ container: fakeContainer() });

    expect(deps.initAR).not.toHaveBeenCalled();
    expect(deps.endARSession).not.toHaveBeenCalled();
  });

  it('proceeds when orientation is denied (best-effort, non-blocking)', async () => {
    const deps = makeDeps({
      requestOrientationPermission: vi.fn(() => Promise.resolve(denied)),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({ container: fakeContainer() });

    expect(result.ok).toBe(true);
    expect(deps.initAR).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('running');
  });

  it('proceeds when the orientation probe REJECTS (truly non-blocking)', async () => {
    // The real `requestOrientationPermission` catches its own errors, but the
    // dep contract is `Promise<PermissionStatus>` and the orchestration's stated
    // intent is "orientation never blocks AR". A rejecting probe (a broken shim,
    // a future impl that throws) must therefore degrade gracefully rather than
    // bubble to enable()'s catch and fail the whole session.
    const deps = makeDeps({
      requestOrientationPermission: vi.fn(() =>
        Promise.reject(new Error('orientation shim blew up'))
      ),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({ container: fakeContainer() });

    expect(result.ok).toBe(true);
    expect(deps.initAR).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('running');
  });

  it('fails when an opted-in depth probe is denied', async () => {
    const deps = makeDeps({
      requestWebXRWithDepthPermission: vi.fn(() => Promise.resolve(denied)),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({
      container: fakeContainer(),
      requestDepth: true,
    });

    expect(result.ok).toBe(false);
    expect(deps.initAR).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('error');
  });

  it('surfaces initAR rejection as an error', async () => {
    const deps = makeDeps({
      initAR: vi.fn(() => Promise.reject(new Error('WebXR not available'))),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({ container: fakeContainer() });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('WebXR not available');
    expect(controller.getState().status).toBe('error');
  });

  // Why this test matters: the controller exposes no watch teardown, so sensor
  // watches must NOT be started when initAR rejects — otherwise they would leak
  // and a retry from the `error` state would start duplicate active watches.
  it('does not start sensor watches when initAR rejects', async () => {
    const deps = makeDeps({
      initAR: vi.fn(() => Promise.reject(new Error('WebXR not available'))),
    });
    const controller = createEnableGpsArController(deps);

    const result = await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
      onOrientation: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(deps.startGpsWatch).not.toHaveBeenCalled();
    expect(deps.startOrientationWatch).not.toHaveBeenCalled();
  });
});

describe('createEnableGpsArController — idempotency', () => {
  it('refuses a concurrent enable while one is already running', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);

    await controller.enable({ container: fakeContainer() });
    expect(controller.getState().status).toBe('running');

    const second = await controller.enable({ container: fakeContainer() });

    expect(second.ok).toBe(false);
    // initAR must not have been invoked a second time.
    expect(deps.initAR).toHaveBeenCalledTimes(1);
  });

  it('refuses a re-entrant enable while still starting', async () => {
    let releaseInitAr: () => void = () => undefined;
    const deps = makeDeps({
      initAR: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseInitAr = resolve;
          })
      ),
    });
    const controller = createEnableGpsArController(deps);

    const first = controller.enable({ container: fakeContainer() });
    // Let the microtasks up to (and blocking on) initAR run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getState().status).toBe('starting');

    const second = await controller.enable({ container: fakeContainer() });
    expect(second.ok).toBe(false);

    releaseInitAr();
    await first;
    expect(controller.getState().status).toBe('running');
    expect(deps.initAR).toHaveBeenCalledTimes(1);
  });
});

describe('createEnableGpsArController — subscription hygiene', () => {
  it('stops notifying after unsubscribe', async () => {
    const controller = createEnableGpsArController(makeDeps());
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    await controller.refreshSupport();
    const callsBefore = listener.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    unsubscribe();
    await controller.enable({ container: fakeContainer() });

    expect(listener.mock.calls.length).toBe(callsBefore);
  });

  // Why this test matters: setState() drives every refreshSupport()/enable()
  // transition. If a single subscriber throws (a buggy app render callback) it
  // must not abort the dispatch — remaining listeners must still observe the
  // new state and the controller's own flow must not be interrupted.
  it('isolates a throwing listener so others still receive the state', async () => {
    const controller = createEnableGpsArController(makeDeps());
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const throwing = vi.fn(() => {
      throw new Error('bad subscriber');
    });
    const healthy = vi.fn();
    controller.subscribe(throwing);
    controller.subscribe(healthy);

    await controller.refreshSupport();

    expect(throwing).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
    // The flow itself completed despite the throwing subscriber.
    expect(controller.getState().status).toBe('ready');

    consoleError.mockRestore();
  });
});

// Why this test group matters:
// The controller's state machine previously had no exit from `running`. Once AR
// started, the button stayed permanently disabled — the only recovery was a page
// reload. `disable()` adds a full teardown path: stop sensor watches, end the AR
// session, and transition `running → stopping → ready` so the user can re-enter
// AR. The tests prove the teardown is sequenced correctly and that partial
// failures (e.g. endARSession rejects) still reach a clean `ready` state.

describe('createEnableGpsArController — disable()', () => {
  it('transitions running → stopping → ready', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    await controller.enable({ container: fakeContainer() });
    expect(controller.getState().status).toBe('running');

    const seen: EnableGpsArStatus[] = [];
    controller.subscribe((s: EnableGpsArState) => seen.push(s.status));

    await controller.disable();

    expect(seen).toContain('stopping');
    expect(seen[seen.length - 1]).toBe('ready');
    expect(seen.indexOf('stopping')).toBeLessThan(seen.indexOf('ready'));
  });

  it('calls stopGpsWatch and stopOrientationWatch when watches were started', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
      onOrientation: vi.fn(),
    });

    await controller.disable();

    expect(deps.stopGpsWatch).toHaveBeenCalledTimes(1);
    expect(deps.stopOrientationWatch).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: watches are only started when the corresponding
  // config callback is provided. Calling stop on a watch that was never started
  // is harmless for the real implementation but proves the controller tracks
  // which watches it owns rather than blindly tearing down.
  it('does not call stop watch deps when watches were not started', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    await controller.enable({ container: fakeContainer() });

    await controller.disable();

    expect(deps.stopGpsWatch).not.toHaveBeenCalled();
    expect(deps.stopOrientationWatch).not.toHaveBeenCalled();
  });

  it('stops only the GPS watch when only onGpsPosition was provided', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
    });

    await controller.disable();

    expect(deps.stopGpsWatch).toHaveBeenCalledTimes(1);
    expect(deps.stopOrientationWatch).not.toHaveBeenCalled();
  });

  it('calls endARSession', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    await controller.enable({ container: fakeContainer() });

    await controller.disable();

    expect(deps.endARSession).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when not running', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);
    await controller.refreshSupport();
    expect(controller.getState().status).toBe('ready');

    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.disable();

    expect(listener).not.toHaveBeenCalled();
    expect(deps.endARSession).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe('ready');
  });

  // Why this test matters: the whole point of disable() is allowing re-entry.
  // After a full enable → disable cycle, the controller must be in a state where
  // enable() succeeds again, proving no leaked state blocks a second session.
  it('allows re-entry: enable → disable → enable', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);

    const first = await controller.enable({ container: fakeContainer() });
    expect(first.ok).toBe(true);

    await controller.disable();
    expect(controller.getState().status).toBe('ready');

    const second = await controller.enable({ container: fakeContainer() });
    expect(second.ok).toBe(true);
    expect(controller.getState().status).toBe('running');
    expect(deps.initAR).toHaveBeenCalledTimes(2);
  });

  // Why this test matters: endARSession can reject (e.g. session already ended
  // externally). The controller must still reach `ready` and stop watches so
  // the user isn't stuck in a dead state.
  it('handles endARSession rejection gracefully (still reaches ready)', async () => {
    const deps = makeDeps({
      endARSession: vi.fn(() =>
        Promise.reject(new Error('session already ended'))
      ),
    });
    const controller = createEnableGpsArController(deps);
    await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
    });

    await controller.disable();

    expect(controller.getState().status).toBe('ready');
    expect(deps.stopGpsWatch).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: if endARSession is slow (awaiting xrSession.end()),
  // the controller must block enable() during the teardown window. The
  // `stopping` state serves this purpose — it's the async gap between `running`
  // and the clean `ready`.
  it('enable() refuses during stopping', async () => {
    let releaseEnd: () => void = () => undefined;
    const deps = makeDeps({
      endARSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseEnd = resolve;
          })
      ),
    });
    const controller = createEnableGpsArController(deps);
    await controller.enable({ container: fakeContainer() });

    const disabling = controller.disable();
    expect(controller.getState().status).toBe('stopping');

    const second = await controller.enable({ container: fakeContainer() });
    expect(second.ok).toBe(false);

    releaseEnd();
    await disabling;
    expect(controller.getState().status).toBe('ready');
  });

  // Why this test matters: same hazard as the enable() guard above — a
  // resume-triggered refreshSupport() during teardown must not re-probe or
  // clobber the stopping state.
  it('refreshSupport() skips during stopping', async () => {
    let releaseEnd: () => void = () => undefined;
    const deps = makeDeps({
      endARSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseEnd = resolve;
          })
      ),
    });
    const controller = createEnableGpsArController(deps);
    await controller.enable({ container: fakeContainer() });
    const isWebXRSupported = deps.isWebXRSupported as ReturnType<typeof vi.fn>;
    isWebXRSupported.mockClear();

    const disabling = controller.disable();
    expect(controller.getState().status).toBe('stopping');

    await controller.refreshSupport();
    expect(controller.getState().status).toBe('stopping');
    expect(isWebXRSupported).not.toHaveBeenCalled();

    releaseEnd();
    await disabling;
  });

  // Why this test matters: a second disable() call while the first is in flight
  // must not double-teardown or corrupt the state machine.
  it('is idempotent during stopping (concurrent disable calls)', async () => {
    let releaseEnd: () => void = () => undefined;
    const deps = makeDeps({
      endARSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseEnd = resolve;
          })
      ),
    });
    const controller = createEnableGpsArController(deps);
    await controller.enable({ container: fakeContainer() });

    const first = controller.disable();
    const second = controller.disable();

    releaseEnd();
    await first;
    await second;

    expect(controller.getState().status).toBe('ready');
    expect(deps.endARSession).toHaveBeenCalledTimes(1);
  });

  // Why this test matters: after disable() clears the watch tracking, a
  // re-enable that starts new watches must have those watches correctly tracked
  // for the next disable() cycle.
  it('tracks watches independently per enable/disable cycle', async () => {
    const deps = makeDeps();
    const controller = createEnableGpsArController(deps);

    // First cycle: start with GPS watch only.
    await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
    });
    await controller.disable();
    expect(deps.stopGpsWatch).toHaveBeenCalledTimes(1);
    expect(deps.stopOrientationWatch).not.toHaveBeenCalled();

    // Second cycle: start with both watches.
    await controller.enable({
      container: fakeContainer(),
      onGpsPosition: vi.fn(),
      onOrientation: vi.fn(),
    });
    await controller.disable();
    expect(deps.stopGpsWatch).toHaveBeenCalledTimes(2);
    expect(deps.stopOrientationWatch).toHaveBeenCalledTimes(1);
  });
});
