import { defineConfig } from 'vite';

// Starter-example Vite config. AppFramework resolves through the pnpm
// workspace symlink; the published gps-plus-slam-js comes from node_modules.
// No aliases needed. A distinct port keeps it runnable alongside the minimal
// example (5180) and recorder.
export default defineConfig({
  server: {
    port: 5181,
    // Listen on all interfaces so 127.0.0.1 (what the Playwright e2e config
    // polls) responds, not just the `localhost` alias. On Windows `localhost`
    // can resolve to IPv6 `::1` while Playwright probes IPv4 127.0.0.1, which
    // otherwise makes the webServer wait hang. Mirrors the RecorderApp.
    host: true,
  },
});
