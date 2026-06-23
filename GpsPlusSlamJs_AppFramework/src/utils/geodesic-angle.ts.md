# `geodesic-angle.ts`

- **Purpose:** the single shared definition of the shortest-arc rotation angle
  between two unit quaternions, in radians.

- **Public API:**
  - `geodesicAngleRad(a: ReadonlyQuat, b: ReadonlyQuat): number` — returns the
    geodesic angle in `[0, π]`. Inputs are gl-matrix quaternions (any
    4-element indexable accepted by gl-matrix `quat.dot`).
    - **Error modes:** none thrown. Returns `0` (not `NaN`) for identical /
      near-identical inputs thanks to the pre-`acos` clamp.

- **Invariants & assumptions:**
  - Inputs are assumed **unit length**. Callers holding raw quaternions must
    `quat.normalize` first (both current callers already do).
  - Double-cover safe: `q` and `−q` produce the same angle (the formula uses
    `dot²`).
  - Formula `cos θ = 2·dot² − 1` is algebraically identical to gl-matrix
    `quat.getAngle`; the only behavioural difference is the clamp, which turns
    the near-identical `NaN` case into `0`.

- **Consumers (do not re-derive `acos` elsewhere):**
  - `ar/qr-pose-aggregation.ts` — inlier/spread angles.
  - `state/tracking-quality.ts` `matrixDelta` — rotation delta term (was a raw
    `quat.getAngle` + explicit NaN guard).
  - `ar/pose-motion.ts` — capture motion-gate angular velocity.

- **Examples:**

  ```ts
  import { quat } from 'gl-matrix';
  import { geodesicAngleRad } from '../utils/geodesic-angle.js';

  const a = quat.setAxisAngle(quat.create(), [0, 1, 0], 0);
  const b = quat.setAxisAngle(quat.create(), [0, 1, 0], Math.PI / 2);
  geodesicAngleRad(a, b); // ≈ 1.5708
  ```

- **Tests:** `geodesic-angle.test.ts` (known angles, identity/no-NaN,
  double-cover invariance, parity with `quat.getAngle`). The existing
  `qr-pose-aggregation.property.test.ts` and `tracking-quality.test.ts` guard
  that re-pointing the two original call sites preserved behaviour.

- **Related docs:**
  `GpsPlusSlamJs_Docs/docs/2026-06-23-followup-consolidate-geodesic-angle-kernel.md`,
  `GpsPlusSlamJs_Docs/docs/2026-06-23-blurry-frame-motion-gating-plan.md` (§4.1).
