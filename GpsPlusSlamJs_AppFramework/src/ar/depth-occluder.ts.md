# depth-occluder.ts

## Purpose

The **live CPU-depth occluder** — hides virtual fragments behind the real surface the camera sees _this frame_. It is the sharp, registration-free, no-memory half of the occlusion feature; its companion is the persistent [`OcclusionMesh`](../visualization/occlusion-mesh.ts.md) (out-of-view memory, blocky, lagging). Both are depth-only under `arWorldGroup` and **compose** at render time (live wins where this frame has depth, the mesh fills out-of-view / depth holes — [2026-06-14-0009-webxr-depth-occlusion-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-0009-webxr-depth-occlusion-plan.md) §5).

It is a **second consumer** of the same per-frame `XRCPUDepthInformation` the sparse [`DepthSampler`](depth-sampler.ts.md) already reads for the occupancy grid — no extra depth read, no second session.

## Two confidence levels (read this before changing anything)

- **Pure occlusion math** — fully CI-tested (plan §9). Deterministic, property-tested in `depth-occluder.property.test.ts`.
- **`DepthOccluder` class** — its CPU-observable behaviour (texture (re)creation, format selection, uniform updates, full-screen mesh construction, dispose) is unit-tested in jsdom (`depth-occluder.test.ts`). **The actual GLSL occlusion is device-gated** (plan §8 Iter 2–3): no headless GL renders it, so the shader is a **first-light draft** to verify and tune on-device. Keep `occupancy.liveOcclusion` **OFF by default** until that verification lands.
- **One render path: the full-screen depth write** (`getOcclusionMesh` + `buildFullscreenOcclusionShader`): a clip-space quad writes `gl_FragDepth` from the live depth, occluding **all** virtual content like the persistent mesh — this is what the recorder wires (2026-06-29 occlusion-debug-viz-and-live-occluder feedback Finding 2). A second, never-wired per-material soft-injection draft ("Phase B": `patch()` / `injectOcclusionGlsl` / `occlusionStrength` / the soft-margin option) was **deleted 2026-07-04** as dead code review bots kept re-flagging — recover it from git history if a per-material fade is ever actually built.

## Public API

### Pure functions

- `metricDepthToWindowDepth(viewSpaceDepthMeters, projectionMatrix)` → `number` — view-space perpendicular depth (m) → window depth `[0,1]` via the WebXR `XRView.projectionMatrix` (column-major 16). Monotonic in depth; `0` at near, `1` at far. The conversion the shader needs to compare real vs. virtual depth (plan §3b).
- `screenUvToDepthUv(u, v, matrix)` → `[number, number]` — normalized screen UV → depth-buffer UV via `XRDepthInformation.normDepthBufferFromNormView.matrix` (column-major 16), with the perspective divide. Identity is a fixed point.
- `unpackLuminanceAlphaToMeters(lo, hi, rawValueToMeters)` → `number` — reconstruct metres from a 16-bit depth value packed across the `luminance` (low byte) + `alpha` (high byte) channels of an `RG8` texel.
- `selectDepthTextureFormat(width, height, byteLength)` → `'r32f' | 'luminance-alpha'` — pick the upload format from the resolved byte layout (4 bytes/texel → float32/R32F; 2 → packed). Read at runtime, not assumed (plan §3a).
- `buildFullscreenOcclusionShader()` → `{ vertexShader, fragmentShader }` — the GLSL for the **v1 full-screen depth writer**. A clip-space quad whose fragment shader samples the live depth map (`screenUvToDepthUv` via `uDepthUvFromScreenUv`), reconstructs metres (packed `lo + hi*256` or float `r`), applies the holes policy (`discard` on no/invalid depth or when disabled), and writes `gl_FragDepth` from the projection matrix (`metricDepthToWindowDepth`). The vertex shader derives the `[0,1]` screen UV from the NDC quad, so **no resolution uniform** is needed. Exported for the GLSL-mirror unit test; device-gated for actual rendering.

### Class

- `new DepthOccluder()` — construct once per AR session.
- `update(depthInfo: DepthInfo)` — upload this frame's depth + metadata. **No-op that DISABLES occlusion** when the frame lacks the occluder fields (`data` / `rawValueToMeters` / `normDepthBufferFromNormView` / `projectionMatrix`) — frame-level holes policy, so a degraded frame never occludes with stale/absent depth. Also sets `uPackedDepth` from the resolved upload format.
- `getOcclusionMesh()` → `THREE.Mesh` — **v1 render path.** Lazily creates + caches a full-screen depth-only mesh (`ShaderMaterial`, `colorWrite:false` / `depthWrite:true` / `depthTest:true`, `renderOrder = OCCLUDER_RENDER_ORDER` = −1, `frustumCulled:false`). Add it to the AR scene; its vertex shader ignores transforms (parent node irrelevant). Shares the live uniform block, so each `update` reaches it. Occludes **all** virtual content like the persistent mesh, and composes with it (nearer depth wins).
- `isEnabled()` / `getTextureFormat()` — inspection hooks.
- `dispose()` — release the depth texture and the full-screen mesh (detach + dispose geometry/material), disable. Idempotent; post-dispose `update` is a no-op.

## Invariants & assumptions

- Matrices are **column-major 16-tuples** (`Matrix4`), matching `DepthInfo.projectionMatrix` / `normDepthBufferFromNormView` from `wrapXRDepthInfo`.
- The depth map is low-res (~160×120) so the per-frame `DataTexture` upload is a few tens of KB (plan §3a). Mono AR session (one `XRView`).
- Defensive: invalid/degraded frames disable rather than throw; non-finite real/fragment depth ⇒ no occlusion.

## Examples

```ts
const occ = new DepthOccluder();
arWorldGroup.add(occ.getOcclusionMesh()); // full-screen depth writer
// per frame, from the wrapped XRCPUDepthInformation:
registerXrFrameUpdate(() => occ.update(getDepthInfoFromFrame(frame, pose)));
// on session end:
registerSessionDisposer(() => occ.dispose());
```

## Tests

- `depth-occluder.property.test.ts` — property tests for the four pure functions (bounds, monotonicity, round-trip, format selection, near/far endpoints).
- `depth-occluder.test.ts` — `DepthOccluder` lifecycle + the by-reference shared uniform block + the full-screen shader source in jsdom.
- **On-device (device-gated, not in CI):** does a real surface hide a virtual object behind it; the `gl_FragDepth` metric sanity check; the `dataFormatPreference` default (float32 vs luminance-alpha); per-frame perf; the §5 compose with the persistent mesh. See [2026-06-14-0009-webxr-depth-occlusion-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-0009-webxr-depth-occlusion-plan.md) §8.

## Related

- [depth-sampler.ts.md](depth-sampler.ts.md) — `DepthInfo` / `wrapXRDepthInfo` (the shared per-frame source).
- [webxr-session.ts.md](webxr-session.ts.md) — the `requestDepthOcclusion` session flag that negotiates `cpu-optimized` depth for this occluder.
- [occlusion-mesh.ts.md](../visualization/occlusion-mesh.ts.md) — the persistent companion occluder.
- [recording-options.ts.md](../../../GpsPlusSlamJs_RecorderApp/src/state/recording-options.ts.md) — the `occupancy.liveOcclusion` toggle.
