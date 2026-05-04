# tracking-state.ts

## Purpose

State machine that detects AR tracking loss and restart events, distinguishing between seamless recovery (Case 1) and relocalization with origin reset (Case 2).

**ARCHITECTURE NOTE:** See `docs/2026-04-08-ar-tracking-loss-review.md` for the full tracking-loss handling design.

## Public API

| Export                   | Type      | Description                                                                                         |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------- |
| `TrackingState`          | enum      | `INITIALIZING`, `TRACKING`, `LOST`                                                                  |
| `DeviceOrientation`      | interface | `{ alpha, beta, gamma, absolute }` — device sensor orientation                                      |
| `ResetTransformData`     | interface | `{ position: Vector3; orientation: Quaternion }` — serialized XRRigidTransform from the reset event |
| `TrackingStateCallbacks` | interface | Callbacks for state transitions (see below)                                                         |
| `TrackingStateManager`   | class     | State machine managing tracking loss/restart detection                                              |

### TrackingStateCallbacks

| Field                  | Type                                                  | Required | Description                                     |
| ---------------------- | ----------------------------------------------------- | -------- | ----------------------------------------------- |
| `onTrackingLost`       | `() => void`                                          | yes      | Fired on TRACKING → LOST transition             |
| `onTrackingRestarted`  | `(payload: OdometryTrackingRestartedPayload) => void` | yes      | Fired on Case 2 recovery (origin reset)         |
| `onTrackingRecovered`  | `() => void`                                          | no       | Fired on Case 1 recovery (seamless, same frame) |
| `getDeviceOrientation` | `() => DeviceOrientation`                             | yes      | Provides current sensor orientation for payload |

### TrackingStateManager Methods

| Method                        | Description                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getState()`                  | Current `TrackingState`                                                                                                                                                                                                            |
| `getLastValidPose()`          | Last `ARPose` before loss (or null)                                                                                                                                                                                                |
| `getLostFrameCount()`         | Consecutive null-pose frames in LOST state                                                                                                                                                                                         |
| `markOriginReset(transform?)` | Flag that an `XRReferenceSpace` `reset` event occurred, optionally storing the `ResetTransformData` from the event. Only effective in LOST state. When called multiple times during a single LOST window, the last transform wins. |
| `onPoseReceived(pose)`        | Call each frame with a valid pose. Triggers restart detection on LOST → TRACKING.                                                                                                                                                  |
| `onPoseLost()`                | Call each frame when pose is null. Triggers TRACKING → LOST transition.                                                                                                                                                            |
| `reset()`                     | Reset to INITIALIZING (new session). Clears the origin-reset flag.                                                                                                                                                                 |

## Invariants & Assumptions

- State transitions: INITIALIZING → TRACKING → LOST → TRACKING (cycle).
- `onTrackingLost` fires exactly once per TRACKING → LOST transition.
- `markOriginReset()` is ignored unless currently in LOST state.
- On LOST → TRACKING:
  - If `markOriginReset()` was called → **Case 2**: `onTrackingRestarted(payload)` fires with position/rotation offsets for alignment correction.
  - If `markOriginReset()` was NOT called → **Case 1**: `onTrackingRecovered()` fires (if provided). No alignment correction needed.
- The `originResetDuringLoss` flag is cleared after every LOST → TRACKING transition regardless of case.
- `lastValidPose` is updated every frame during TRACKING so it always reflects the most recent good pose.
- Payload construction uses `eulerToQuaternion()` from `gps-event-coordinator` for sensor orientation conversion.
- Payload position fields (`lastValidOdomPos`, `newOdomPos`) are converted to NUE convention via `extractOdomPosition()` from `gps-event-coordinator` — matching the convention used by `recordGpsEvent.odomPosition`.
- Payload now includes `newOdomPos` (camera position when tracking resumes) and `resetTransform` (serialized `XRReferenceSpaceEvent.transform` — the old-to-new origin delta, or `null` if the runtime couldn't determine it). These fields are captured for diagnostic analysis of field recordings.

## Examples

```typescript
const manager = new TrackingStateManager({
  onTrackingLost: () => showWarning('Tracking lost'),
  onTrackingRestarted: (payload) =>
    store.dispatch(odometryTrackingRestarted(payload)),
  onTrackingRecovered: () => clearWarning(),
  getDeviceOrientation: () => ({
    alpha: 0,
    beta: 0,
    gamma: 0,
    absolute: false,
  }),
});

// In the XR frame loop:
if (pose) {
  manager.onPoseReceived(pose);
} else {
  manager.onPoseLost();
}

// From XRReferenceSpace reset event (webxr-session.ts extracts the transform):
referenceSpace.addEventListener('reset', (event) => {
  const transform = extractResetTransform(event); // ResetTransformData | null
  manager.markOriginReset(transform);
});
```

## Tests

- **Unit tests:** `tracking-state.test.ts` — 40 tests covering state transitions, lost frame counting, restart detection, Case 1 vs Case 2 discrimination, payload correctness (including `newOdomPos` and `resetTransform`), backward compatibility, edge cases.
- **Property-based tests:** `tracking-state.property.test.ts` — 8 tests covering state machine invariants (monotonic lost count, consistent state after random events, quaternion unit property).
