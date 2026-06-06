/**
 * Unit tests for the Chromium camera-access workaround.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  applyChromiumProjectionLayerWorkaround,
  parseChromeVersion,
  needsBaseLayerPersistence,
  BASELAYER_WINDOW_MIN,
  BASELAYER_WINDOW_MAX,
} from './chromium-camera-access-workaround.js';

interface MutableGlobal {
  XRWebGLBinding?: { prototype: { createProjectionLayer?: () => void } };
  XRRenderState?: { prototype: { layers?: unknown } };
  XRSession?: {
    prototype: {
      updateRenderState?: (init?: { baseLayer?: unknown }) => unknown;
    };
  };
}

const g = globalThis as unknown as MutableGlobal;

// User agents used to exercise the version-gating logic. The build numbers
// match the documented crash timeline (see the helper's header doc).
const UA_AFFECTED_148 =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.20 Mobile Safari/537.36';
const UA_AFFECTED_147 =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7700.10 Mobile Safari/537.36';
const UA_PATCHED_150 =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.8000.5 Mobile Safari/537.36';
const UA_NON_CHROMIUM =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// The exact builds the maintainer tested on-device (2026-06-04). Locking them
// in guarantees the version window keeps matching the real devices:
//   - 148.0.7778.215 (stable) → needs BOTH deletes + baseLayer patch
//   - 150.0.7871.3   (beta)   → needs deletes ONLY (above the window)
const UA_DEVICE_STABLE_148 =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.215 Mobile Safari/537.36';
const UA_DEVICE_BETA_150 =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.3 Mobile Safari/537.36';

afterEach(() => {
  delete g.XRWebGLBinding;
  delete g.XRRenderState;
  delete g.XRSession;
});

describe('applyChromiumProjectionLayerWorkaround', () => {
  it('deletes createProjectionLayer on XRWebGLBinding when present', () => {
    g.XRWebGLBinding = {
      prototype: { createProjectionLayer: () => undefined },
    };

    const result = applyChromiumProjectionLayerWorkaround();

    expect(result.deletedCreateProjectionLayer).toBe(true);
    expect('createProjectionLayer' in g.XRWebGLBinding.prototype).toBe(false);
  });

  it('deletes layers on XRRenderState when present', () => {
    g.XRRenderState = { prototype: { layers: [] } };

    const result = applyChromiumProjectionLayerWorkaround();

    expect(result.deletedRenderStateLayers).toBe(true);
    expect('layers' in g.XRRenderState.prototype).toBe(false);
  });

  it('is a no-op when neither global is present (e.g. desktop, jsdom)', () => {
    const result = applyChromiumProjectionLayerWorkaround();

    expect(result.deletedCreateProjectionLayer).toBe(false);
    expect(result.deletedRenderStateLayers).toBe(false);
  });

  it('is idempotent — second call deletes nothing more', () => {
    g.XRWebGLBinding = {
      prototype: { createProjectionLayer: () => undefined },
    };
    g.XRRenderState = { prototype: { layers: [] } };

    const first = applyChromiumProjectionLayerWorkaround();
    const second = applyChromiumProjectionLayerWorkaround();

    expect(first.deletedCreateProjectionLayer).toBe(true);
    expect(first.deletedRenderStateLayers).toBe(true);
    expect(second.deletedCreateProjectionLayer).toBe(false);
    expect(second.deletedRenderStateLayers).toBe(false);
  });
});

describe('parseChromeVersion', () => {
  // Why this matters: the version gate is only as good as the parser. A
  // mis-parse would either skip on an affected build (crash) or apply on a
  // patched build (re-introduce the crash).
  it('parses a standard Android Chrome user agent', () => {
    expect(parseChromeVersion(UA_AFFECTED_148)).toEqual([148, 0, 7778, 20]);
  });

  it('parses the iOS CriOS variant', () => {
    expect(parseChromeVersion('Mozilla/5.0 CriOS/149.0.7821.5 Mobile')).toEqual(
      [149, 0, 7821, 5]
    );
  });

  it('returns null for non-Chromium user agents', () => {
    expect(parseChromeVersion(UA_NON_CHROMIUM)).toBeNull();
  });

  it('returns null for an empty user agent', () => {
    expect(parseChromeVersion('')).toBeNull();
  });
});

describe('needsBaseLayerPersistence', () => {
  // Why this matters: this predicate decides whether the EXTRA baseLayer patch
  // is applied on top of the always-on deletes. On-device matrix: Chrome 148
  // needs it, Chrome 150 does not. Boundary correctness around the window
  // [BASELAYER_WINDOW_MIN .. BASELAYER_WINDOW_MAX] is critical.
  it('returns true for affected Chrome 148 (inside the window)', () => {
    expect(needsBaseLayerPersistence(UA_AFFECTED_148)).toBe(true);
  });

  it('returns false for an EARLY Chrome 148 build below the window minimum', () => {
    // Why this matters: the window lower bound is the tracker's 148.0.7778.12
    // figure (delete-only stopped working after it). Builds below that — e.g.
    // 148.0.7778.5 or 148.0.0.0 — are NOT in the window; we have no on-device
    // evidence they need the baseLayer patch, so the predicate must be false.
    expect(
      needsBaseLayerPersistence(
        'Mozilla/5.0 (Linux; Android 14) Chrome/148.0.7778.5 Mobile Safari/537.36'
      )
    ).toBe(false);
    expect(
      needsBaseLayerPersistence('Chrome/148.0.0.0 Mobile Safari/537.36')
    ).toBe(false);
  });

  it('returns false for Chrome 150 (above the window — deletes only)', () => {
    expect(needsBaseLayerPersistence(UA_PATCHED_150)).toBe(false);
  });

  it('returns false for Chrome 147 (below the window — deletes only)', () => {
    expect(needsBaseLayerPersistence(UA_AFFECTED_147)).toBe(false);
  });

  it('includes the inclusive lower bound of the window', () => {
    const min = `Chrome/${BASELAYER_WINDOW_MIN.join('.')}`;
    expect(needsBaseLayerPersistence(min)).toBe(true);
  });

  it('excludes the highest Chrome 147 build (just below the window)', () => {
    // 147.x is delete-only per the documented timeline; even a very high 147
    // patch must stay below BASELAYER_WINDOW_MIN = 148.0.7778.12.
    expect(
      needsBaseLayerPersistence('Chrome/147.0.9999.999 Mobile Safari/537.36')
    ).toBe(false);
  });

  it('excludes one patch below the window minimum', () => {
    // Guards the lower boundary: 148.0.7778.11 is one patch below
    // BASELAYER_WINDOW_MIN (148.0.7778.12) and must be delete-only.
    expect(
      needsBaseLayerPersistence('Chrome/148.0.7778.11 Mobile Safari/537.36')
    ).toBe(false);
  });

  it('includes the inclusive upper bound of the window', () => {
    const max = `Chrome/${BASELAYER_WINDOW_MAX.join('.')}`;
    expect(needsBaseLayerPersistence(max)).toBe(true);
  });

  it('excludes one patch above the upper bound', () => {
    const [a, b, c, d] = BASELAYER_WINDOW_MAX;
    expect(needsBaseLayerPersistence(`Chrome/${a}.${b}.${c}.${d + 1}`)).toBe(
      false
    );
  });

  it('returns false for non-Chromium user agents', () => {
    expect(needsBaseLayerPersistence(UA_NON_CHROMIUM)).toBe(false);
  });

  it('matches the on-device matrix for the exact tested builds', () => {
    // Why this matters: these are the real devices. 148.0.7778.215 broke with
    // deletes-only and needs the baseLayer patch too; 150.0.7871.3 works with
    // deletes only. Keep these locked to the window bounds.
    expect(needsBaseLayerPersistence(UA_DEVICE_STABLE_148)).toBe(true);
    expect(needsBaseLayerPersistence(UA_DEVICE_BETA_150)).toBe(false);
  });
});

describe('applyChromiumProjectionLayerWorkaround — version gating', () => {
  it('still applies the deletes on Chrome 150 (deletes are always required)', () => {
    // Why this matters: on-device, Chrome 150 still crashes unless the deletes
    // force the XRWebGLLayer fallback. The earlier "skip on patched Chrome"
    // assumption did not hold on real devices, so the deletes must always run.
    g.XRWebGLBinding = {
      prototype: { createProjectionLayer: () => undefined },
    };
    g.XRRenderState = { prototype: { layers: [] } };

    const result = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_PATCHED_150,
    });

    expect(result.deletedCreateProjectionLayer).toBe(true);
    expect(result.deletedRenderStateLayers).toBe(true);
    // ...but the extra baseLayer patch is NOT needed above the window.
    expect(result.patchedUpdateRenderState).toBe(false);
    expect(result.detectedChromeVersion).toBe('150.0.8000.5');
    expect('createProjectionLayer' in g.XRWebGLBinding.prototype).toBe(false);
    expect('layers' in g.XRRenderState.prototype).toBe(false);
  });

  it('applies the deletes on affected Chrome 148', () => {
    g.XRWebGLBinding = {
      prototype: { createProjectionLayer: () => undefined },
    };
    g.XRRenderState = { prototype: { layers: [] } };

    const result = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_AFFECTED_148,
    });

    expect(result.deletedCreateProjectionLayer).toBe(true);
    expect(result.deletedRenderStateLayers).toBe(true);
    expect(result.detectedChromeVersion).toBe('148.0.7778.20');
  });

  it('applies the deletes on the earlier affected Chrome 147', () => {
    g.XRWebGLBinding = {
      prototype: { createProjectionLayer: () => undefined },
    };

    const result = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_AFFECTED_147,
    });

    expect(result.deletedCreateProjectionLayer).toBe(true);
  });
});

describe('applyChromiumProjectionLayerWorkaround — baseLayer persistence', () => {
  it('wraps updateRenderState on affected Chrome and persists baseLayer', () => {
    // Why this matters: on the 148.0.7778.12 .. 149.0.7821 window the
    // delete-only trick is insufficient — three.js's follow-up
    // updateRenderState({ depthNear, depthFar }) drops the active baseLayer
    // unless we re-supply it.
    const calls: Array<{ baseLayer?: unknown }> = [];
    g.XRSession = {
      prototype: {
        updateRenderState(init?: { baseLayer?: unknown }) {
          calls.push({ ...init });
          return undefined;
        },
      },
    };

    const result = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_AFFECTED_148,
    });
    expect(result.patchedUpdateRenderState).toBe(true);

    const update = g.XRSession.prototype.updateRenderState!;
    // The browser invokes updateRenderState as a method on the session, so the
    // wrapper keys its persisted baseLayer on `this`. Bind a session instance
    // to model that calling convention.
    const session = { name: 'session' };
    const baseLayer = { id: 'base' };
    update.call(session, { baseLayer });
    // Second call without baseLayer (three.js depth update) must still carry
    // the previously-seen baseLayer through to the original implementation.
    update.call(session, {});

    expect(calls[0].baseLayer).toBe(baseLayer);
    expect(calls[1].baseLayer).toBe(baseLayer);
  });

  it('isolates baseLayer state per XRSession instance (no shared-closure leak)', () => {
    // Why this matters: a single shared closure variable would leak the first
    // session's baseLayer into a later session. In a real browser an
    // XRWebGLLayer is bound to the session it was created for, so re-supplying
    // a stale layer to a different session throws InvalidStateError. Keying the
    // persisted layer on `this` (a WeakMap) keeps sessions isolated.
    const calls: Array<{ baseLayer?: unknown }> = [];
    g.XRSession = {
      prototype: {
        updateRenderState(init?: { baseLayer?: unknown }) {
          calls.push({ ...init });
          return undefined;
        },
      },
    };

    applyChromiumProjectionLayerWorkaround({ userAgent: UA_AFFECTED_148 });

    const update = g.XRSession.prototype.updateRenderState!;
    const sessionA = { name: 'A' };
    const sessionB = { name: 'B' };
    const layerA = { id: 'layer-A' };

    // sessionA records its baseLayer.
    update.call(sessionA, { baseLayer: layerA });
    // sessionB issues a depth-only update before ever setting its own
    // baseLayer. The previous session's layer must NOT leak in.
    update.call(sessionB, {});

    expect(calls[0].baseLayer).toBe(layerA);
    expect(calls[1].baseLayer).toBeUndefined();
  });

  it('restores the remembered baseLayer when init explicitly passes baseLayer: undefined', () => {
    // Why this matters: three.js's depth update could surface as
    // `updateRenderState({ baseLayer: undefined, depthNear, depthFar })`.
    // Spreading init AFTER `{ baseLayer: remembered }` would let that explicit
    // `undefined` clobber the persisted layer back to undefined, silently
    // defeating the patch and re-triggering the crash. The restored layer must
    // win regardless of an explicit `undefined` in init.
    const calls: Array<{ baseLayer?: unknown }> = [];
    g.XRSession = {
      prototype: {
        updateRenderState(init?: { baseLayer?: unknown }) {
          calls.push({ ...init });
          return undefined;
        },
      },
    };

    applyChromiumProjectionLayerWorkaround({ userAgent: UA_AFFECTED_148 });

    const update = g.XRSession.prototype.updateRenderState!;
    const session = { name: 'session' };
    const baseLayer = { id: 'base' };
    update.call(session, { baseLayer });
    // Depth-only update that explicitly carries `baseLayer: undefined`.
    update.call(session, { baseLayer: undefined, depthNear: 0.1 } as {
      baseLayer?: unknown;
    });

    expect(calls[0].baseLayer).toBe(baseLayer);
    expect(calls[1].baseLayer).toBe(baseLayer);
  });

  it('does not throw and delegates when init is explicitly null', () => {
    // Why this matters: the `init = {}` default only substitutes for
    // `undefined`, not `null`. `updateRenderState(null)` would otherwise reach
    // `init.baseLayer` and throw a TypeError, whereas native WebXR coerces a
    // null dictionary argument to an empty dictionary. The wrapper must
    // normalize null to an empty init and delegate safely.
    const calls: Array<{ baseLayer?: unknown }> = [];
    g.XRSession = {
      prototype: {
        updateRenderState(init?: { baseLayer?: unknown }) {
          calls.push({ ...init });
          return undefined;
        },
      },
    };

    applyChromiumProjectionLayerWorkaround({ userAgent: UA_AFFECTED_148 });

    const update = g.XRSession.prototype.updateRenderState!;
    const session = { name: 'session' };
    const baseLayer = { id: 'base' };
    update.call(session, { baseLayer });

    // A null arg must not throw, and must still carry the remembered baseLayer.
    expect(() =>
      update.call(session, null as unknown as { baseLayer?: unknown })
    ).not.toThrow();
    expect(calls[1].baseLayer).toBe(baseLayer);
  });

  it('does not wrap updateRenderState on Chrome 150 (above the window)', () => {
    g.XRSession = {
      prototype: { updateRenderState: () => undefined },
    };

    const result = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_PATCHED_150,
    });

    expect(result.patchedUpdateRenderState).toBe(false);
  });

  it('does not wrap updateRenderState on unknown (non-Chromium) environments', () => {
    // Why this matters: passing baseLayer through updateRenderState is known
    // to break projection-layer devices (Quest). Restricting the patch to a
    // detected Chrome build avoids touching those environments.
    g.XRSession = {
      prototype: { updateRenderState: () => undefined },
    };

    const result = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_NON_CHROMIUM,
    });

    expect(result.patchedUpdateRenderState).toBe(false);
  });

  it('is idempotent — does not double-wrap updateRenderState', () => {
    g.XRSession = {
      prototype: { updateRenderState: () => undefined },
    };

    const first = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_AFFECTED_148,
    });
    const second = applyChromiumProjectionLayerWorkaround({
      userAgent: UA_AFFECTED_148,
    });

    expect(first.patchedUpdateRenderState).toBe(true);
    expect(second.patchedUpdateRenderState).toBe(false);
  });
});
