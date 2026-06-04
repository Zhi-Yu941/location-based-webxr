/**
 * Chromium WebXR camera-access tab-crash workaround.
 *
 * Background:
 * Requesting `camera-access` as an optional WebXR feature on Android Chrome
 * 147+ causes a fatal renderer-process crash (`CrRendererMain`) 1–2 seconds
 * after entering AR. The crash reproduces in the upstream three.js
 * `webxr_ar_hittest.html` example with `optionalFeatures: ['camera-access']`
 * added — i.e. it is not specific to this app's session setup. See:
 *
 *   - GpsPlusSlamJs_Docs/docs/2026-04-22-camera-access-reproducer-plan.md
 *   - GpsPlusSlamJs_Docs/docs/2026-06-04-camera-access-crash-regression-chrome-148.md
 *   - https://github.com/mrdoob/three.js/issues/33404
 *   - https://issues.chromium.org/issues/507508099 (root-cause, marked Fixed)
 *
 * There is NOT a single crash here — the Chromium tracker notes the crash on
 * Chrome 147 is different from the crash on 148+, and the simple workaround
 * below only helped on a subset of versions. The empirically-verified
 * (on-device) timeline is:
 *
 *   - 147 .. 148.0.7778.early : deleting `createProjectionLayer` / `layers`
 *       forces three.js onto `XRWebGLLayer` and sidesteps the crash.
 *   - 148.0.7778.12 .. 149.0.7821 : the delete-only trick stopped being
 *       sufficient on its own. An ADDITIONAL patch is needed: persist the
 *       `baseLayer` reference across `XRSession.prototype.updateRenderState`
 *       so three.js's later `depthNear`/`depthFar` update does not drop the
 *       active `glBaseLayer`. (Confirmed on Chrome 148: BOTH the delete and
 *       the baseLayer patch are required for the page not to crash.)
 *   - > 149.0.7821 (incl. Chrome 150) : the delete-only path is STILL required
 *       (confirmed on-device: Chrome 150 only stops crashing when the deletes
 *       are applied), but the extra baseLayer-persistence patch is NOT needed.
 *       The earlier assumption that Chromium fully fixed this on patched
 *       builds did not hold on real devices, so we no longer skip the
 *       workaround on "patched" Chrome.
 *
 * Resulting policy (see {@link applyChromiumProjectionLayerWorkaround}):
 *   - ALWAYS apply the deletes (every Chrome build, and unknown/non-Chromium
 *     environments — restoring the original always-on behavior).
 *   - Apply the baseLayer-persistence patch ONLY when a detected Chrome build
 *     falls inside the affected window
 *     [{@link BASELAYER_WINDOW_MIN} .. {@link BASELAYER_WINDOW_MAX}].
 *
 * Caveats:
 * - This is a Chromium-specific hack and the upstream comment explicitly
 *   warns it "might break webxr on other devices" — keep it opt-in.
 * - Must run BEFORE any WebXR session setup. Three.js reads these prototype
 *   members lazily when the first session starts, so calling this at app
 *   bootstrap (before `initAR()`) is sufficient.
 * - Idempotent: safe to call repeatedly. Safe on environments where the
 *   prototypes do not exist (e.g. desktop browsers, jsdom).
 */

interface XRWebGLBindingLike {
  prototype: { createProjectionLayer?: unknown };
}

interface XRRenderStateLike {
  prototype: { layers?: unknown };
}

type UpdateRenderStateFn = (init?: { baseLayer?: unknown }) => unknown;

interface XRSessionLike {
  prototype: { updateRenderState?: UpdateRenderStateFn };
}

/** Marker set on our patched `updateRenderState` so we never double-wrap it. */
const BASE_LAYER_PATCH_MARKER = '__gpsBaseLayerPersistencePatch';

/**
 * Parsed Chrome version as `[major, minor, build, patch]`.
 */
export type ChromeVersion = [number, number, number, number];

/**
 * Inclusive lower bound of the Chrome window that additionally needs the
 * `baseLayer`-persistence patch (on top of the deletes). Below this build the
 * delete-only workaround was sufficient.
 */
export const BASELAYER_WINDOW_MIN: ChromeVersion = [148, 0, 7778, 12];

/**
 * Inclusive upper bound of the Chrome window that additionally needs the
 * `baseLayer`-persistence patch. The crash is fixed after `149.0.7819.0` and
 * the camera image is correctly populated after `149.0.7821.0`; above this
 * build the extra patch is no longer required (the deletes still are — see
 * the module header and the on-device matrix for Chrome 150).
 *
 * @see https://github.com/mrdoob/three.js/issues/33404
 */
export const BASELAYER_WINDOW_MAX: ChromeVersion = [149, 0, 7821, 0];

/**
 * Result of {@link applyChromiumProjectionLayerWorkaround}.
 * Useful for logging and tests.
 */
export interface ChromiumProjectionLayerWorkaroundResult {
  /** True if `XRWebGLBinding.prototype.createProjectionLayer` was deleted on this call. */
  deletedCreateProjectionLayer: boolean;
  /** True if `XRRenderState.prototype.layers` was deleted on this call. */
  deletedRenderStateLayers: boolean;
  /** True if `XRSession.prototype.updateRenderState` was wrapped on this call. */
  patchedUpdateRenderState: boolean;
  /** The detected Chrome version (`"major.minor.build.patch"`), or null. */
  detectedChromeVersion: string | null;
}

/**
 * Parse a Chrome/Chromium version from a user-agent string.
 *
 * Matches the `Chrome/<major>.<minor>.<build>.<patch>` token (and the iOS
 * `CriOS/...` variant). Returns null for non-Chromium user agents.
 */
export function parseChromeVersion(userAgent: string): ChromeVersion | null {
  const match = /(?:Chrome|CriOS)\/(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(userAgent);
  if (!match) {
    return null;
  }
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ];
}

