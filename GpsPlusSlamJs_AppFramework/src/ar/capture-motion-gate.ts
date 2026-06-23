/**
 * Capture motion gate — the policy that decides whether a *due* capture should
 * fire on the current frame or be deferred until the device settles.
 *
 * Two cohesive pieces, both pure/deterministic and unit-testable in isolation
 * from `ImageCaptureManager`:
 *  - {@link decideCapture} — the stateless capture-vs-defer decision over the
 *    windowed motion maxima, the thresholds, and the time since the capture
 *    became due (the never-calm safety fallback).
 *  - {@link MotionWindow} — a tiny fixed-size ring of recent per-frame
 *    velocities with glitch rejection, so the decision judges "max over the
 *    last N frames" rather than one lucky-calm sample.
 *
 * The window size and glitch ceilings are INTERNAL constants, deliberately not
 * user-facing config: the user-facing surface is only enabled / maxAngular /
 * maxLinear / maxWaitMs (plan §5.1). Keeping the stateful policy here (not in a
 * speculative framework-wide service) matches the plan's §4.1 scope note.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-23-blurry-frame-motion-gating-plan.md §4.2-4.4
 */

/** Default number of recent frames the gate judges motion over (~50 ms @ 60fps). */
export const DEFAULT_MOTION_WINDOW_SIZE = 3;

/**
 * Angular velocity (rad/s) above which a sample is treated as a tracking glitch
 * (e.g. relocalization teleport), not real motion. A genuine hand/device turn
 * tops out well below this; a teleport is far above it. Module-internal tuning
 * constant (not exported — the gate's user surface is only the four
 * `MotionFilterConfig` fields); overridable per-instance via the `MotionWindow`
 * constructor for tests.
 */
const ANGULAR_GLITCH_CEILING_RAD_S = 50;

/**
 * Linear velocity (m/s) above which a sample is treated as a tracking glitch.
 * ~20 m/s (72 km/h) is unreachable by handheld scanning but trivially exceeded
 * by a relocalization origin jump. Module-internal tuning constant (see
 * {@link ANGULAR_GLITCH_CEILING_RAD_S}).
 */
const LINEAR_GLITCH_CEILING_M_S = 20;

/**
 * User-/consumer-facing motion-filter configuration. Shared by both config
 * shapes that carry it — `ImageCaptureConfig` (what `ImageCaptureManager`
 * consumes) and `ImageCaptureOptions` (the persisted recorder options) — so the
 * one definition cannot drift between them. The window size and glitch ceilings
 * are deliberately NOT here: they are internal tuning constants, not exposed.
 */
export interface MotionFilterConfig {
  /** Master switch for the motion gate. Default `true`. */
  enabled: boolean;
  /** Angular-velocity threshold (rad/s); at/below this a frame is "calm". */
  maxAngularVelocity: number;
  /** Linear-velocity threshold (m/s); at/below this a frame is "calm". */
  maxLinearVelocity: number;
  /**
   * Never-calm safety fallback: once a due capture has waited this many ms it
   * fires regardless of motion, so an interval is never silently lost. A
   * sensible value is ~2× the capture interval.
   */
  maxWaitMs: number;
}

/**
 * Default motion-filter configuration. Enabled by default (plan §1). Thresholds
 * are PLACEHOLDERS pending on-device field tuning (plan §7) — record measured
 * values in implementation-progress.md once known. `maxWaitMs` of 4000 ms is
 * 2× the default 2000 ms image interval.
 */
export const DEFAULT_MOTION_FILTER: MotionFilterConfig = {
  enabled: true,
  maxAngularVelocity: 0.6,
  maxLinearVelocity: 0.5,
  maxWaitMs: 4000,
};

/** Inputs to the stateless capture decision. */
export interface CaptureDecisionInput {
  /** Max angular velocity (rad/s) over the recent window. `Infinity` if empty. */
  windowMaxAngular: number;
  /** Max linear velocity (m/s) over the recent window. `Infinity` if empty. */
  windowMaxLinear: number;
  /** Angular-velocity threshold (rad/s); at/below this is "calm". */
  maxAngularVelocity: number;
  /** Linear-velocity threshold (m/s); at/below this is "calm". */
  maxLinearVelocity: number;
  /** Milliseconds since the capture first became due (interval elapsed). */
  msSinceDue: number;
  /** Safety fallback: capture regardless once this many ms have passed. */
  maxWaitMs: number;
}

/**
 * Decide whether a due capture should fire now or defer to a later frame.
 *
 * A frame is "calm" when BOTH windowed maxima are at/below their thresholds —
 * an empty window reports `Infinity`, so it is never calm (no capture before a
 * valid sample exists). If not calm, the capture is deferred UNTIL `msSinceDue`
 * reaches `maxWaitMs`, at which point it fires regardless to guarantee an
 * interval is never silently lost (worst case: one blurry frame, not a gap).
 */
export function decideCapture(
  input: CaptureDecisionInput
): 'capture' | 'defer' {
  const calm =
    input.windowMaxAngular <= input.maxAngularVelocity &&
    input.windowMaxLinear <= input.maxLinearVelocity;
  if (calm) return 'capture';
  if (input.msSinceDue >= input.maxWaitMs) return 'capture';
  return 'defer';
}

/**
 * Fixed-size ring of the most recent VALID (non-glitch) per-frame velocities.
 *
 * `maxAngular()`/`maxLinear()` return the max over the retained samples, or
 * `Infinity` when empty so "no data yet" reads as not-calm in
 * {@link decideCapture}. A sample exceeding either glitch ceiling is rejected
 * outright (`push` returns `false`) and never stored, so a relocalization spike
 * neither pollutes the window (no spurious defer) nor is treated as motion.
 */
export class MotionWindow {
  private readonly size: number;
  private readonly angular: number[] = [];
  private readonly linear: number[] = [];

  constructor(
    size: number = DEFAULT_MOTION_WINDOW_SIZE,
    private readonly angularGlitchCeiling: number = ANGULAR_GLITCH_CEILING_RAD_S,
    private readonly linearGlitchCeiling: number = LINEAR_GLITCH_CEILING_M_S
  ) {
    // Guard against a degenerate/corrupt window size — at least 1 sample.
    this.size = Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1;
  }

  /**
   * Record a per-frame velocity pair. Returns `false` (and stores nothing) when
   * the sample exceeds either glitch ceiling, `true` otherwise.
   */
  push(angularVel: number, linearVel: number): boolean {
    if (
      !Number.isFinite(angularVel) ||
      !Number.isFinite(linearVel) ||
      angularVel > this.angularGlitchCeiling ||
      linearVel > this.linearGlitchCeiling
    ) {
      return false;
    }
    this.angular.push(angularVel);
    this.linear.push(linearVel);
    if (this.angular.length > this.size) this.angular.shift();
    if (this.linear.length > this.size) this.linear.shift();
    return true;
  }

  /** Whether the window holds at least one valid (non-glitch) sample yet. */
  hasSamples(): boolean {
    return this.angular.length > 0;
  }

  /** Max angular velocity over the retained window, or `Infinity` if empty. */
  maxAngular(): number {
    return this.angular.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...this.angular);
  }

  /** Max linear velocity over the retained window, or `Infinity` if empty. */
  maxLinear(): number {
    return this.linear.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...this.linear);
  }

  /** Clear all samples (e.g. on tracking loss / capture restart). */
  reset(): void {
    this.angular.length = 0;
    this.linear.length = 0;
  }
}
