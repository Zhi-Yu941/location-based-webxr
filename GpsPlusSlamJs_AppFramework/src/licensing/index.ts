// Re-export the bundled community license key from the core package's
// dedicated sub-path so that consumers of `gps-plus-slam-app-framework/licensing`
// keep getting it from the same import path. Source of truth lives in
// `gps-plus-slam-js` (see
// ../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md
// §3.6 Option F).
export { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';
