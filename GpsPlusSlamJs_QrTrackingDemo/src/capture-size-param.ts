/**
 * Parse an optional QR camera-capture-size override from the page URL (WS-C).
 *
 * The detection-resolution sweep (does a bigger RGB blit decode a small/blurry
 * QR more reliably?) can only be measured faithfully with a real `BarcodeDetector`
 * on a device — it is not available in the headless test harness. To run that
 * sweep on-device WITHOUT a rebuild per resolution, the demo reads
 * `?capture=<px>` and forwards it as the camera-frame `captureSize` (longer-edge
 * blit budget). Absent/invalid → `undefined` (the framework default, 1024, stands).
 *
 * @see seams.ts — passes the result to `startCameraFrameCapture({ captureSize })`.
 * @see 2026-06-17-1204-qr-size-thin-demo-next-steps-followup.md — the sweep method.
 */

/** Sane bounds for the longer-edge blit budget (px). */
const MIN_CAPTURE = 128;
const MAX_CAPTURE = 4096;

/**
 * Read `?capture=<px>` from a URL query string. Returns a positive integer in
 * `[128, 4096]`, or `undefined` when the param is absent, non-numeric, or out
 * of range (defensive: a bad value must not shrink the blit to nothing).
 */
export function parseCaptureSizeParam(search: string): number | undefined {
  const params = new URLSearchParams(search);
  const raw = params.get("capture");
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const px = Math.floor(n);
  if (px < MIN_CAPTURE || px > MAX_CAPTURE) return undefined;
  return px;
}
