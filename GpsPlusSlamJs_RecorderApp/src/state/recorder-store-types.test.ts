/**
 * Raw sensor types — type-identity regression tests.
 *
 * Why these tests matter: recorder modules import the library types
 * (`RawDeviceOrientation`, `RawGpsPoint`, `RecordGpsEventPayload`) from
 * `gps-plus-slam-app-framework/state`. As part of dropping the recorder
 * app's direct `gps-plus-slam-js` dependency
 * (see `2026-05-05-recorder-app-drop-direct-core-dep-plan.md` §2.2.1),
 * that subpath is the recorder's curated route to the library types.
 * (Historically `recorder-store.ts` re-exported them; the barrel was
 * removed once the boundary migration finished — consumers now import
 * from the `state` subpath directly.)
 *
 * The framework also exports a *different* `RawDeviceOrientation` from
 * its `sensors/gps.ts` (with nullable `alpha`/`beta`/`gamma` fields)
 * that is reachable via the framework's root barrel. If a consumer (or
 * the framework's `state` barrel itself) ever routes through the root
 * barrel instead of the `state` subpath, the recorder app's
 * `RawDeviceOrientation` would silently flip from non-nullable to
 * nullable, breaking every consumer that assigns a number directly to
 * those fields.
 *
 * These tests lock in the library shape.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
  RawDeviceOrientation,
  RawGpsPoint,
  RecordGpsEventPayload,
} from 'gps-plus-slam-app-framework/state';

describe('framework/state raw sensor library types', () => {
  it('RawDeviceOrientation has non-nullable alpha/beta/gamma (library shape)', () => {
    // The library's RawDeviceOrientation has `alpha: number` (non-nullable).
    // The framework's sensors/gps.ts version has `alpha: number | null`.
    // We must be re-exporting the library version.
    expectTypeOf<RawDeviceOrientation['alpha']>().toEqualTypeOf<number>();
    expectTypeOf<RawDeviceOrientation['beta']>().toEqualTypeOf<number>();
    expectTypeOf<RawDeviceOrientation['gamma']>().toEqualTypeOf<number>();
    expectTypeOf<RawDeviceOrientation['absolute']>().toEqualTypeOf<boolean>();
  });

  it('RawGpsPoint exposes the library latitude/longitude shape', () => {
    expectTypeOf<RawGpsPoint['latitude']>().toEqualTypeOf<number>();
    expectTypeOf<RawGpsPoint['longitude']>().toEqualTypeOf<number>();
  });

  it('RecordGpsEventPayload carries a RawGpsPoint', () => {
    expectTypeOf<RecordGpsEventPayload>().toHaveProperty('rawGpsPoint');
  });
});
