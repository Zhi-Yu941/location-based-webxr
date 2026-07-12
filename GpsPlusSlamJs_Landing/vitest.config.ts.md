# `vitest.config.ts` — unit-test scoping

- **Purpose:** Restricts Vitest to the colocated `src/**/*.test.ts` unit
  tests (including `*.property.test.ts`).
- **Why it exists:** keeps the include explicit and mirrors the sibling
  apps' configs; the landing has no e2e runner in v1, so no spec files
  need excluding — but the explicit `include` keeps that true if one is
  added later.
- **Invariants:** all unit tests live under `src/` next to the code they
  cover; tests run in the default node environment — modules that touch
  browser APIs take them as injected seams instead of globals (see
  `src/theme.ts`, `src/scene/scene-controller.ts`).
- **Tests:** governs every `*.test.ts` in `src/`.
