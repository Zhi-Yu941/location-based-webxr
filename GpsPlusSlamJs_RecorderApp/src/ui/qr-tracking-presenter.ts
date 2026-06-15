/**
 * QR tracking presenter — Recorder demonstrator UI feedback (Phase 6c of the
 * QR-code detection & tracking plan).
 *
 * Maps the framework `QrTrackingController`'s async status callbacks onto the
 * HUD's status/error channels so the off-by-default QR-tracking feature obeys
 * the "UI feedback for async actions" rule: a clear in-progress state while
 * scanning / loading the level, a final confirmation naming the locked level,
 * and failures surfaced through the existing error channel.
 *
 * Dependency-free (the HUD functions + status strings are injected) so the
 * transitional and final states are unit-testable without a DOM, a device, or a
 * framework rebuild. The status union mirrors the framework's `QrTrackingStatus`
 * structurally; it is duplicated here deliberately to keep this presenter
 * decoupled from the built framework type.
 */

export type QrTrackingStatus =
  | 'idle'
  | 'scanning'
  | 'loading-level'
  | 'tracking'
  | 'error';

/** The minimal level shape the presenter names in its confirmation. */
export interface PresentableLevel {
  version: number;
}

export interface QrTrackingPresenterDeps {
  /** HUD status line (green). */
  updateStatus: (text: string) => void;
  /** HUD error channel (red). */
  showError: (message: string) => void;
}

export interface QrTrackingPresenter {
  onStatus: (status: QrTrackingStatus) => void;
  onLocked: (level: PresentableLevel) => void;
  onError: (err: unknown) => void;
}

/** Human-readable status line per controller state (the in-progress feedback). */
export function qrStatusText(status: QrTrackingStatus): string | null {
  switch (status) {
    case 'scanning':
      return '🔍 Scanning for QR…';
    case 'loading-level':
      return '⬇️ Loading QR level…';
    case 'tracking':
      return '✅ QR locked';
    case 'idle':
    case 'error':
      return null; // idle clears; error is handled via showError
  }
}

/**
 * Wire the controller's callbacks to the HUD. Pass the returned `onStatus`,
 * `onLocked`, `onError` straight into `createQrTrackingController`.
 */
export function createQrTrackingPresenter(
  deps: QrTrackingPresenterDeps
): QrTrackingPresenter {
  return {
    onStatus(status: QrTrackingStatus): void {
      const text = qrStatusText(status);
      if (text !== null) deps.updateStatus(text);
    },
    onLocked(level: PresentableLevel): void {
      // Final, durable confirmation naming what was loaded (overrides the
      // transient "QR locked" status set by the preceding 'tracking' event).
      deps.updateStatus(`✅ Tracking QR (level v${level.version})`);
    },
    onError(err: unknown): void {
      const message = err instanceof Error ? err.message : String(err);
      deps.showError(`QR tracking failed: ${message}`);
    },
  };
}
