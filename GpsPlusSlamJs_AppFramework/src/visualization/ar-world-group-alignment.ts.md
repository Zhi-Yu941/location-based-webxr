# `ar-world-group-alignment.ts` — framework-default alignment for `arWorldGroup`

- **Purpose:** wire the store's alignment matrix to a smoothly-lerped
  `arWorldGroup.matrix` in a single call, so the AR view (camera + every GPS
  anchor under `arWorldGroup`) is GPS-registered without each app re-deriving the
  lerper + subscription + frame-loop plumbing by hand.

- **Public API:**
  - `enableArWorldGroupAlignment(options) → ArWorldGroupAlignmentHandle`
    - `options.store: SubscribableStore` — read via `selectAlignmentMatrix`.
    - `options.arWorldGroup: THREE.Object3D` — the node whose `.matrix` is lerped.
    - `options.lerpRate?: number` — forwarded to `createAlignmentLerper`
      (defaults to the lerper's own `DEFAULT_LERP_RATE`).
    - Returns a handle with `dispose()` that removes the store subscription, the
      per-frame update, and disposes the lerper.
    - **Disposal is automatic on session teardown.** The binding registers
      itself with the session-disposer registry (`ar/session-disposers.ts`) that
      `resetWebXRState()` flushes, so a caller can enable it once and never hold
      the handle — it cannot outlive its session. (Before this, the store
      subscription leaked across sessions: `clearFrameUpdates()` drops the
      per-frame tick but not the subscription, and two example apps independently
      grew bespoke per-app disposal bookkeeping to compensate.) The handle is
      still returned for stopping alignment mid-session, and is idempotent +
      self-deregistering so the manual `dispose()` and the teardown flush never
      double-run.

- **Invariants & assumptions:**
  - The first alignment target is applied **instantly** (via the lerper's
    first-target rule) so the view never slides from identity; subsequent targets
    ease toward their value.
  - An alignment already present at enable time is adopted immediately
    (`selectAlignmentMatrix(store.getState())`), because `subscribeToSelector`
    only fires on change.
  - `null` alignment is ignored (no spurious identity target).
  - **Single-driver rule:** the helper owns its lerper and drives it from the
    frame loop. Do **not** call it for a group that already has an externally
    driven lerper (the recorder owns its own and must not be double-lerped).

- **Examples:**

  ```ts
  const handle = enableArWorldGroupAlignment({ store, arWorldGroup });
  // …per-frame, the framework frame loop now lerps arWorldGroup.matrix.
  handle.dispose(); // on teardown
  ```

- **Tests:** `ar-world-group-alignment.test.ts` covers: adopt-at-enable, null
  ignored, instant-first-then-ease convergence, dispose-stops-updates, and the
  session-lifecycle disposal (auto-dispose when `runSessionDisposers()` flushes,
  `dispose()`-after-flush is an idempotent no-op, and a manual `dispose()`
  deregisters so the later flush is a no-op). Driven with the real `frame-loop`
  (`runFrameUpdates`) + `session-disposers` (`runSessionDisposers`) + a minimal
  fake `SubscribableStore`.

- **Related:** `alignment-lerper.ts` (the smoothing primitive),
  `ar/session-disposers.ts` (the teardown registry this binds to),
  `gps-anchor.ts` (anchors ride this alignment), the plan at
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-05-gps-anchor-frame-architecture-bug-and-plan.md`
  (Slice 2 / Bug A), and the disposal plan at
  `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-08-arworldgroup-alignment-session-scoped-disposal.md`.
