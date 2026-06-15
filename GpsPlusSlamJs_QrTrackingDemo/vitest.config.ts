import { defineConfig } from 'vitest/config';

// Vitest scoping for the QR-tracking demo. The Playwright e2e specs live in
// `playwright-tests/*.spec.js` and import `@playwright/test`, which throws if
// Vitest tries to collect them. Restricting `include` to the colocated `src`
// unit tests keeps the two runners cleanly separated: unit logic via Vitest,
// browser/UI behaviour via Playwright (`pnpm run test:e2e`).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
