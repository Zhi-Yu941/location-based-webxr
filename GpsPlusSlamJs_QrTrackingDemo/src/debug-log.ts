/**
 * Debug log for the QR-tracking demo — a tiny bounded line buffer + formatters
 * so the HUD can show *when* detections happen and how fast they follow one
 * another. This is the on-device tuning aid (Note 2.6 of the on-device follow-up):
 * the per-lock Δt makes the real detection cadence visible so the throttle and
 * the accumulator thresholds can be tuned against actual hardware.
 *
 * Pure + bounded so it's unit-testable and can't leak. No DOM here; `main.ts`
 * renders `lines` into a `<pre>`.
 */

import type { QrSizeStatus } from "gps-plus-slam-app-framework/ar";

export interface DebugLog {
  /** Append one line, dropping the oldest beyond the cap. */
  append(line: string): void;
  /** The retained lines, oldest first. */
  readonly lines: readonly string[];
}

/** A bounded (ring) line buffer. Default cap 40 — enough to eyeball cadence. */
export function createDebugLog(maxLines = 40): DebugLog {
  const lines: string[] = [];
  return {
    append(line: string): void {
      lines.push(line);
      if (lines.length > maxLines) lines.shift();
    },
    get lines(): readonly string[] {
      return lines;
    },
  };
}

/** Truncate a payload for a compact log line. */
function shorten(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One detection-lock line: clock (s), Δt since the previous lock (the cadence
 * signal), the (shortened) payload, the size lifecycle stage, the running
 * median, and the accepted-sample count.
 */
export function formatDetectionLine(input: {
  clockMs: number;
  deltaMs: number | null;
  text: string;
  sizeStatus: QrSizeStatus;
  estimateM: number | null;
  sampleCount: number;
}): string {
  const t = (input.clockMs / 1000).toFixed(2);
  const dt = input.deltaMs === null ? "—" : `${Math.round(input.deltaMs)}ms`;
  const size =
    input.estimateM === null ? "?" : `${(input.estimateM * 100).toFixed(1)}cm`;
  return `[${t}s Δ${dt}] "${shorten(input.text)}" ${input.sizeStatus} ${size} (${input.sampleCount})`;
}

/** A status-transition line (scanning/tracking/idle), with a clock stamp. */
export function formatStatusLine(clockMs: number, status: string): string {
  return `[${(clockMs / 1000).toFixed(2)}s] → ${status}`;
}
