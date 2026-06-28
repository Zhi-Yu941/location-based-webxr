/**
 * Recording Coordinator
 *
 * Wires together GPS events, AR poses, and the Redux store.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 * and docs/issue-library-integration.md
 *
 * This module implements the CRITICAL data flow:
 * 1. GPS arrives (async event)
 * 2. Read current AR pose from WebXR
 * 3. Build a proper GpsPoint with coordinates relative to zero
 * 4. Dispatch library's recordGpsEvent action
 *
 * The coordinator ensures that AR and GPS data are always paired
 * and formatted correctly for the library's alignment algorithm.
 */

import type { ReducersMapObject } from '@reduxjs/toolkit';
import type { SlamAppStore } from './create-slam-app-store';
import type {
  LatLong,
  RecordGpsEventPayload,
  RawAbsoluteOrientation,
} from 'gps-plus-slam-js';
import { recordGpsEvent, setZeroPos } from 'gps-plus-slam-js';
import type { GpsPosition, RawDeviceOrientation } from '../sensors/gps';
import {
  getLatestAbsoluteOrientation,
  type AbsoluteOrientationReading,
} from '../sensors/absolute-orientation';
import { createLogger } from '../utils/logger';

const log = createLogger('RecordingCoordinator');
import type { ARPose } from '../types/ar-types';
import type { Vector3, Quaternion, RawGpsPoint } from 'gps-plus-slam-js';
import { getZeroReference, getOdometryPositions } from 'gps-plus-slam-js';

/** Counter for generating unique GPS point IDs */
let gpsEventCounter = 0;

/**
 * Configuration for the recording coordinator
 */
export interface RecordingCoordinatorConfig {
  /** Redux store to dispatch actions to */
  store: SlamAppStore<ReducersMapObject>;
  /** Function to get current AR pose (from WebXR module) */
  getArPose: () => ARPose | null;
}

/**
 * State for device orientation (captured separately from GPS)
 */
let lastDeviceOrientation: RawDeviceOrientation | null = null;

/**
 * Update the cached device orientation.
 * Called by orientation watch, used when GPS event arrives.
 */
export function updateDeviceOrientation(
  orientation: RawDeviceOrientation
): void {
  lastDeviceOrientation = orientation;
}

/**
 * Get the current cached device orientation.
 */
export function getLastDeviceOrientation(): RawDeviceOrientation | null {
  return lastDeviceOrientation;
}

// eulerToQuaternion imported from library; re-export for backward compatibility
export { eulerToQuaternion } from 'gps-plus-slam-js';

/**
 * Clear cached state (for testing or session reset)
 */
export function resetCoordinatorState(): void {
  lastDeviceOrientation = null;
  gpsEventCounter = 0;
}

/**
 * Extract raw odometry position tuple from ARPose.
 *
 * Returns the raw WebXR position without coordinate conversion.
 * The reducer applies the WebXR→NUE transform when storing into state
 * (raw-storage pattern, see docs/2026-04-09-raw-storage-convert-on-read.md).
 *
 * WebXR local-floor frame: X=East, Y=Up, Z=South (toward viewer / backward).
 */
export function extractOdomPosition(arPose: ARPose): Vector3 {
  return [arPose.position.x, arPose.position.y, arPose.position.z];
}

/**
 * Extract odometry rotation tuple from ARPose.
 */
export function extractOdomRotation(arPose: ARPose): Quaternion {
  return [
    arPose.orientation.x,
    arPose.orientation.y,
    arPose.orientation.z,
    arPose.orientation.w,
  ];
}

/**
 * Build a RawGpsPoint from GPS position data.
 * Returns only raw sensor fields — no derived fields (coordinates, weight,
 * zeroRef). Derived fields are computed by the library reducer when the
 * action is dispatched (raw-storage pattern).
 *
 * @param gpsPosition - GPS position from Geolocation API
 * @param deviceOrientation - Accepted for signature stability; no longer
 *   read (the legacy `compassAbsolute` field it fed is no longer recorded)
 * @returns RawGpsPoint ready for the action payload
 */
export function buildRawGpsPoint(
  gpsPosition: GpsPosition,
  deviceOrientation: RawDeviceOrientation | null
): RawGpsPoint {
  // `deviceOrientation` is still accepted (and consumed by the live
  // odometry-restart snapshot path elsewhere) but the legacy
  // `compassAbsolute` field is no longer populated — it was dead data on
  // recorded GPS events (§5b dead-code removal, 2026-06-28).
  void deviceOrientation;
  return {
    id: `gps-${++gpsEventCounter}`,
    latitude: gpsPosition.lat,
    longitude: gpsPosition.lon,
    altitude: gpsPosition.altitude ?? undefined,
    latLongAccuracy: gpsPosition.accuracy,
    altitudeAccuracy: gpsPosition.altitudeAccuracy ?? undefined,
    heading: gpsPosition.heading ?? undefined,
    speed: gpsPosition.speed ?? undefined,
    timestamp: gpsPosition.timestamp,
  };
}

