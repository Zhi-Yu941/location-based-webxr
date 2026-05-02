#!/usr/bin/env node
/**
 * verify-community-key-lifetime.mjs (AppFramework defense-in-depth)
 *
 * Read-only pre-publish guardrail for `gps-plus-slam-app-framework`.
 *
 * Decodes the bundled `COMMUNITY_LICENSE_KEY` shipped by the resolved
 * `gps-plus-slam-js` dependency and asserts its remaining lifetime falls
 * inside the acceptable band (default 330–380 days). Closes the
 * "no core release for >12 months but framework keeps releasing" edge
 * case from
 * `../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md`
 * §3.6.
 *
 * No `NPM_SIGNING_PRIVATE_KEY` needed — this only reads the constant and
 * inspects its `exp` claim. Signature validity is already covered by the
 * core library's own tests.
 *
 * Configuration (env vars, both optional):
 *   COMMUNITY_KEY_MIN_DAYS  default 330
 *   COMMUNITY_KEY_MAX_DAYS  default 380
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIN_DAYS = Number.parseInt(
  process.env.COMMUNITY_KEY_MIN_DAYS ?? '330',
  10
);
const MAX_DAYS = Number.parseInt(
  process.env.COMMUNITY_KEY_MAX_DAYS ?? '380',
  10
);
if (
  !Number.isFinite(MIN_DAYS) ||
  !Number.isFinite(MAX_DAYS) ||
  MIN_DAYS >= MAX_DAYS
) {
  console.error(
    `❌ Invalid COMMUNITY_KEY_MIN_DAYS/MAX_DAYS: ${MIN_DAYS}/${MAX_DAYS}`
  );
  process.exit(1);
}

// Resolve the installed `gps-plus-slam-js/community-license-key` sub-path
// export against the AppFramework's own node_modules. We use createRequire
// instead of an `import()` because we want to fail with a clear error if
// the dependency is not installed (rather than spawn a dynamic ESM load).
const require = createRequire(import.meta.url);
let bundledTokenFile;
try {
  bundledTokenFile = require.resolve(
    'gps-plus-slam-js/community-license-key',
    { paths: [resolve(__dirname, '..')] }
  );
} catch (err) {
  console.error(
    `❌ Could not resolve 'gps-plus-slam-js/community-license-key'. ` +
      `Make sure 'gps-plus-slam-js' is installed and at a version that exposes ` +
      `the sub-path export ('./community-license-key' in its package.json#exports). ` +
      `Underlying error: ${err.message}`
  );
  process.exit(1);
}

// The dist file is minified ESM. We don't import it (would require a real
// module loader); we just regex out the JWT-style token literal. The grammar
// (`<payloadB64url>.<sigB64url>` of `[A-Za-z0-9_\-.]+`) is identical to the
// one the core's own verifier uses, so any change there must be matched here.
const distSource = readFileSync(bundledTokenFile, 'utf8');
const tokenMatch = distSource.match(
  /(?:COMMUNITY_LICENSE_KEY|[A-Za-z_$][\w$]*)\s*=\s*['"]([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)['"]/
);
if (!tokenMatch) {
  console.error(
    `❌ Could not locate a JWT-style token literal in ${bundledTokenFile}. ` +
      `The minified output may have changed shape; update the regex in ` +
      `scripts/verify-community-key-lifetime.mjs.`
  );
  process.exit(1);
}
const token = tokenMatch[1];

const dotIndex = token.indexOf('.');
if (dotIndex <= 0) {
  console.error(
    `❌ COMMUNITY_LICENSE_KEY is not a "<payload>.<signature>" token.`
  );
  process.exit(1);
}
const payloadB64 = token.slice(0, dotIndex);

let payload;
try {
  const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
  payload = JSON.parse(json);
} catch (err) {
  console.error(
    `❌ Failed to decode COMMUNITY_LICENSE_KEY payload: ${err.message}`
  );
  process.exit(1);
}

if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
  console.error(
    `❌ COMMUNITY_LICENSE_KEY payload.exp is not a finite number: ${JSON.stringify(payload.exp)}`
  );
  process.exit(1);
}

const nowSec = Math.floor(Date.now() / 1000);
const remainingDays = (payload.exp - nowSec) / 86_400;
const expIso = new Date(payload.exp * 1000).toISOString();

if (remainingDays < MIN_DAYS) {
  console.error(
    `\n❌ BLOCKED: bundled COMMUNITY_LICENSE_KEY (from gps-plus-slam-js) has only ` +
      `${remainingDays.toFixed(1)} days left (expires ${expIso}); minimum ${MIN_DAYS} days.`
  );
  console.error(
    `\nFix: bump the 'gps-plus-slam-js' dependency in package.json to a version ` +
      `whose CI re-signed the bundled token, then re-run 'pnpm install'.\n`
  );
  process.exit(1);
}

if (remainingDays > MAX_DAYS) {
  console.error(
    `\n❌ BLOCKED: bundled COMMUNITY_LICENSE_KEY has ${remainingDays.toFixed(1)} days left ` +
      `(expires ${expIso}); maximum acceptable is ${MAX_DAYS} days. ` +
      `Investigate the core re-sign step.\n`
  );
  process.exit(1);
}

console.log(
  `✅ Bundled COMMUNITY_LICENSE_KEY (from gps-plus-slam-js) has ${remainingDays.toFixed(1)} days left ` +
    `(expires ${expIso}), within ${MIN_DAYS}–${MAX_DAYS} day band.`
);
