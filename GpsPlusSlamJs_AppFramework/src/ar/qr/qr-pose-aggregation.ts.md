# qr-pose-aggregation.ts

## Purpose

Pure, device-free, store-free robust aggregation of a **static** QR's pose over a
short sliding window of detections, so the high-weight GPS vote and the debug
overlay consume a _converged_ pose instead of a raw single-frame pose whose
**rotation** can swing. Implements the sliding-window stabilization design in
[`GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md`](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md).

## Public API

- `averageRotation(quats, options?) → { quat, inlierCount, maxAngleDeg } | null`
  - Option R1: mode-finding reference → angle-thresholded inlier set → hemisphere-
    aligned normalized-linear quaternion average → one refit pass.
  - `options.inlierAngleDeg` (default `DEFAULT_ROTATION_INLIER_ANGLE_DEG` = 12),
    `options.reference` (override the auto mode-finding reference).
  - `null` only for an empty input. `quat` is canonicalized to `w ≥ 0`.
- `aggregateQrPose(poses, options?) → { pose, translationSpreadM, rotationSpreadDeg, inlierCount } | null`
  - Per-axis median position (lower-middle for even n, matching `medianQrPosition`)
    - R1 rotation. `null` for an empty window.
- `evaluateQrPoseStability(poses, options?) → QrPoseStability`
  - Lifecycle `unknown → measuring → stable` over the last `window` poses.
  - `options`: `window` (8), `minObservations` (5), `maxTranslationSpreadM` (0.03),
    `maxRotationSpreadDeg` (5), plus the `averageRotation` options.
  - `stable` ⟺ `sampleCount ≥ minObservations` AND both spreads under threshold.

## Invariants & assumptions

- **Feed RAW per-detection world poses only.** Never feed an aggregated pose back
  in — the window would average its own output and collapse (feedback loop that
  defeats outlier rejection). The `qrDetected` ring buffer stores raw poses for
  this reason.
- **Quaternion double cover (`q` ≡ `−q`) is handled explicitly**: geodesic angle
  uses `2·dot² − 1` (sign-invariant, clamped before `acos`); inliers are flipped
  into the reference hemisphere before the linear average. Skipping this is the #1
  bug — covered by a dedicated test.
- **Reference is chosen by mode-finding** (densest sample), NOT "the latest", so a
  bad newest frame cannot hijack the reference. O(n²) over a tiny window (~8).
- Poses are `qrPoseWorld` (raw-WebXR/odom space) — aggregation is independent of
  alignment refinement; only odom drift over <~1.5 s matters (negligible).
- Quaternions run through gl-matrix `quat` (Float32) — angle assertions use loose
  tolerances (<0.5°), not exact equality.

## Examples

```ts
import {
  averageRotation,
  evaluateQrPoseStability,
} from 'gps-plus-slam-app-framework/ar';

const r = averageRotation([qA, qB, qC]); // robust mean, drops a wild outlier
const s = evaluateQrPoseStability(recentPoses, {
  window: 8,
  minObservations: 5,
});
if (s.status === 'stable') castVote(s.pose); // only trust the converged pose
```

## Tests

- `qr-pose-aggregation.test.ts` — empty input, identical quats, the **double-cover**
  guard (`q` + `−q`), single-outlier rejection, spread reporting; `aggregateQrPose`
  median/spread; the stability lifecycle transitions + window slicing.
- `qr-pose-aggregation.property.test.ts` — for arbitrary axes/angles: jitter within
  ε aggregates to within ε of the base; a minority of wild outliers is ignored.

## Consumers

- `state/qr-detected-slice.ts` — `selectStableQrPose` / `selectQrPoseStability`
  wrap these over a marker's ring buffer (the slice may import `ar`).
- `qr-tracking-controller.ts` (vote) and the QrTrackingDemo controller (overlay)
  consume the stable pose via an injected `resolveStablePose` bridge.
