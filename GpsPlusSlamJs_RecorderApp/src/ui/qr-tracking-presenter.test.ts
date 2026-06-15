/**
 * QR tracking presenter — unit tests.
 *
 * Why this test matters: the "UI feedback for async actions" rule requires a
 * test asserting the transitional state AND the final state for BOTH the
 * success and failure paths. These drive the controller's status callbacks and
 * assert the HUD sees the in-progress lines, the durable "tracking" confirmation
 * naming the level, and the error surfaced through `showError`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createQrTrackingPresenter,
  qrStatusText,
  type PresentableLevel,
} from './qr-tracking-presenter';

function setup() {
  const updateStatus = vi.fn();
  const showError = vi.fn();
  const presenter = createQrTrackingPresenter({ updateStatus, showError });
  return { presenter, updateStatus, showError };
}

describe('qrStatusText', () => {
  it('returns in-progress lines for scanning and loading', () => {
    expect(qrStatusText('scanning')).toMatch(/scanning/i);
    expect(qrStatusText('loading-level')).toMatch(/loading/i);
    expect(qrStatusText('tracking')).toMatch(/locked/i);
  });

  it('returns null for idle and error (handled elsewhere)', () => {
    expect(qrStatusText('idle')).toBeNull();
    expect(qrStatusText('error')).toBeNull();
  });
});

describe('createQrTrackingPresenter — success path', () => {
  it('shows the transitional states then a final confirmation naming the level', () => {
    const { presenter, updateStatus, showError } = setup();

    presenter.onStatus('scanning');
    presenter.onStatus('loading-level');
    presenter.onStatus('tracking');
    const level: PresentableLevel = { version: 2 };
    presenter.onLocked(level);

    const lines = updateStatus.mock.calls.map((c) => c[0] as string);
    // Transitional feedback was shown…
    expect(lines).toContain('🔍 Scanning for QR…');
    expect(lines).toContain('⬇️ Loading QR level…');
    // …and the final, durable state names the loaded level.
    expect(lines.at(-1)).toBe('✅ Tracking QR (level v2)');
    expect(showError).not.toHaveBeenCalled();
  });
});

describe('createQrTrackingPresenter — failure path', () => {
  it('surfaces a level-load failure through the error channel', () => {
    const { presenter, updateStatus, showError } = setup();

    presenter.onStatus('scanning'); // transitional state reached
    presenter.onStatus('loading-level');
    presenter.onError(new Error('fetch lvl returned status 404'));

    expect(updateStatus).toHaveBeenCalledWith('⬇️ Loading QR level…');
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError.mock.calls[0][0]).toMatch(/QR tracking failed.*404/);
  });

  it('stringifies non-Error rejections defensively', () => {
    const { presenter, showError } = setup();
    presenter.onError('plain string failure');
    expect(showError.mock.calls[0][0]).toContain('plain string failure');
  });
});
