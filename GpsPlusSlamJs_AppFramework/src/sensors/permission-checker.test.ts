/**
 * Unit tests for permission-checker module.
 *
 * Tests verify the permission checking and requesting logic behaves correctly
 * under various browser API scenarios (granted, denied, unsupported, etc.).
 *
 * Why these tests matter:
 * - Permission checks have multiple code paths that need verification
 * - Different browsers/platforms have different permission APIs
 * - Error handling during permission requests must not crash the app
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PermissionCheckResult } from './permission-checker';
import {
  checkWebXRSupport,
  checkGeolocationPermission,
  requestGeolocationPermission,
  checkCameraPermission,
  requestCameraPermission,
  checkOrientationPermission,
  requestOrientationPermission,
  checkAllPermissions,
  requestAllPermissions,
  requestWebXRWithDepthPermission,
  setFileSystemState,
  resetFileSystemState,
} from './permission-checker';

describe('permission-checker', () => {
  // Store original values to restore after tests
  const originalNavigator = globalThis.navigator;
  const originalDeviceOrientationEvent = globalThis.DeviceOrientationEvent;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset file system state between tests
    resetFileSystemState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original globals
    vi.stubGlobal('navigator', originalNavigator);
    (globalThis as unknown as Record<string, unknown>).DeviceOrientationEvent =
      originalDeviceOrientationEvent;
    // Reset file system state
    resetFileSystemState();
  });

  describe('checkWebXRSupport', () => {
    it('returns not supported when navigator.xr is undefined', async () => {
      vi.stubGlobal('navigator', { ...originalNavigator, xr: undefined });

      const result = await checkWebXRSupport();

      expect(result.supported).toBe(false);
      expect(result.granted).toBe(null);
      expect(result.error).toContain('WebXR API not available');
    });

    it('returns supported and granted when immersive-ar is supported', async () => {
      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
        },
      });

      const result = await checkWebXRSupport();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    it('returns not supported when immersive-ar is not supported', async () => {
      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(false),
        },
      });

      const result = await checkWebXRSupport();

      expect(result.supported).toBe(false);
      expect(result.error).toContain('AR mode not supported');
    });

    it('handles isSessionSupported throwing an error', async () => {
      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockRejectedValue(new Error('XR error')),
        },
      });

      const result = await checkWebXRSupport();

      expect(result.supported).toBe(false);
      expect(result.error).toContain('Failed to check AR support');
    });
  });

  describe('checkGeolocationPermission', () => {
    it('returns not supported when geolocation is undefined', async () => {
      vi.stubGlobal('navigator', { geolocation: undefined });

      const result = await checkGeolocationPermission();

      expect(result.supported).toBe(false);
      expect(result.error).toContain('Geolocation API not available');
    });

    it('returns granted when Permissions API reports granted', async () => {
      vi.stubGlobal('navigator', {
        geolocation: {},
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
      });

      const result = await checkGeolocationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    it('returns denied when Permissions API reports denied', async () => {
      vi.stubGlobal('navigator', {
        geolocation: {},
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'denied' }),
        },
      });

      const result = await checkGeolocationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
      expect(result.error).toContain('Location access denied');
    });

    it('returns null granted when Permissions API reports prompt', async () => {
      vi.stubGlobal('navigator', {
        geolocation: {},
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'prompt' }),
        },
      });

      const result = await checkGeolocationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(null);
    });

    it('returns unknown state when Permissions API is unavailable', async () => {
      vi.stubGlobal('navigator', {
        geolocation: {},
        permissions: undefined,
      });

      const result = await checkGeolocationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(null);
    });
  });

  describe('requestGeolocationPermission', () => {
    it('returns granted when getCurrentPosition succeeds', async () => {
      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: vi
            .fn()
            .mockImplementation((success: PositionCallback) =>
              success({} as GeolocationPosition)
            ),
        },
      });

      const result = await requestGeolocationPermission(1000);

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    it('returns denied when permission is denied', async () => {
      const mockError = {
        code: 1, // PERMISSION_DENIED
        message: 'User denied',
        PERMISSION_DENIED: 1,
      };

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: vi
            .fn()
            .mockImplementation(
              (_: PositionCallback, error: PositionErrorCallback) =>
                error(mockError as GeolocationPositionError)
            ),
        },
      });

      const result = await requestGeolocationPermission(1000);

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
      expect(result.error).toContain('Location access denied');
    });

    it('returns null granted when position unavailable', async () => {
      const mockError = {
        code: 2, // POSITION_UNAVAILABLE
        message: 'Position unavailable',
        POSITION_UNAVAILABLE: 2,
      };

      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: vi
            .fn()
            .mockImplementation(
              (_: PositionCallback, error: PositionErrorCallback) =>
                error(mockError as GeolocationPositionError)
            ),
        },
      });

      const result = await requestGeolocationPermission(1000);

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(null);
      expect(result.error).toContain('Location unavailable');
    });
  });

  describe('checkCameraPermission', () => {
    it('returns not supported when mediaDevices is undefined', async () => {
      vi.stubGlobal('navigator', { mediaDevices: undefined });

      const result = await checkCameraPermission();

      expect(result.supported).toBe(false);
      expect(result.error).toContain('Camera API not available');
    });

    it('returns granted when Permissions API reports granted', async () => {
      vi.stubGlobal('navigator', {
        mediaDevices: { getUserMedia: vi.fn() },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
      });

      const result = await checkCameraPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    it('returns denied when Permissions API reports denied', async () => {
      vi.stubGlobal('navigator', {
        mediaDevices: { getUserMedia: vi.fn() },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'denied' }),
        },
      });

      const result = await checkCameraPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
    });
  });

  describe('requestCameraPermission', () => {
    it('returns granted when getUserMedia succeeds', async () => {
      const mockStop = vi.fn();
      const mockStream = {
        getTracks: vi.fn().mockReturnValue([{ stop: mockStop }]),
      };

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
      });

      const result = await requestCameraPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
      expect(mockStop).toHaveBeenCalled();
    });

    it('returns denied when NotAllowedError is thrown', async () => {
      const error = new DOMException('Not allowed', 'NotAllowedError');

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(error),
        },
      });

      const result = await requestCameraPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
      expect(result.error).toContain('Camera access denied');
    });

    it('returns not supported when NotFoundError is thrown', async () => {
      const error = new DOMException('No camera', 'NotFoundError');

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(error),
        },
      });

      const result = await requestCameraPermission();

      expect(result.supported).toBe(false);
      expect(result.error).toContain('No camera found');
    });
  });

  describe('checkOrientationPermission', () => {
    it('returns not supported when DeviceOrientationEvent is undefined', async () => {
      vi.stubGlobal('DeviceOrientationEvent', undefined);

      const result = await checkOrientationPermission();

      expect(result.supported).toBe(false);
    });

    it('returns granted when no requestPermission method exists (non-iOS)', async () => {
      vi.stubGlobal('DeviceOrientationEvent', {});

      const result = await checkOrientationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    it('returns null granted when requestPermission exists (iOS)', async () => {
      vi.stubGlobal('DeviceOrientationEvent', {
        requestPermission: vi.fn(),
      });

      const result = await checkOrientationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(null);
    });
  });

  describe('requestOrientationPermission', () => {
    it('returns granted when iOS permission is granted', async () => {
      vi.stubGlobal('DeviceOrientationEvent', {
        requestPermission: vi.fn().mockResolvedValue('granted'),
      });

      const result = await requestOrientationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    it('returns denied when iOS permission is denied', async () => {
      vi.stubGlobal('DeviceOrientationEvent', {
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });

      const result = await requestOrientationPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
    });
  });

  describe('checkAllPermissions', () => {
    it('returns aggregated results from all permission checks', async () => {
      // Set up mocks for all permission checks
      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
        },
        geolocation: {},
        mediaDevices: { getUserMedia: vi.fn() },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
      });
      vi.stubGlobal('DeviceOrientationEvent', {});

      const result = await checkAllPermissions();

      expect(result.webxr.supported).toBe(true);
      expect(result.geolocation.supported).toBe(true);
      expect(result.camera.supported).toBe(true);
      expect(result.orientation.supported).toBe(true);
    });

    it('sets allMandatoryReady to true when all mandatory permissions granted', async () => {
      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
        },
        geolocation: {},
        mediaDevices: { getUserMedia: vi.fn() },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
        storage: { getDirectory: vi.fn() },
      });
      vi.stubGlobal('DeviceOrientationEvent', {});
      // Setup file system as granted (storage initialized with write verified)
      setFileSystemState({ folderSelected: true, writeVerified: true });

      const result = await checkAllPermissions();

      expect(result.fileSystem.granted).toBe(true);
      expect(result.allMandatoryReady).toBe(true);
    });

    it('sets allMandatoryReady to false when any mandatory permission is denied', async () => {
      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
        },
        geolocation: {},
        mediaDevices: { getUserMedia: vi.fn() },
        permissions: {
          query: vi.fn().mockImplementation(({ name }) => {
            if (name === 'geolocation') {
              return Promise.resolve({ state: 'denied' });
            }
            return Promise.resolve({ state: 'granted' });
          }),
        },
      });
      vi.stubGlobal('DeviceOrientationEvent', {});

      const result = await checkAllPermissions();

      expect(result.allMandatoryReady).toBe(false);
    });
  });

  describe('requestAllPermissions', () => {
    it('requests pending permissions and returns updated results', async () => {
      const mockStream = {
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      };
      const mockSession = {
        end: vi.fn().mockResolvedValue(undefined),
      };

      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
          requestSession: vi.fn().mockResolvedValue(mockSession),
        },
        geolocation: {
          getCurrentPosition: vi
            .fn()
            .mockImplementation((success: PositionCallback) =>
              success({} as GeolocationPosition)
            ),
        },
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'prompt' }),
        },
        storage: { getDirectory: vi.fn() },
      });
      vi.stubGlobal('DeviceOrientationEvent', {});
      // Setup file system as granted (storage initialized with write verified)
      setFileSystemState({ folderSelected: true, writeVerified: true });

      const result = await requestAllPermissions();

      expect(result.geolocation.granted).toBe(true);
      expect(result.camera.granted).toBe(true);
      expect(result.fileSystem.granted).toBe(true);
      expect(result.allMandatoryReady).toBe(true);
    });

    /**
     * Why this test matters:
     * - Verifies that WebXR+Depth probe is called when WebXR permission is pending
     * - Ensures users see all permission prompts during setup, not after clicking Enter AR
     */
    it('requests WebXR with depth-sensing when support detected but not granted', async () => {
      const mockStream = {
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      };
      const mockSession = {
        end: vi.fn().mockResolvedValue(undefined),
      };
      const mockRequestSession = vi.fn().mockResolvedValue(mockSession);

      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
          requestSession: mockRequestSession,
        },
        geolocation: {
          getCurrentPosition: vi
            .fn()
            .mockImplementation((success: PositionCallback) =>
              success({} as GeolocationPosition)
            ),
        },
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
        storage: { getDirectory: vi.fn() },
      });
      vi.stubGlobal('DeviceOrientationEvent', {});
      // Setup file system as granted (storage initialized with write verified)
      setFileSystemState({ folderSelected: true, writeVerified: true });

      const result = await requestAllPermissions();

      // Should have called requestSession to trigger depth-sensing permission
      expect(mockRequestSession).toHaveBeenCalledWith(
        'immersive-ar',
        expect.objectContaining({
          optionalFeatures: expect.arrayContaining(['depth-sensing']),
        })
      );
      expect(result.webxr.granted).toBe(true);
      expect(result.fileSystem.granted).toBe(true);
      expect(result.allMandatoryReady).toBe(true);
    });

    /**
     * Why this test matters:
     * - Verifies graceful handling when user denies depth/AR permission
     * - allMandatoryReady should be false if AR is denied
     */
    it('handles WebXR+depth permission denial gracefully', async () => {
      const mockStream = {
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      };
      const error = new DOMException('User denied', 'NotAllowedError');

      vi.stubGlobal('navigator', {
        xr: {
          isSessionSupported: vi.fn().mockResolvedValue(true),
          requestSession: vi.fn().mockRejectedValue(error),
        },
        geolocation: {
          getCurrentPosition: vi
            .fn()
            .mockImplementation((success: PositionCallback) =>
              success({} as GeolocationPosition)
            ),
        },
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: 'granted' }),
        },
      });
      vi.stubGlobal('DeviceOrientationEvent', {});

      const result = await requestAllPermissions();

      expect(result.webxr.granted).toBe(false);
      expect(result.webxr.error).toContain('AR access denied');
      expect(result.allMandatoryReady).toBe(false);
    });
  });

  /**
   * Tests for requestWebXRWithDepthPermission
   *
   * Why these tests matter:
   * - The depth-sensing permission is only triggered by starting a real XR session
   * - We need to verify the probe session approach works correctly
   * - Must handle various failure modes: no XR, session denied, session errors
   * - The probe must end the session immediately after starting to avoid side effects
   */
  describe('requestWebXRWithDepthPermission', () => {
    it('returns not supported when navigator.xr is undefined', async () => {
      vi.stubGlobal('navigator', { ...originalNavigator, xr: undefined });

      const result = await requestWebXRWithDepthPermission();

      expect(result.supported).toBe(false);
      expect(result.granted).toBe(null);
      expect(result.error).toContain('WebXR not available');
    });

    it('returns supported and granted when session starts and ends successfully', async () => {
      const mockSession = {
        end: vi.fn().mockResolvedValue(undefined),
      };
      vi.stubGlobal('navigator', {
        xr: {
          requestSession: vi.fn().mockResolvedValue(mockSession),
        },
      });

      const result = await requestWebXRWithDepthPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
      expect(mockSession.end).toHaveBeenCalled();
    });

    it('requests session with correct options including depth-sensing', async () => {
      const mockSession = {
        end: vi.fn().mockResolvedValue(undefined),
      };
      const mockRequestSession = vi.fn().mockResolvedValue(mockSession);
      vi.stubGlobal('navigator', {
        xr: {
          requestSession: mockRequestSession,
        },
      });

      await requestWebXRWithDepthPermission();

      expect(mockRequestSession).toHaveBeenCalledWith(
        'immersive-ar',
        expect.objectContaining({
          requiredFeatures: ['local-floor'],
          optionalFeatures: expect.arrayContaining(['depth-sensing']),
          depthSensing: expect.objectContaining({
            usagePreference: ['cpu-optimized'],
          }),
        })
      );
    });

    it('returns denied when NotAllowedError is thrown', async () => {
      const error = new DOMException(
        'User denied AR access',
        'NotAllowedError'
      );
      vi.stubGlobal('navigator', {
        xr: {
          requestSession: vi.fn().mockRejectedValue(error),
        },
      });

      const result = await requestWebXRWithDepthPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
      expect(result.error).toContain('AR access denied');
    });

    it('returns not supported when other errors occur', async () => {
      const error = new DOMException(
        'Device not supported',
        'NotSupportedError'
      );
      vi.stubGlobal('navigator', {
        xr: {
          requestSession: vi.fn().mockRejectedValue(error),
        },
      });

      const result = await requestWebXRWithDepthPermission();

      expect(result.supported).toBe(false);
      expect(result.granted).toBe(null);
      expect(result.error).toBe('Device not supported');
    });

    it('handles generic errors gracefully', async () => {
      const error = new Error('Unknown XR error');
      vi.stubGlobal('navigator', {
        xr: {
          requestSession: vi.fn().mockRejectedValue(error),
        },
      });

      const result = await requestWebXRWithDepthPermission();

      expect(result.supported).toBe(false);
      expect(result.granted).toBe(null);
      expect(result.error).toBe('Unknown XR error');
    });

    it('still returns granted if session.end() fails after successful start', async () => {
      // Even if ending the probe session fails, the permission was still granted
      const mockSession = {
        end: vi.fn().mockRejectedValue(new Error('End failed')),
      };
      vi.stubGlobal('navigator', {
        xr: {
          requestSession: vi.fn().mockResolvedValue(mockSession),
        },
      });

      const result = await requestWebXRWithDepthPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });
  });

  describe('checkFileSystemPermission', () => {
    /**
     * Why this test matters:
     * User Feedback Issue #1 - File system access is critical for recording.
     * If OPFS isn't available, we need to detect early.
     */
    it('returns not supported when OPFS is not available', async () => {
      vi.stubGlobal('navigator', { storage: undefined });
      const { checkFileSystemPermission } =
        await import('./permission-checker');

      const result = checkFileSystemPermission();

      expect(result.supported).toBe(false);
      expect(result.granted).toBe(null);
      expect(result.error).toContain('OPFS');
    });

    /**
     * Why this test matters:
     * Before storage initialization, permission state should be null (unknown).
     */
    it('returns supported but not granted when OPFS exists but not initialized', async () => {
      vi.stubGlobal('navigator', {
        storage: { getDirectory: vi.fn() },
      });
      const { checkFileSystemPermission } =
        await import('./permission-checker');

      const result = checkFileSystemPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(null);
    });

    /**
     * Why this test matters:
     * After successful storage initialization with verified write, should report granted.
     */
    it('returns granted true after storage initialized with write access', async () => {
      vi.stubGlobal('navigator', {
        storage: { getDirectory: vi.fn() },
      });
      const { checkFileSystemPermission, setFileSystemState } =
        await import('./permission-checker');
      // Simulate successful storage initialization with write verified
      setFileSystemState({ folderSelected: true, writeVerified: true });

      const result = checkFileSystemPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(true);
    });

    /**
     * Why this test matters:
     * User Feedback Issue #1 - If write verification failed,
     * we need to report granted=false with a helpful error.
     */
    it('returns granted false when storage init failed with write error', async () => {
      vi.stubGlobal('navigator', {
        storage: { getDirectory: vi.fn() },
      });
      const { checkFileSystemPermission, setFileSystemState } =
        await import('./permission-checker');
      // Simulate storage initialized but write failed
      setFileSystemState({
        folderSelected: true,
        writeVerified: false,
        writeError: 'Storage write failed',
      });

      const result = checkFileSystemPermission();

      expect(result.supported).toBe(true);
      expect(result.granted).toBe(false);
      expect(result.error).toContain('write failed');
    });
  });

  /**
   * Tests for subscribePermissionChanges — the recorder app must learn
   * about out-of-band permission flips (user toggling location in browser
   * settings) without a page reload. See
   * docs/2026-05-03-setup-screen-defaults-and-permission-rerequest.md
   * (Issue 2). The subscription wires the PermissionStatus `'change'` event
   * plus `document.visibilitychange` / `window.focus` fallbacks.
   */
  describe('subscribePermissionChanges', () => {
    // A minimal `PermissionStatus` fake. The production code attaches a
    // `'change'` listener via `addEventListener` (PermissionStatus extends
    // EventTarget), so the fake records change listeners and exposes
    // `fireChange()` to simulate the browser dispatching the event.
    interface FakePermissionStatus {
      state: 'granted' | 'denied' | 'prompt';
      addEventListener(type: string, handler: () => void): void;
      removeEventListener(type: string, handler: () => void): void;
      fireChange(): void;
    }

    function makeFakeStatus(
      initial: 'granted' | 'denied' | 'prompt'
    ): FakePermissionStatus {
      const handlers = new Set<() => void>();
      return {
        state: initial,
        addEventListener(type, handler): void {
          if (type === 'change') handlers.add(handler);
        },
        removeEventListener(type, handler): void {
          if (type === 'change') handlers.delete(handler);
        },
        fireChange(): void {
          for (const h of handlers) h();
        },
      };
    }

    // Why: The primary signal for in-page detection of permission flips is
    // the PermissionStatus `'change'` event. Firing it must trigger the
    // callback with a freshly computed `PermissionCheckResult`.
    it('invokes callback when geolocation PermissionStatus change event fires', async () => {
      const geoStatus = makeFakeStatus('denied');
      const camStatus = makeFakeStatus('granted');
      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: vi.fn(),
        },
        mediaDevices: { getUserMedia: vi.fn() },
        xr: { isSessionSupported: vi.fn().mockResolvedValue(true) },
        storage: { getDirectory: vi.fn() },
        permissions: {
          query: vi.fn().mockImplementation((desc: { name: string }) => {
            if (desc.name === 'geolocation') return Promise.resolve(geoStatus);
            if (desc.name === 'camera') return Promise.resolve(camStatus);
            return Promise.reject(new Error('not supported'));
          }),
        },
      });
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = class {};

      const { subscribePermissionChanges } =
        await import('./permission-checker');
      const callback = vi.fn();
      const sub = subscribePermissionChanges(callback);
      // Wait for the initial query promises to resolve so the change
      // listener is wired.
      await new Promise((r) => setTimeout(r, 0));

      callback.mockClear();
      // Simulate the user flipping location to granted via browser settings.
      geoStatus.state = 'granted';
      geoStatus.fireChange();
      await new Promise((r) => setTimeout(r, 0));

      expect(callback).toHaveBeenCalled();
      const lastResult = callback.mock.calls.at(
        -1
      )![0] as PermissionCheckResult;
      expect(lastResult.geolocation.granted).toBe(true);

      sub.unsubscribe();
    });

    // Why: Some browsers don't fire the PermissionStatus `'change'` event
    // reliably (e.g. when the tab was backgrounded during the change). The
    // `visibilitychange` fallback covers the "user tabbed out to settings,
    // toggled, tabbed back" scenario.
    it('re-checks on document visibilitychange (visible)', async () => {
      const geoStatus = makeFakeStatus('denied');
      const camStatus = makeFakeStatus('granted');
      vi.stubGlobal('navigator', {
        geolocation: { getCurrentPosition: vi.fn() },
        mediaDevices: { getUserMedia: vi.fn() },
        xr: { isSessionSupported: vi.fn().mockResolvedValue(true) },
        storage: { getDirectory: vi.fn() },
        permissions: {
          query: vi.fn().mockImplementation((desc: { name: string }) => {
            if (desc.name === 'geolocation') return Promise.resolve(geoStatus);
            if (desc.name === 'camera') return Promise.resolve(camStatus);
            return Promise.reject(new Error('not supported'));
          }),
        },
      });
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = class {};

      const { subscribePermissionChanges } =
        await import('./permission-checker');
      const callback = vi.fn();
      const sub = subscribePermissionChanges(callback);
      await new Promise((r) => setTimeout(r, 0));

      callback.mockClear();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      geoStatus.state = 'granted';
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));

      expect(callback).toHaveBeenCalled();
      const lastResult = callback.mock.calls.at(
        -1
      )![0] as PermissionCheckResult;
      expect(lastResult.geolocation.granted).toBe(true);

      sub.unsubscribe();
    });

    // Why: visibilitychange firing with state 'hidden' (user just tabbed
    // away) tells us nothing useful and should not re-check — re-checking
    // there would just spam getCurrentPosition / queries.
    it('does NOT re-check on visibilitychange when state is hidden', async () => {
      const geoStatus = makeFakeStatus('granted');
      const camStatus = makeFakeStatus('granted');
      vi.stubGlobal('navigator', {
        geolocation: { getCurrentPosition: vi.fn() },
        mediaDevices: { getUserMedia: vi.fn() },
        xr: { isSessionSupported: vi.fn().mockResolvedValue(true) },
        storage: { getDirectory: vi.fn() },
        permissions: {
          query: vi.fn().mockImplementation((desc: { name: string }) => {
            if (desc.name === 'geolocation') return Promise.resolve(geoStatus);
            if (desc.name === 'camera') return Promise.resolve(camStatus);
            return Promise.reject(new Error('not supported'));
          }),
        },
      });
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = class {};

      const { subscribePermissionChanges } =
        await import('./permission-checker');
      const callback = vi.fn();
      const sub = subscribePermissionChanges(callback);
      await new Promise((r) => setTimeout(r, 0));

      callback.mockClear();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));

      expect(callback).not.toHaveBeenCalled();

      sub.unsubscribe();
    });

    // Why: After unsubscribe, neither onchange nor visibilitychange must
    // continue to invoke the callback — otherwise we'd leak listeners on
    // long-lived pages.
    it('stops firing callbacks after unsubscribe()', async () => {
      const geoStatus = makeFakeStatus('denied');
      const camStatus = makeFakeStatus('granted');
      vi.stubGlobal('navigator', {
        geolocation: { getCurrentPosition: vi.fn() },
        mediaDevices: { getUserMedia: vi.fn() },
        xr: { isSessionSupported: vi.fn().mockResolvedValue(true) },
        storage: { getDirectory: vi.fn() },
        permissions: {
          query: vi.fn().mockImplementation((desc: { name: string }) => {
            if (desc.name === 'geolocation') return Promise.resolve(geoStatus);
            if (desc.name === 'camera') return Promise.resolve(camStatus);
            return Promise.reject(new Error('not supported'));
          }),
        },
      });
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = class {};

      const { subscribePermissionChanges } =
        await import('./permission-checker');
      const callback = vi.fn();
      const sub = subscribePermissionChanges(callback);
      await new Promise((r) => setTimeout(r, 0));

      sub.unsubscribe();
      callback.mockClear();

      geoStatus.state = 'granted';
      geoStatus.fireChange();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));

      expect(callback).not.toHaveBeenCalled();
    });

    // Why: Browsers without the Permissions API (or with no support for the
    // queried name) must not break the subscription — visibilitychange /
    // focus fallback should still be wired.
    it('still wires visibilitychange when Permissions API is unavailable', async () => {
      vi.stubGlobal('navigator', {
        geolocation: { getCurrentPosition: vi.fn() },
        mediaDevices: { getUserMedia: vi.fn() },
        xr: { isSessionSupported: vi.fn().mockResolvedValue(true) },
        storage: { getDirectory: vi.fn() },
        // No `permissions` property.
      });
      (
        globalThis as unknown as Record<string, unknown>
      ).DeviceOrientationEvent = class {};

      const { subscribePermissionChanges } =
        await import('./permission-checker');
      const callback = vi.fn();
      const sub = subscribePermissionChanges(callback);
      await new Promise((r) => setTimeout(r, 0));

      callback.mockClear();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 0));

      expect(callback).toHaveBeenCalled();

      sub.unsubscribe();
    });
  });
});
