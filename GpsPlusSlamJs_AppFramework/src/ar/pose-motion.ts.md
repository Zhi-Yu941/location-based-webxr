# `pose-motion.ts`

- **Purpose:** stateless angular/linear velocity between two consecutive AR
  poses — the numeric basis for the capture motion gate that skips
  motion-blurred frames.

- **Public API:**
  - `angularVelocity(qPrev, qCur, dtSeconds): number` — geodesic angle (rad)
    between two orientations ÷ `dtSeconds`, in **rad/s**. Inputs are
    `WebXRQuaternion` (`{x,y,z,w}`).
  - `linearVelocity(pPrev, pCur, dtSeconds): number` — straight-line distance
    between two positions ÷ `dtSeconds`, in **m/s**. Inputs are `WebXRVec3`.

- **Invariants & assumptions:**
  - **`dtSeconds <= 0` → `0`** for both functions. A degenerate/duplicate frame
    timestamp can therefore never produce `Infinity`/`NaN` and spuriously flip
    the gate. The guard is written `!(dt > 0)` so `NaN` also maps to `0`.
  - `angularVelocity` is **double-cover safe** (`q` ≡ `−q`) and **normalizes**
    its inputs internally, so slightly non-unit tracking quaternions are
    tolerated. It reuses the shared `geodesicAngleRad` kernel
    (`utils/geodesic-angle.ts`) — do not add a fresh `acos` here.
  - Results are **non-negative** and **frame-invariant** (a global rotation of
    both orientations leaves the angular velocity unchanged), proven in the
    property tests.
  - Pure and stateful-free: the sliding window, glitch rejection, and capture
    decision live elsewhere (`capture-motion-gate.ts` / `ImageCaptureManager`).
    gl-matrix quaternions are Float32, so absolute precision near antipodal
    pairs is ~1e-3 rad — irrelevant at the gate's thresholds (~0.6 rad/s).

- **Examples:**

  ```ts
  import { angularVelocity, linearVelocity } from './pose-motion.js';

  const wPrev = { x: 0, y: 0, z: 0, w: 1 };
  const wCur = { x: 0, y: 0.4794, z: 0, w: 0.8776 }; // ~1 rad about Y
  angularVelocity(wPrev, wCur, 0.5); // ≈ 2 rad/s

  linearVelocity({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, 2); // 2.5 m/s
  ```

- **Tests:** `pose-motion.test.ts` (known angles/distances, double-cover,
  dt-guard, un-normalized input) and `pose-motion.property.test.ts`
  (non-negativity, frame-invariance, inverse-dt scaling).

- **Related docs:**
  `GpsPlusSlamJs_Docs/docs/2026-06-23-blurry-frame-motion-gating-plan.md` (§4.1),
  `utils/geodesic-angle.ts.md`.