/**
 * Map a capture-module {@link AbsoluteOrientationReading} to the library's
 * {@link RawAbsoluteOrientation} payload shape (the only difference is the
 * timestamp field name: capture `timestamp` → payload `sampleTimestamp`).
 * Returns `undefined` when the sensor produced no reading (most non-Chrome).
 */
export function toRawAbsoluteOrientation(
  reading: AbsoluteOrientationReading | null
): RawAbsoluteOrientation | undefined {
  if (!reading) return undefined;
  return {
    quaternion: reading.quaternion,
    referenceFrame: reading.referenceFrame,
    screenAngleDeg: reading.screenAngleDeg,
    sampleTimestamp: reading.timestamp,
  };
}

/**
 * Build a RecordGpsEventPayload from GPS position and AR pose.
 * This is a pure function for testability.
 *
 * Stores only raw sensor data in the payload. The library reducer
 * computes derived fields (coordinates, weight) when the action is
 * processed (raw-storage pattern).
 *
 * @param gpsPosition - GPS position from Geolocation API
 * @param arPose - AR pose from WebXR
 * @param deviceOrientation - Optional device orientation from sensors
 * @param absoluteOrientation - Optional AbsoluteOrientationSensor reading
 * @returns RecordGpsEventPayload ready for dispatch
 */
export function buildRecordGpsEventPayload(
  gpsPosition: GpsPosition,
  arPose: ARPose,
  deviceOrientation: RawDeviceOrientation | null,
  absoluteOrientation: AbsoluteOrientationReading | null = null
): RecordGpsEventPayload {
  // The legacy `rawDeviceOrientation` field is no longer populated on
  // recorded GPS events — it was dead data (the library derived
  // `deviceRotation`/`compassAbsolute` from it but nothing consumed them).
  // The live odometry-restart orientation snapshot reads the cached
  // orientation via getLastDeviceOrientation instead (§5b dead-code
  // removal, 2026-06-28).
  return {
    odomPosition: extractOdomPosition(arPose),
    odomRotation: extractOdomRotation(arPose),
    rawGpsPoint: buildRawGpsPoint(gpsPosition, deviceOrientation),
    rawAbsoluteOrientation: toRawAbsoluteOrientation(absoluteOrientation),
  };
}

/**
 * Create a GPS position handler that dispatches combined GPS+AR events.
 *
 * This is the CRITICAL function that implements the correct architecture:
 * - Called when GPS arrives
 * - Reads current AR pose
 * - Dispatches single combined action
 *
 * @param config - Configuration with store and getArPose function
 * @returns Callback function for GPS watch
 */
export function createGpsPositionHandler(
  config: RecordingCoordinatorConfig
): (position: GpsPosition) => void {
  const { store, getArPose } = config;

  return (position: GpsPosition): void => {
    // Check if we're recording
    const state = store.getState().recording;
    if (!state.isRecording) {
      return; // Don't record if not in recording mode
    }

    // Get current AR pose - this is the CRITICAL step
    const arPose = getArPose();
    if (!arPose) {
      log.warn('GPS arrived but no AR pose available');
      return; // Can't record without AR pose
    }

    // Get full state to check for zero reference
    const fullState = store.getState();

    // Set zero reference on first GPS reading if not already set
    if (!fullState.gpsData) {
      const zeroRef: LatLong = { lat: position.lat, lon: position.lon };
      store.dispatch(setZeroPos(zeroRef));
      log.info(`Set zero reference: ${zeroRef.lat}, ${zeroRef.lon}`);
    }

    // Get the zero reference (either just set or previously set)
    const updatedState = store.getState();
    const zeroRef = getZeroReference(updatedState);
    if (!zeroRef) {
      log.error('Failed to get zero reference');
      return;
    }

    // Build and dispatch the library's recordGpsEvent action. The absolute
    // orientation (if the AbsoluteOrientationSensor is active) is snapshotted
    // here so it pairs exactly with this event's AR pose.
    const payload = buildRecordGpsEventPayload(
      position,
      arPose,
      lastDeviceOrientation,
      getLatestAbsoluteOrientation()
    );
    store.dispatch(recordGpsEvent(payload));

    // Read state AFTER dispatch to get accurate count (Issue 6: was using stale pre-dispatch state)
    const postDispatchState = store.getState();
    const eventCount = getOdometryPositions(postDispatchState).length;
    log.info(`Recorded GPS event #${eventCount}`);
  };
}
