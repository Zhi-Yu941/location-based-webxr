# `verify-community-key-lifetime.mjs` (AppFramework)

## Purpose

Read-only pre-publish guardrail that asserts the bundled
`COMMUNITY_LICENSE_KEY` shipped by the resolved `gps-plus-slam-js`
dependency has at least `COMMUNITY_KEY_MIN_DAYS` (default **330**) and at
most `COMMUNITY_KEY_MAX_DAYS` (default **380**) days of lifetime
remaining.

This is the public-repo defense-in-depth half of Option F documented in
[../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md)
§3.6 ("F. Move ownership of the community license key into the core lib").

It closes this edge case:

> If the core lib does not cut a release for >12 months but the
> AppFramework keeps releasing, the published AppFramework would
> transitively ship an expired community key.

## Public API

Run via `pnpm run verify:community-key-lifetime` (wired into
`prepublishOnly`).

Exit codes:

- `0` — token is within the acceptable lifetime band.
- `1` — token is too short (re-publish core to re-sign), too long
  (suspicious; manual inspection), missing, malformed, or
  `gps-plus-slam-js/community-license-key` cannot be resolved.

## Invariants & assumptions

- `gps-plus-slam-js` is installed in `node_modules` and exposes
  `./community-license-key` via `package.json#exports`.
- The dist file for that sub-path contains a JWT-style token literal
  matching `<base64url>.<base64url>`. If the core lib changes its dist
  shape, update the regex in this script.
- The token's payload has a numeric `exp` claim (UNIX seconds).
- Signature validity is **not** re-checked here — the core lib's own
  `verify-community-key-lifetime.mjs` and unit tests already cover that.
  This script only inspects the `exp` claim.
- Defensive measures: invalid env vars, missing token, non-finite `exp`,
  base64url decode failure, JSON parse failure, and unresolved sub-path
  all yield exit 1 with a clear error message.

## Examples

```bash
# Default 330–380 day band.
pnpm run verify:community-key-lifetime

# Tighten to 350–370 days for stricter CI.
COMMUNITY_KEY_MIN_DAYS=350 COMMUNITY_KEY_MAX_DAYS=370 \
  pnpm run verify:community-key-lifetime
```

## Tests

No unit tests for this script — it is a thin pre-publish guard with
explicit error messages. The corresponding behavior in the core library
is fully tested in
[../../gps-plus-slam/GpsPlusSlamJs/scripts/verify-community-key-lifetime.mjs.md](../../gps-plus-slam/GpsPlusSlamJs/scripts/verify-community-key-lifetime.mjs.md).
