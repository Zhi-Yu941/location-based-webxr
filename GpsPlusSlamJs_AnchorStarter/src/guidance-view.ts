/**
 * Pure view-model for the onboarding guidance widget.
 *
 * Takes the framework's `OnboardingGuidance` (the reusable coaching seam,
 * `computeOnboardingGuidance`) and maps it to plain display strings the
 * DOM layer in `main.ts` can render without any further logic. Keeping
 * this pure makes the coaching UI testable in node (no DOM, no store).
 */

import type { OnboardingGuidance } from 'gps-plus-slam-app-framework/state';

export type GuidanceTone = 'info' | 'progress' | 'good' | 'lost';

export interface GuidanceView {
  /** Short headline for the current phase. */
  readonly title: string;
  /** Readiness as a rounded percentage string, e.g. `"42%"`. */
  readonly percentText: string;
  /** Readiness bar width, integer 0–100 (clamped). */
  readonly barWidthPct: number;
  /** Coaching sentence forwarded from the guidance hint. */
  readonly hint: string;
  /** Semantic tone for styling (colour band). */
  readonly tone: GuidanceTone;
}

interface PhasePresentation {
  readonly title: string;
  readonly tone: GuidanceTone;
}

const PHASE_PRESENTATION: Record<OnboardingGuidance['phase'], PhasePresentation> = {
  initializing: { title: 'Starting up…', tone: 'info' },
  'ar-lost': { title: 'AR tracking lost', tone: 'lost' },
  'move-around': { title: 'Move around', tone: 'progress' },
  'almost-ready': { title: 'Almost ready', tone: 'progress' },
  ready: { title: 'Ready', tone: 'good' },
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 100;
  return Math.round(value * 100);
}

/**
 * Map an `OnboardingGuidance` to a render-ready view-model. Pure and
 * total — every phase has a presentation and `percentReady` is clamped,
 * so this never throws on crafted or out-of-range input.
 */
export function toGuidanceView(guidance: OnboardingGuidance): GuidanceView {
  const presentation = PHASE_PRESENTATION[guidance.phase];
  const pct = clampPercent(guidance.percentReady);
  return {
    title: presentation.title,
    percentText: `${pct}%`,
    barWidthPct: pct,
    hint: guidance.hint,
    tone: presentation.tone,
  };
}
