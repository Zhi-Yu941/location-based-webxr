/**
 * Property-based tests for onboarding-guidance.ts.
 *
 * Why this test matters: the unit tests pin specific points; these
 * properties assert the invariants that must hold for *every* report —
 * `percentReady` is always in [0,1], guidance never throws, and the
 * cross-state ordering (warm-up ≤ degraded ≤ ready) holds for arbitrary
 * coverage/confidence inputs.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeOnboardingGuidance } from './onboarding-guidance';
import type {
  TrackingQualityReport,
  TrackingQualityState,
} from './tracking-quality';

const STATES: TrackingQualityState[] = [
  'warming-up',
  'ar-lost',
  'degraded',
  'ok',
];

function makeReport(
  state: TrackingQualityState,
  confidence: number,
  coverage: number
): TrackingQualityReport {
  return {
    state,
    confidence,
    subScores: {
      convergence: 0.5,
      residualConsensus: 0.5,
      gpsAccuracy: 0.5,
      coverage,
    },
    diagnostics: {
      recentSumRotationDeltaDeg: 0,
      recentSumTranslationDeltaM: 0,
      medianResidualM: 0,
      medianRecentGpsAccuracyM: 0,
      walkedDistanceM: 0,
      directionSpreadDeg: 0,
      observationsSeen: 0,
      gpsVsFusedMaxDivergenceM: 0,
    },
  };
}

const unitInterval = fc.double({ min: 0, max: 1, noNaN: true });
// Deliberately includes out-of-range values to exercise clamping.
const looseScore = fc.double({ min: -5, max: 5, noNaN: true });

describe('computeOnboardingGuidance — properties', () => {
  it('always returns percentReady within [0,1] for any (state, confidence, coverage)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATES),
        looseScore,
        looseScore,
        (state, confidence, coverage) => {
          const g = computeOnboardingGuidance(
            makeReport(state, confidence, coverage)
          );
          expect(g.percentReady).toBeGreaterThanOrEqual(0);
          expect(g.percentReady).toBeLessThanOrEqual(1);
        }
      )
    );
  });

  it('warming-up percentReady never reaches the degraded/ready band', () => {
    fc.assert(
      fc.property(unitInterval, unitInterval, (confidence, coverage) => {
        const warming = computeOnboardingGuidance(
          makeReport('warming-up', confidence, coverage)
        ).percentReady;
        const degradedWorst = computeOnboardingGuidance(
          makeReport('degraded', 0, 0)
        ).percentReady;
        expect(warming).toBeLessThanOrEqual(degradedWorst);
      })
    );
  });

  it('warming-up percentReady is monotonic non-decreasing in coverage', () => {
    fc.assert(
      fc.property(unitInterval, unitInterval, (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const pLo = computeOnboardingGuidance(
          makeReport('warming-up', 0.5, lo)
        ).percentReady;
        const pHi = computeOnboardingGuidance(
          makeReport('warming-up', 0.5, hi)
        ).percentReady;
        expect(pHi).toBeGreaterThanOrEqual(pLo);
      })
    );
  });

  it('degraded percentReady is monotonic non-decreasing in confidence', () => {
    fc.assert(
      fc.property(unitInterval, unitInterval, (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const pLo = computeOnboardingGuidance(
          makeReport('degraded', lo, 0.5)
        ).percentReady;
        const pHi = computeOnboardingGuidance(
          makeReport('degraded', hi, 0.5)
        ).percentReady;
        expect(pHi).toBeGreaterThanOrEqual(pLo);
      })
    );
  });

  it('degraded never outranks ready, and ready is always 1', () => {
    fc.assert(
      fc.property(unitInterval, unitInterval, (confidence, coverage) => {
        const degraded = computeOnboardingGuidance(
          makeReport('degraded', confidence, coverage)
        ).percentReady;
        const ready = computeOnboardingGuidance(
          makeReport('ok', confidence, coverage)
        ).percentReady;
        expect(ready).toBe(1);
        expect(degraded).toBeLessThanOrEqual(ready);
      })
    );
  });
});
