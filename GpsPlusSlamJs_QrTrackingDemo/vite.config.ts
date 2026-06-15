import { defineConfig } from 'vite';

// QR-tracking demo Vite config. AppFramework resolves through the pnpm
// workspace symlink; the published gps-plus-slam-js comes from node_modules.
// A distinct port (5182) keeps it runnable alongside the minimal example
// (5180), the anchor starter (5181), and the recorder (5173). `host: true`
// mirrors the sibling apps so 127.0.0.1 (what the Playwright e2e polls)
// responds, not just the `localhost` alias.
export default defineConfig({
  server: {
    port: 5182,
    host: true,
  },
});
