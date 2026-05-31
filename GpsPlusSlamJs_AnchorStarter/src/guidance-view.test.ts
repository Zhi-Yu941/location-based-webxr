/**
 * Tests for the onboarding guidance view-model.
 *
 * Why this matters: the coaching widget is the example's main "is alignment
 * good enough yet?" feedback. These tests pin the phase→presentation mapping
 * and the percentage clamping so the UI stays legible and never renders
 * NaN/out-of-range bars even if the underlying metric misbehaves.
 */

import { describe, it, expect } from 'vitest';
import type { OnboardingGuidance } from 'gps-plus-slam-app-framework/state';
import { toGuidanceView } from './guidance-view.js';

function makeGuidance(
  overrides: Partial<OnboardingGuidance> = {}
): OnboardingGuidance {
  return {
    phase: 'move-around',
    percentReady: 0.5,
    hint: 'Walk around a little so the system can align.',
    ...overrides,
  };
}

describe('toGuidanceView', () => {
  it('maps every phase to a stable title and tone', () => {
    expect(toGuidanceView(makeGuidance({ phase: 'initializing' }))).toMatchObject({
      title: 'Starting up…',
      tone: 'info',
    });
    expect(toGuidanceView(makeGuidance({ phase: 'ar-lost' }))).toMatchObject({
      title: 'AR tracking lost',
      tone: 'lost',
    });
    expect(toGuidanceView(makeGuidance({ phase: 'move-around' }))).toMatchObject({
      title: 'Move around',
      tone: 'progress',
    });
    expect(toGuidanceView(makeGuidance({ phase: 'almost-ready' }))).toMatchObject({
      title: 'Almost ready',
      tone: 'progress',
    });
    expect(toGuidanceView(makeGuidance({ phase: 'ready' }))).toMatchObject({
      title: 'Ready',
      tone: 'good',
    });
  });

  it('forwards the coaching hint verbatim', () => {
    const view = toGuidanceView(makeGuidance({ hint: 'Keep walking forward.' }));
    expect(view.hint).toBe('Keep walking forward.');
  });

  it('renders percentReady as a rounded percentage and matching bar width', () => {
    const view = toGuidanceView(makeGuidance({ percentReady: 0.426 }));
    expect(view.percentText).toBe('43%');
    expect(view.barWidthPct).toBe(43);
  });

  it('clamps percentReady into [0, 100]', () => {
    expect(toGuidanceView(makeGuidance({ percentReady: -2 }))).toMatchObject({
      percentText: '0%',
      barWidthPct: 0,
    });
    expect(toGuidanceView(makeGuidance({ percentReady: 5 }))).toMatchObject({
      percentText: '100%',
      barWidthPct: 100,
    });
  });

  it('treats non-finite percentReady as 0 rather than rendering NaN', () => {
    expect(toGuidanceView(makeGuidance({ percentReady: NaN }))).toMatchObject({
      percentText: '0%',
      barWidthPct: 0,
    });
  });
});
