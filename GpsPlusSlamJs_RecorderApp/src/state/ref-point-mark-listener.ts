/**
 * Listener middleware that turns every `gpsData/markReferencePoint`
 * action into a matching `refPoints/addCurrentRefPointMark` action.
 *
 * Background — F2 from
 * [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md):
 * recorded action streams only persist `gpsData/markReferencePoint`. The
 * red current-session sphere used to be driven by an explicit dispatch
 * inside the live ref-point handler (`ref-points/addCurrentRefPointMark`),
 * which is never reached during replay — so the sphere never appeared.
 *
 * This listener producer collapses both code paths into one: live and
 * replay both run through `markReferencePoint`, the listener observes the
 * action stream, computes the same `gpsPosition` resolution the live
 * handler used (fused GPS preferred, raw fallback), and dispatches
 * `addCurrentRefPointMark`. The explicit dispatch in the live handler is
 * therefore removed to avoid double-dispatch.
 *
 * @see ../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-30-refpoint-marks-into-redux-plan.md
 * @see ../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md
 */

import {
  createListenerMiddleware,
  isAnyOf,
  type Middleware,
} from '@reduxjs/toolkit';
import { fusedGpsFromOdom } from 'gps-plus-slam-app-framework/utils/fused-path';
import { webxrToNUE } from 'gps-plus-slam-app-framework/core';
import type {
  Vector3,
  Quaternion,
  Matrix4,
  LatLong,
} from 'gps-plus-slam-app-framework/core';

import {
  markReferencePoint,
  type MarkReferencePointPayload,
} from 'gps-plus-slam-app-framework/state';

import { addCurrentRefPointMark } from './ref-points-slice';
import type { CombinedRootState } from './recorder-store';
import type { RefPointMark } from '../storage/ref-point-loader';

/**
 * Build the listener middleware. Exposed as a factory (rather than a
 * pre-built instance) so the store factory can compose it alongside
 * other framework-supplied middlewares without sharing module-level
 * state.
 */
export function createRefPointMarkListenerMiddleware(): Middleware {
  const listener = createListenerMiddleware();

  listener.startListening({
    matcher: isAnyOf(markReferencePoint),
    effect: (action, api) => {
      // The gated action creator strips RTK's typed-action inference,
      // so we re-narrow the payload here. Defensive runtime validation
      // also guards against rehydrated recordings that pre-date schema
      // tightening.
      const payload = (action as { payload?: MarkReferencePointPayload })
        .payload;
      if (!isValidPayload(payload)) {
        return;
      }

      const state = api.getState() as CombinedRootState;
      const odomPosition: Vector3 = payload.position;
      const odomRotation: Quaternion = payload.rotation;

      const mark: RefPointMark = {
        id: payload.id,
        odomPosition,
        odomRotation,
        gpsPosition: resolveGpsPosition(
          payload.rawGpsPoint,
          odomPosition,
          state.gpsData?.gpsEvents?.alignmentMatrix,
          state.gpsData?.zero
        ),
        timestamp: payload.timestamp ?? Date.now(),
      };

      api.dispatch(addCurrentRefPointMark(mark));
    },
  });

  return listener.middleware;
}

function isValidPayload(
  payload: MarkReferencePointPayload | undefined
): payload is MarkReferencePointPayload {
  return (
    !!payload &&
    typeof payload.id === 'string' &&
    Array.isArray(payload.position) &&
    Array.isArray(payload.rotation) &&
    !!payload.rawGpsPoint
  );
}

/**
 * Mirrors the live `ref-point-handlers.ts::visualizeRefPoint` resolution:
 * fused GPS when both alignment matrix and zero reference are present
 * (with raw-altitude fallback for legacy `calcGpsCoords` recordings),
 * raw GPS otherwise.
 */
function resolveGpsPosition(
  raw: MarkReferencePointPayload['rawGpsPoint'],
  odomPosition: Vector3,
  alignmentMatrix: Matrix4 | null | undefined,
  zeroRef: LatLong | null | undefined
): NonNullable<RefPointMark['gpsPosition']> {
  if (alignmentMatrix && zeroRef) {
    try {
      const fused = fusedGpsFromOdom(
        alignmentMatrix,
        webxrToNUE(odomPosition),
        zeroRef
      );
      return {
        lat: fused.lat,
        lon: fused.lon,
        altitude: fused.altitude ?? raw.altitude,
      };
    } catch {
      // Numerically degenerate alignment matrix → fall through to raw.
    }
  }
  return {
    lat: raw.latitude,
    lon: raw.longitude,
    altitude: raw.altitude,
  };
}
