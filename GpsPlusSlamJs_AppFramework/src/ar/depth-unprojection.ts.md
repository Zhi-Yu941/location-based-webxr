# Depth Unprojection

## Purpose

Pure math helper that turns a persisted depth read (`screenX`, `screenY`, `depthM`) back into a 3D point in raw WebXR (local-floor) space using the capturing view's projection matrix. This is the inverse of what the depth camera did at capture time and the foundation of the AR-space occupancy grid.

## Public API

- **`createDepthUnprojector(cameraPos, cameraRot, projectionMatrix): DepthUnprojector | null`** — sample-scoped factory.
  - `cameraPos: Vector3` / `cameraRot: Quaternion` — raw WebXR camera pose from `DepthSample`.
  - `projectionMatrix: Matrix4 | undefined` — column-major 16-tuple of the capturing `XRView` (`DepthSample.projectionMatrix`).
  - Computes the projection inverse, camera quaternion and position **once**, returning a `{ unproject(point): Vector3 | null }` whose per-point path only does the cheap NDC→view→world transform (reusing pre-allocated `vec3`/`vec4` temporaries). Returns `null` when the sample cannot be unprojected at all (missing/singular matrix) — the designed old-recordings skip path.
  - **Use this when folding many points from one sample** (e.g. `OccupancyGrid.addSample`): build once, reuse for every point, instead of re-inverting the matrix and re-allocating the quaternion per point.
- **`unprojectDepthPoint(point, cameraPos, cameraRot, projectionMatrix): Vector3 | null`** — one-off convenience wrapper over `createDepthUnprojector` (builds a single-use unprojector). Same arguments plus the `point: DepthPoint` (normalized top-left-origin view coordinates 0–1 + z-depth in meters, exactly as fed to `getDepthInMeters`). Returns the point in raw WebXR space, or `null` for unusable input.

## Invariants & Assumptions

1. **All NDC-flip decisions live here** (port-plan §6 mitigation): `ndcX = 2·sx − 1`, `ndcY = 1 − 2·sy` (screenY grows downward). If on-device verification reveals an orientation quirk, this file is the only place to adjust.
2. **`depthM` is z-depth** (distance along the view direction, −z), not euclidean ray length — matches ARCore/WebXR depth semantics.
3. **View space is the WebXR camera frame** (+x right, +y up, −z forward); the camera pose is applied as a rigid transform (`world = rot·view + pos`).
4. **Defensive null returns** (never throws): missing/short matrix, singular matrix, `depthM ≤ 0` or non-finite, screen coordinates outside `[0, 1]` or non-finite, non-finite output. `null` for a missing matrix is the designed old-recordings path — callers skip the point.
5. Works for any invertible projection matrix (generic `mat4.invert`), not only axis-aligned frustums.
6. **Hot-path is hand-inlined (2026-06-30 perf):** `createDepthUnprojector` inverts the projection with gl-matrix **once**, then captures the inverse-projection columns + camera pose as scalars; `unproject` itself is pure arithmetic (the `vec4·M`, perspective divide, rescale, and `q·v + p` quaternion rotation, inlined — no gl-matrix calls, Float32Array temps, or `.every()` per point). ~636 → ~282 ns/point. Keeping f64 intermediates makes it marginally **more** accurate than the previous Float32Array path; the grid quantizes to 15 cm cells so this is immaterial. Benchmarked by `depth-unprojection.bench.test.ts` (opt-in `BENCH=1`).

## Examples

```ts
const worldPoint = unprojectDepthPoint(
  { screenX: 0.5, screenY: 0.5, depthM: 2 },
  sample.cameraPos,
  sample.cameraRot,
  sample.projectionMatrix
);
if (worldPoint) worldPoints.push(worldPoint);
// (Grid folding goes through `grid.addSample(sample)`, which unprojects
// every point of the sample itself via createDepthUnprojector.)
```

## Tests

- `depth-unprojection.test.ts` — convention anchors (screen center → (0,0,−d); upper screen → +Y; right screen → +X; pose translation/rotation) and all null paths.
- `depth-unprojection.property.test.ts` — fast-check round-trips: analytic view-space expectation over FOV/aspect/depth/pixel (independent of the implementation's inverse-matrix path) and rigid-transform consistency over random camera poses.
