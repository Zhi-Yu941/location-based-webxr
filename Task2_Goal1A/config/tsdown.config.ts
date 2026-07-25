import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  entry: {
    'colmap/index': resolve(projectRoot, 'src/colmap/index.ts'),
  },
  tsconfig: resolve(projectRoot, 'tsconfig.app.json'),
  format: ['esm'],
  dts: true,
  outDir: resolve(projectRoot, 'dist'),
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: ['@zip.js/zip.js'],
  },
});
