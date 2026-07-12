/**
 * Capability detection → quality tier (the plan's "full experience
 * everywhere, tiered quality" fallback ladder).
 *
 * The ladder, top to bottom:
 * 1. no WebGL            → `static-dom`: the canvas is hidden, the DOM copy
 *                          stands alone (floor).
 * 2. prefers-reduced-motion → `reduced-motion`: 3D renders, but chapters are
 *                          presented as static compositions (no scroll scrub).
 * 3. otherwise           → `scroll`: the full scroll-driven story.
 *
 * Orthogonally, weak hardware lowers the render quality (DPR cap, shadows
 * off, low-poly geometry) WITHOUT changing the mode — every device gets the
 * same story. Unknown hardware stats count as capable: Firefox/Safari never
 * expose `deviceMemory`, and punishing "unknown" would degrade most
 * desktops.
 */

// Consumers reference this union via `QualityTier['mode']`; keep the alias
// module-private until an importer needs it by name (knip enforces this).
type StoryMode = "scroll" | "reduced-motion" | "static-dom";

export interface CapabilityInputs {
  /** Could a WebGL context actually be created? */
  readonly webglSupported: boolean;
  /** `matchMedia('(prefers-reduced-motion: reduce)').matches` */
  readonly prefersReducedMotion: boolean;
  /** `navigator.deviceMemory` in GB (Chromium only, else undefined). */
  readonly deviceMemoryGb: number | undefined;
  /** `navigator.hardwareConcurrency` (undefined when unavailable). */
  readonly hardwareConcurrency: number | undefined;
  /** `window.devicePixelRatio`. */
  readonly devicePixelRatio: number;
}

export interface QualityTier {
  readonly mode: StoryMode;
  /** Renderer pixel-ratio cap, always within [1, 2]. */
  readonly dprCap: number;
  readonly shadows: boolean;
  readonly geometryDetail: "high" | "low";
}

const HIGH_TIER_DPR_CAP = 2;
const LOW_TIER_DPR_CAP = 1.5;
const WEAK_MEMORY_GB = 4;
const WEAK_CORES = 4;

function isWeakHardware(inputs: CapabilityInputs): boolean {
  const weakMemory =
    inputs.deviceMemoryGb !== undefined &&
    inputs.deviceMemoryGb < WEAK_MEMORY_GB;
  const weakCpu =
    inputs.hardwareConcurrency !== undefined &&
    inputs.hardwareConcurrency <= WEAK_CORES;
  return weakMemory || weakCpu;
}

function clampDpr(devicePixelRatio: number, cap: number): number {
  const safeDpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio >= 1
      ? devicePixelRatio
      : 1;
  return Math.max(1, Math.min(cap, safeDpr));
}

export function decideQualityTier(inputs: CapabilityInputs): QualityTier {
  if (!inputs.webglSupported) {
    return {
      mode: "static-dom",
      dprCap: 1,
      shadows: false,
      geometryDetail: "low",
    };
  }
  const mode: StoryMode = inputs.prefersReducedMotion
    ? "reduced-motion"
    : "scroll";
  if (isWeakHardware(inputs)) {
    return {
      mode,
      dprCap: clampDpr(inputs.devicePixelRatio, LOW_TIER_DPR_CAP),
      shadows: false,
      geometryDetail: "low",
    };
  }
  return {
    mode,
    dprCap: clampDpr(inputs.devicePixelRatio, HIGH_TIER_DPR_CAP),
    shadows: true,
    geometryDetail: "high",
  };
}
