import { defineConfig } from 'vitest/config';

// Vitest scoping for the landing page. All unit tests are colocated under
// `src/`; there is no e2e runner in this package (the plan's v1 verification
// is unit tests + a manual visual pass per chapter), so a plain include is
// enough. Tests run in the default node environment — modules that touch
// browser APIs (matchMedia, localStorage, scroll metrics) take them as
// injected seams instead of globals, which keeps the suite fast and
// deterministic.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
