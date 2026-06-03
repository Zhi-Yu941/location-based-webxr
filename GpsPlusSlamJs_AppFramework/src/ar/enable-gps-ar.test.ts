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
});
