# `ref-point-mark-listener.ts`

## Purpose

Redux Toolkit listener middleware that translates every
`gpsData/markReferencePoint` action into a matching
`refPoints/addCurrentRefPointMark` action so the recorder's red
current-session sphere renders for both **live** marks and **replayed**
marks. Replays only emit `gpsData/markReferencePoint` (the explicit
`addCurrentRefPointMark` dispatch the live handler used to make is
never reached during replay), so without this listener the red sphere
was missing on replay. The legacy explicit dispatch in
`ref-points/ref-point-handlers.ts::visualizeRefPoint` is removed in the
same change to avoid double-dispatch — live and replay now flow through
the same path.

## Public API

- `createRefPointMarkListenerMiddleware(): Middleware`
  - Returns a fresh Redux Toolkit listener middleware that subscribes
    to `gpsData/markReferencePoint`. Each invocation produces an
    independent middleware instance (no module-level state).

## Invariants & assumptions

- The listener is registered by `createRecorderStore` via the
  framework factory's `extraMiddleware` seam — it must run **after** the
  `gpsData/markReferencePoint` reducer has committed the new reference
  point so that `getState()` reflects the updated alignment context if
  any. Listener middleware semantics already guarantee this ordering.
- Payload is validated defensively (id/position/rotation/rawGpsPoint).
  Malformed payloads (e.g., from rehydrated pre-schema recordings) are
  silently ignored rather than crashing the store.
- `gpsPosition` resolution mirrors the live handler that previously
  computed it inline (`ref-point-handlers.ts`):
  - If `state.gpsData.gpsEvents.alignmentMatrix` and `state.gpsData.zero`
    are both available, compute fused GPS via
    `fusedGpsFromOdom(alignmentMatrix, webxrToNUE(position), zero)` and
    use those lat/lon. Altitude falls back to the raw GPS altitude when
    fused altitude is undefined (legacy `calcGpsCoords` altitude-discard
    bug — same fallback as `flattenRefPointsToMarks`).
  - Otherwise the raw GPS lat/lon/altitude are used directly.
- `odomPosition` / `odomRotation` are stored **raw** (WebXR convention),
  matching the existing live behaviour. The library reducer applies its
  own NUE conversion when storing into `state.gpsData.referencePoints`,
  but the recorder-side `RefPointMark` is kept in the raw frame because
  the visualizer geometry expects raw WebXR coordinates.
- `timestamp` falls back to `Date.now()` if the payload omits one (same
  as the library reducer).
- The listener never throws; the fused-GPS branch is wrapped in
  `try/catch` so a numerically degenerate alignment matrix cannot crash
  the action dispatch loop.

## Examples

```ts
import { createRefPointMarkListenerMiddleware } from './ref-point-mark-listener';

const store = createSlamAppStore({
  storageBackend,
  extraMiddleware: [createRefPointMarkListenerMiddleware()],
});
```

## Tests

- [ref-point-mark-listener.test.ts](./ref-point-mark-listener.test.ts) —
  asserts:
  - markReferencePoint produces exactly one currentMarks entry with raw
    odom + raw-GPS fallback when no alignment matrix is in state;
  - timestamp falls through from payload when supplied;
  - timestamp falls back to `Date.now()` otherwise;
  - successive dispatches accumulate (one mark per action, no
    double-dispatch).

## Related docs

- [2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md)
  — §4 F2 plan that this middleware implements.
- [2026-04-30-refpoint-marks-into-redux-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-30-refpoint-marks-into-redux-plan.md)
  — original design that introduced `currentMarks` and the explicit live
  dispatch this listener now subsumes.
- [2026-04-24-refpoint-positioning-investigation.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-24-refpoint-positioning-investigation.md)
  — fused-vs-raw GPS positioning rationale.
