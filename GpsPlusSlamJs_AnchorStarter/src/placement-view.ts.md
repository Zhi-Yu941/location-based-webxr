# `placement-view.ts` — placement controls view-model

- **Purpose:** Pure mapping from the tested `SetupState` FSM to the placement
  UI: the "Place anchor" button, the status banner, the reload call-to-action,
  and the error line. Keeps the async-UX contract testable without a DOM.
- **Public API:**
  - `PlaceButtonView { visible, label, disabled, busy }`
  - `PlacementView { button, banner, reloadPrompt, error }`
  - `toPlacementView(state: SetupState): PlacementView` — total/pure.
- **Invariants & assumptions:**
  - Button is visible only in the cache-miss placement branch
    (`awaiting-tracking`, `ready-to-place`, `saving`, `saved`).
  - Soft gate (decision D2): the button is **enabled** while tracking warms up;
    only the banner copy nudges waiting.
  - Async-UX rule: `saving` → `{ label: 'Saving…', disabled, busy }` is the
    in-progress state; the durable end states are `saved`
    (`reloadPrompt: true`) or a revert to a placeable phase carrying `error`.
- **Examples:**
  - `toPlacementView(savingState).button` → `{ label: 'Saving…', busy: true }`.
  - `toPlacementView(savedState).reloadPrompt` → `true`.
- **Tests:** [placement-view.test.ts](placement-view.test.ts) — drives the real
  FSM and asserts the in-progress → final transition for the SUCCESS path and
  the revert-with-error for the FAILURE path (satisfies the repo async-UX test
  rule, [2026-04-29 ref-points feedback](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-29-ref-points-user-feedback.md)).
- **See also:** [setup-state-machine.ts.md](setup-state-machine.ts.md),
  [guidance-view.ts.md](guidance-view.ts.md).
