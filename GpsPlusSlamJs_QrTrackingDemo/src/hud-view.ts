/**
 * HUD view-model — pure formatting of the measured-size readout the developer
 * uses to confirm a freshly printed QR against a tape measure (Note 4).
 *
 * No DOM here; `main.ts` copies these strings onto the overlay. Keeping it pure
 * makes the formatting (cm/mm rounding, the lifecycle labels) unit-testable.
 */

import type { QrSizeEstimate } from "gps-plus-slam-app-framework/ar";

export type DemoStatus = "idle" | "scanning" | "tracking";

export interface HudView {
  /** Top-line status: looking for a code vs. locked + glued. */
  statusLabel: string;
  /** Running median size, e.g. `20.1 cm`, or a placeholder while unknown. */
  sizeLabel: string;
  /** Accepted-sample count, e.g. `12 samples`. */
  sampleLabel: string;
  /** Sample spread, e.g. `±2 mm`. */
  spreadLabel: string;
  /** Size lifecycle stage (`unknown` | `measuring` | `estimated`). */
  lifecycleLabel: string;
}

const STATUS_LABELS: Record<DemoStatus, string> = {
  idle: "Point at a QR code",
  scanning: "Scanning…",
  tracking: "Locked — axis + cube glued",
};

function formatSizeCm(estimateM: number | null): string {
  if (estimateM === null || !Number.isFinite(estimateM)) return "—";
  return `${(estimateM * 100).toFixed(1)} cm`;
}

export function toHudView(
  status: DemoStatus,
  size: QrSizeEstimate | undefined,
): HudView {
  const sizeEstimate = size ?? {
    status: "unknown" as const,
    estimateM: null,
    sampleCount: 0,
    spreadM: 0,
  };
  return {
    statusLabel: STATUS_LABELS[status],
    sizeLabel:
      sizeEstimate.status === "measuring" && sizeEstimate.estimateM === null
        ? "measuring…"
        : formatSizeCm(sizeEstimate.estimateM),
    sampleLabel: `${sizeEstimate.sampleCount} sample${sizeEstimate.sampleCount === 1 ? "" : "s"}`,
    spreadLabel: `±${Math.round(sizeEstimate.spreadM * 1000)} mm`,
    lifecycleLabel: sizeEstimate.status,
  };
}
