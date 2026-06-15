#!/usr/bin/env node
// @ts-check
/**
 * build-site.mjs — orchestrates the multi-app subpath deployment.
 *
 * Builds the framework once, then builds the RecorderApp under base `/recorder/`,
 * the AnchorStarter under base `/starter/`, the MinimalExample under base
 * `/minimal/`, and the QrTrackingDemo under base `/qr-demo/` into a single
 * combined output directory (`dist-site/`), and copies the static landing page
 * to the root. The resulting tree is what Cloudflare serves from
 * `gps.csutil.com`:
 *
 *   dist-site/
 *     index.html        ← landing page (root)
 *     recorder/         ← RecorderApp, base=/recorder/
 *     starter/          ← AnchorStarter, base=/starter/
 *     minimal/          ← MinimalExample, base=/minimal/
 *     qr-demo/          ← QrTrackingDemo, base=/qr-demo/
 *
 * `base` and `outDir` are passed as build-time CLI flags so the committed app
 * vite configs stay at their `/` + `dist` defaults (dev/USB-debugging unchanged).
 *
 * After each app build it asserts the emitted HTML contains no root-absolute
 * (`/...`) URL outside the app's own base — this is the executable guard for
 * plan Steps 1-3 (so a future runtime-absolute URL that Vite cannot rewrite
 * fails the deploy instead of 404-ing in production).
 *
 * See: GpsPlusSlamJs_Docs/docs/2026-06-01-multi-app-subpath-deployment-plan.md
 */

import { execFileSync } from 'node:child_process';
import {
  rmSync,
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distSite = join(repoRoot, 'dist-site');

/** Run a command, inheriting stdio, from the repo root. Throws on non-zero. */
function run(cmd, args) {
  execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    // pnpm resolves to pnpm.cmd on Windows; a shell makes that lookup work.
    shell: process.platform === 'win32',
  });
}

/**
 * Assert that every root-absolute `href`/`src` in the built HTML begins with
 * the expected base. Vite rewrites root-absolute URLs in processed `index.html`
 * to be base-prefixed; anything still pointing at bare `/...` would 404 once the
 * app is mounted under a subpath. Data URIs and external (`http(s)://`,
 * protocol-relative `//`) URLs are ignored.
 *
 * @param {string} htmlPath absolute path to a built HTML file
 * @param {string} base expected base prefix, e.g. '/recorder/'
 */
function assertNoBareAbsoluteUrls(htmlPath, base) {
  const html = readFileSync(htmlPath, 'utf-8');
  const attrRe = /(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const violations = [];
  let match;
  while ((match = attrRe.exec(html)) !== null) {
    const url = match[1] ?? match[2] ?? '';
    // Only root-absolute, single-slash URLs are deployment paths. Skip
    // protocol-relative (`//cdn`) and external/data URLs.
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    if (!url.startsWith(base)) violations.push(url);
  }
  if (violations.length > 0) {
    throw new Error(
      `Built HTML ${htmlPath} contains root-absolute URL(s) not under base ` +
        `${base}: ${[...new Set(violations)].join(', ')}. Make them ` +
        `base-relative (drop the leading '/') or use import.meta.env.BASE_URL.`
    );
  }
}

/**
 * Run {@link assertNoBareAbsoluteUrls} on *every* `*.html` file under an app's
 * output dir, not just `index.html`. Apps can emit secondary pages (e.g. the
 * RecorderApp's `ar-hittest-test.html`); a bare `/...` URL in any of them would
 * otherwise pass the deploy guard and 404 once mounted under a subpath.
 *
 * @param {string} dir absolute path to an app's built output dir
 * @param {string} base expected base prefix, e.g. '/recorder/'
 */
function assertNoBareAbsoluteUrlsInDir(dir, base) {
  const htmlFiles = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name));
  for (const htmlPath of htmlFiles) {
    assertNoBareAbsoluteUrls(htmlPath, base);
  }
}

/** Assert the combined deploy tree matches the documented target layout. */
function assertSiteTree() {
  const required = [
    'index.html',
    'recorder/index.html',
    'recorder/ar-hittest-test.html',
    'starter/index.html',
    'minimal/index.html',
    'qr-demo/index.html',
  ];
  const missing = required.filter((rel) => !existsSync(join(distSite, rel)));
  if (missing.length > 0) {
    throw new Error(
      `dist-site is missing required file(s): ${missing.join(', ')}`
    );
  }
}

console.log('• Cleaning dist-site/');
rmSync(distSite, { recursive: true, force: true });
mkdirSync(distSite, { recursive: true });

console.log('• Building framework (once)');
run('pnpm', ['run', 'build:framework']);

console.log('• Building RecorderApp (base=/recorder/)');
run('pnpm', ['--filter', 'gps-plus-slam-recorder', 'run', 'typecheck']);
run('pnpm', [
  '--filter',
  'gps-plus-slam-recorder',
  'exec',
  'vite',
  'build',
  '--config',
  'config/vite.config.ts',
  '--base=/recorder/',
  '--outDir',
  join(distSite, 'recorder'),
  '--emptyOutDir',
]);
assertNoBareAbsoluteUrlsInDir(join(distSite, 'recorder'), '/recorder/');

console.log('• Building AnchorStarter (base=/starter/)');
run('pnpm', ['--filter', 'gps-plus-slam-anchor-starter', 'run', 'typecheck']);
run('pnpm', [
  '--filter',
  'gps-plus-slam-anchor-starter',
  'exec',
  'vite',
  'build',
  '--base=/starter/',
  '--outDir',
  join(distSite, 'starter'),
  '--emptyOutDir',
]);
assertNoBareAbsoluteUrlsInDir(join(distSite, 'starter'), '/starter/');

console.log('• Building MinimalExample (base=/minimal/)');
run('pnpm', ['--filter', 'gps-plus-slam-minimal-example', 'run', 'typecheck']);
run('pnpm', [
  '--filter',
  'gps-plus-slam-minimal-example',
  'exec',
  'vite',
  'build',
  '--base=/minimal/',
  '--outDir',
  join(distSite, 'minimal'),
  '--emptyOutDir',
]);
assertNoBareAbsoluteUrlsInDir(join(distSite, 'minimal'), '/minimal/');

console.log('• Building QrTrackingDemo (base=/qr-demo/)');
run('pnpm', ['--filter', 'gps-plus-slam-qr-tracking-demo', 'run', 'typecheck']);
run('pnpm', [
  '--filter',
  'gps-plus-slam-qr-tracking-demo',
  'exec',
  'vite',
  'build',
  '--base=/qr-demo/',
  '--outDir',
  join(distSite, 'qr-demo'),
  '--emptyOutDir',
]);
assertNoBareAbsoluteUrlsInDir(join(distSite, 'qr-demo'), '/qr-demo/');

console.log('• Copying landing page to dist-site/index.html');
cpSync(
  join(repoRoot, 'GpsPlusSlamJs_Landing', 'index.html'),
  join(distSite, 'index.html')
);

assertSiteTree();
console.log('✓ dist-site/ built and verified');
