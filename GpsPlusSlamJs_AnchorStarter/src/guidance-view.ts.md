# `guidance-view.ts` — onboarding guidance view-model

- **Purpose:** Pure mapping from the framework's `OnboardingGuidance`
  (produced by `computeOnboardingGuidance`) to render-ready display strings
  for the top "move around — N% ready" widget.
- **Public API:**
  - `GuidanceTone = 'info' | 'progress' | 'good' | 'lost'`
  - `GuidanceView { title, percentText, barWidthPct, hint, tone }`
  - `toGuidanceView(guidance: OnboardingGuidance): GuidanceView` — total/pure,
    never throws.
- **Invariants & assumptions:**
  - Every `OnboardingGuidance['phase']` has a presentation entry (exhaustive
    `Record`), so a new phase in the framework forces a compile error here.
  - `percentReady` is clamped into `[0, 100]`; non-finite → `0` (never renders
    `NaN%`).
  - `hint` is forwarded verbatim so coaching wording stays owned by the
    framework seam.
- **Examples:**
  - `toGuidanceView({ phase: 'move-around', percentReady: 0.43, hint: '…' })`
    → `{ title: 'Move around', percentText: '43%', barWidthPct: 43, tone: 'progress', … }`.
- **Tests:** [guidance-view.test.ts](guidance-view.test.ts) — phase→title/tone
  mapping, hint pass-through, rounding, clamping, NaN guard.
- **See also:** the framework seam `onboarding-guidance.ts` in the AppFramework
  `state/`, and the placement view-model [placement-view.ts.md](placement-view.ts.md).
