/**
 * Global vitest setup for `gps-plus-slam-app-framework`.
 *
 * Activates the `gps-plus-slam-js` library once at process start using the
 * public `validateLicenseKey()` API and the bundled `COMMUNITY_LICENSE_KEY`,
 * so every reducer / action creator / selector / math export is callable
 * from framework tests without each test having to construct a store first.
 *
 * Same pattern RecorderApp's integration tests use (see
 * GpsPlusSlamJs_RecorderApp/src/state/recording-replay.integration.test.ts).
 */
import { validateLicenseKey } from 'gps-plus-slam-js';

import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-js/community-license-key';

validateLicenseKey(COMMUNITY_LICENSE_KEY);
