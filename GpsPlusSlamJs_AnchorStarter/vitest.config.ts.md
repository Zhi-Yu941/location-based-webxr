# `vitest.config.ts` — unit-test scoping

- **Purpose:** Restricts Vitest to the colocated `src/**/*.test.ts` unit tests
  so it does **not** try to collect the Playwright e2e specs in
  `playwright-tests/*.spec.js`.
- **Why it exists:** Vitest's default `include`
  (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) matches the Playwright `*.spec.js`
  files, which import `@playwright/test`. Loading those under Vitest throws
  `Playwright Test did not expect test.describe() to be called here`. Scoping
  `include` to `src` keeps the two runners separate — unit logic via Vitest
  (`pnpm run test:unit`), browser/UI via Playwright (`pnpm run test:e2e`).
- **Invariants:** All unit tests live under `src/` next to the code they cover;
  if that ever changes, widen `include` accordingly.
- **Tests:** governs every `*.test.ts` in `src/`.