/** Lexicographically compare two version tuples: returns true if `a` > `b`. */
function isVersionAfter(a: ChromeVersion, b: ChromeVersion): boolean {
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) {
      return av > bv;
    }
  }
  return false;
}

/** True if `a` >= `b` (lexicographic). */
function isVersionAtLeast(a: ChromeVersion, b: ChromeVersion): boolean {
  return !isVersionAfter(b, a);
}

/**
 * True when the detected Chrome build falls inside the affected window
 * [{@link BASELAYER_WINDOW_MIN} .. {@link BASELAYER_WINDOW_MAX}] (inclusive)
 * and therefore additionally needs the `baseLayer`-persistence patch. Outside
 * the window (including non-Chromium user agents) returns false — only the
 * deletes are needed there.
 */
export function needsBaseLayerPersistence(userAgent: string): boolean {
  const version = parseChromeVersion(userAgent);
  if (version === null) {
    return false;
  }
  return (
    isVersionAtLeast(version, BASELAYER_WINDOW_MIN) &&
    isVersionAtLeast(BASELAYER_WINDOW_MAX, version)
  );
}

function getUserAgent(): string {
  const nav = (globalThis as unknown as { navigator?: { userAgent?: string } })
    .navigator;
  return nav?.userAgent ?? '';
}

/**
 * Wrap `XRSession.prototype.updateRenderState` so the `baseLayer` reference is
 * persisted across calls. Three.js calls `updateRenderState({ depthNear,
 * depthFar })` after the base layer was set; on affected Chrome builds that
 * second call drops the active `glBaseLayer`, which leads to the crash on
 * camera-texture access. Re-supplying the last-seen `baseLayer` keeps it
 * alive.
 *
 * Idempotent: a marker on the wrapper prevents double-wrapping.
 *
 * @returns true if the prototype was wrapped on this call.
 */
function patchUpdateRenderStateForBaseLayerPersistence(): boolean {
  const session = (globalThis as unknown as { XRSession?: XRSessionLike })
    .XRSession;
  const original = session?.prototype.updateRenderState;
  if (!session || typeof original !== 'function') {
    return false;
  }
  if (
    (original as unknown as Record<string, unknown>)[BASE_LAYER_PATCH_MARKER]
  ) {
    return false; // already patched
  }

  let lastBaseLayer: unknown;
  const patched: UpdateRenderStateFn = function (
    this: unknown,
    init: { baseLayer?: unknown } = {}
  ) {
    if (init.baseLayer !== undefined) {
      lastBaseLayer = init.baseLayer;
    }
    return original.call(this, {
      baseLayer: lastBaseLayer,
      ...init,
    });
  };
  (patched as unknown as Record<string, unknown>)[BASE_LAYER_PATCH_MARKER] =
    true;
  session.prototype.updateRenderState = patched;
  return true;
}

/**
 * Apply the Chromium camera-access tab-crash workaround.
 *
 * Policy (derived from on-device testing — see the module header):
 *
 *  - ALWAYS removes `XRWebGLBinding.prototype.createProjectionLayer`
 *    (three.js r184) and `XRRenderState.prototype.layers` (three.js r158) so
 *    three.js falls back to `XRWebGLLayer`. This is required on every affected
 *    Chrome build observed so far, including Chrome 150, and is also applied
 *    on unknown/non-Chromium environments (restoring the original always-on
 *    behavior).
 *  - ADDITIONALLY persists the `baseLayer` across
 *    `XRSession.prototype.updateRenderState`, but ONLY when a detected Chrome
 *    build falls inside the affected window
 *    [{@link BASELAYER_WINDOW_MIN} .. {@link BASELAYER_WINDOW_MAX}]. Outside
 *    that window the extra patch is unnecessary (and is skipped on unknown
 *    environments to avoid touching projection-layer devices like Quest).
 *
 * Call once during bootstrap, before any `requestSession()` call.
 *
 * @param options.userAgent override the detected user agent (for testing).
 * @returns which prototype members were actually changed on this call.
 */
export function applyChromiumProjectionLayerWorkaround(options?: {
  userAgent?: string;
}): ChromiumProjectionLayerWorkaroundResult {
  const userAgent = options?.userAgent ?? getUserAgent();
  const version = parseChromeVersion(userAgent);

  const result: ChromiumProjectionLayerWorkaroundResult = {
    deletedCreateProjectionLayer: false,
    deletedRenderStateLayers: false,
    patchedUpdateRenderState: false,
    detectedChromeVersion: version ? version.join('.') : null,
  };

  const binding = (
    globalThis as unknown as { XRWebGLBinding?: XRWebGLBindingLike }
  ).XRWebGLBinding;
  if (binding && 'createProjectionLayer' in binding.prototype) {
    delete binding.prototype.createProjectionLayer;
    result.deletedCreateProjectionLayer = true;
  }

  const renderState = (
    globalThis as unknown as { XRRenderState?: XRRenderStateLike }
  ).XRRenderState;
  if (renderState && 'layers' in renderState.prototype) {
    delete renderState.prototype.layers;
    result.deletedRenderStateLayers = true;
  }

  // The baseLayer-persistence patch only matters on genuinely affected Chrome
  // builds (the BASELAYER_WINDOW_MIN .. BASELAYER_WINDOW_MAX window). Limiting
  // it to that detected window avoids touching `updateRenderState` on Chrome
  // builds that do not need it (e.g. 150) and on unknown environments
  // (desktop/Quest/iOS), keeping the delete-only behavior there.
  if (needsBaseLayerPersistence(userAgent)) {
    result.patchedUpdateRenderState =
      patchUpdateRenderStateForBaseLayerPersistence();
  }

  return result;
}
