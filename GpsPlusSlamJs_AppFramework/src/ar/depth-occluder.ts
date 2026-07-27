/**
 * Live CPU-depth occluder — hides virtual fragments behind the real surface the
 * camera sees *this frame*.
 *
 * Companion to the **persistent** `OcclusionMesh` (`visualization/occlusion-mesh.ts`):
 * that one meshes the accumulated occupancy grid (remembers out-of-view geometry,
 * blocky, lagging); this one reads the per-frame `XRCPUDepthInformation` and
 * occludes per-pixel against the surface currently in view (sharp, registration-
 * free, no memory). They **compose** — both depth-only under `arWorldGroup`, the
 * live occluder wins where this frame has depth, the mesh fills out-of-view / depth
 * holes (2026-06-14-0009-webxr-depth-occlusion-plan.md §5).
 *
 * **Two layers, two confidence levels:**
 *  - The **pure occlusion math** (this file's exported functions) is the CI-tested
 *    core (plan §9): the metric-depth→window-depth conversion, the screen-UV→depth-UV
 *    transform, the `luminance-alpha`→metres unpack, the depth-texture format
 *    selection, and the soft-margin / holes occlusion-strength policy. These are
 *    deterministic and property-tested.
 *  - The **{@link DepthOccluder} class** owns the per-frame `THREE.DataTexture`
 *    upload, the shared uniform block, the lifecycle (enable / dispose), and the
 *    **full-screen depth-write render path** ({@link DepthOccluder.getOcclusionMesh}):
 *    a clip-space quad that writes `gl_FragDepth` from the live depth map, so the
 *    normal depth test hides **all** virtual content behind real surfaces — the
 *    "do what the persistent mesh does" path the recorder uses (2026-06-29
 *    occlusion-debug-viz-and-live-occluder feedback Finding 2). Hard-edged.
 *    The JS-observable behaviour (texture (re)creation, uniform updates, mesh
 *    construction, disposal) is unit-tested in jsdom, but the **actual GLSL occlusion
 *    is device-gated** (plan §8 Iter 2–3): no headless GL renders it, so the shader is
 *    a first-light draft to verify/tune on-device (the `gl_FragDepth` sanity check,
 *    the depth-UV Y orientation, the float-vs-packed default). Keep
 *    `occupancy.liveOcclusion` OFF by default until that verification lands.
 *
 *    (A second render path — a per-material soft-margin `onBeforeCompile`
 *    injection, "Phase B" — existed here as a never-wired draft until 2026-07-04
 *    and was deleted: dead code that review bots kept re-flagging. Recover it
 *    from git history if a per-material fade is ever actually built.)
 *
 * @see depth-occluder.ts.md for detailed documentation
 * @see ar/depth-sampler.ts — `DepthInfo` / `wrapXRDepthInfo` (the per-frame source)
 */

import * as THREE from 'three';
import type { DepthInfo } from './depth-sampler.js';

/** Render order of the full-screen depth writer — before virtual content
 *  (≥ 0) and at/after the persistent mesh (−2), so it composes with the mesh
 *  (nearer depth wins) and lays depth before content draws (plan §5). */
export const OCCLUDER_RENDER_ORDER = -1;

/** The two upload formats `XRCPUDepthInformation` resolves to (plan §3a/§10). */
export type DepthTextureFormat = 'r32f' | 'luminance-alpha';

/**
 * Convert a **view-space perpendicular depth** `d` (metres in front of the camera)
 * to a window-space depth in `[0, 1]` using the WebXR `XRView.projectionMatrix`
 * `P` (column-major 16-tuple). This is the conversion both the per-material and
 * the full-screen techniques need to compare the real surface against a virtual
 * fragment's depth (plan §3b):
 *
 * ```
 * z_clip = -d·P[10] + P[14]
 * w_clip = -d·P[11] + P[15]
 * z_ndc  = z_clip / w_clip
 * window = 0.5·z_ndc + 0.5
 * ```
 *
 * Assumes the sampled value is the perpendicular z-distance (WebXR/ARCore depth
 * semantics). Monotonic in `d` for a standard perspective `P`, and lands in
 * `[0, 1]` for `d ∈ [near, far]` — both pinned by the property tests.
 */
export function metricDepthToWindowDepth(
  viewSpaceDepthMeters: number,
  projectionMatrix: ArrayLike<number>
): number {
  const d = viewSpaceDepthMeters;
  // Column-major 16-tuple by contract; `?? 0` only guards a malformed input
  // (too short), which a well-formed projection matrix never triggers.
  const p10 = projectionMatrix[10] ?? 0;
  const p11 = projectionMatrix[11] ?? 0;
  const p14 = projectionMatrix[14] ?? 0;
  const p15 = projectionMatrix[15] ?? 0;
  const zClip = -d * p10 + p14;
  const wClip = -d * p11 + p15;
  return 0.5 * (zClip / wClip) + 0.5;
}

/**
 * Map a normalized **screen** UV (`[0,1]²`, origin bottom-left) to the normalized
 * **depth-buffer** UV via `XRDepthInformation.normDepthBufferFromNormView`'s
 * `.matrix` (column-major 16-tuple). The depth texture is not 1:1 with the
 * framebuffer (it is low-res and may be rotated), so the shader must apply this
 * transform before sampling (plan §3c). Returns `[u, v]` after the perspective
 * divide. The identity matrix is a fixed point (verified in tests).
 */
export function screenUvToDepthUv(
  u: number,
  v: number,
  matrix: ArrayLike<number>
): [number, number] {
  // Homogeneous transform of (u, v, 0, 1); column-major index = col*4 + row.
  // `?? 0` only guards a malformed (too-short) matrix; a 16-tuple never hits it.
  const at = (i: number): number => matrix[i] ?? 0;
  const x = at(0) * u + at(4) * v + at(12);
  const y = at(1) * u + at(5) * v + at(13);
  const w = at(3) * u + at(7) * v + at(15);
  if (w !== 0 && Number.isFinite(w)) {
    return [x / w, y / w];
  }
  return [x, y];
}

/**
 * Reconstruct metres from a 16-bit depth value packed across the `luminance`
 * (low byte) + `alpha` (high byte) channels of an `RG8` texel, then scale by
 * `XRCPUDepthInformation.rawValueToMeters` (plan §3a/§9). `lo`/`hi` are the two
 * `0–255` bytes; round-trips a known raw value (property-tested).
 */
export function unpackLuminanceAlphaToMeters(
  lo: number,
  hi: number,
  rawValueToMeters: number
): number {
  const raw = (lo & 0xff) + (hi & 0xff) * 256;
  return raw * rawValueToMeters;
}

/**
 * Pick the `DataTexture` upload format from the resolved depth buffer's byte
 * count (plan §3a). `float32` raw depth is 4 bytes/texel → `r32f`; the
 * `luminance-alpha` 16-bit packing is 2 bytes/texel. We read the actual
 * resolved layout at runtime rather than assuming the `dataFormatPreference`
 * order, because the UA chooses (plan §3a "read it at runtime").
 */
export function selectDepthTextureFormat(
  width: number,
  height: number,
  byteLength: number
): DepthTextureFormat {
  const texels = width * height;
  if (texels > 0 && byteLength >= texels * 4) {
    return 'r32f';
  }
  return 'luminance-alpha';
}

/** Shared uniform block of the full-screen occluder. Held by reference so
 *  {@link DepthOccluder.update} reaches the mounted material every frame. */
interface DepthOccluderUniforms {
  uDepthTexture: { value: THREE.DataTexture | null };
  uRawValueToMeters: { value: number };
  uDepthUvFromScreenUv: { value: THREE.Matrix4 };
  uProjectionMatrix: { value: THREE.Matrix4 };
  uOccluderEnabled: { value: number };
  /** 1 when the depth texture is packed luminance-alpha (RG8), 0 for float R32F.
   *  Tells the shader how to reconstruct metres from a texel. */
  uPackedDepth: { value: number };
}

/**
 * GLSL for the **full-screen depth-write occluder** (v1 — the "do what the
 * persistent mesh does" path). A clip-space quad whose fragment shader samples
 * the live depth map and writes `gl_FragDepth` from the real surface depth, so
 * the normal depth test then hides ALL virtual content behind real surfaces —
 * no per-material patching (2026-06-29-occlusion-debug-viz-and-live-occluder
 * user-feedback Finding 2).
 *
 * The fragment math **mirrors the CI-tested pure functions**:
 * `screenUvToDepthUv` (the `uDepthUvFromScreenUv` transform + perspective
 * divide), the `luminance-alpha`→metres unpack, the holes policy (no/invalid
 * depth ⇒ `discard` ⇒ never occlude, so the persistent mesh shows through), and
 * `metricDepthToWindowDepth` (the projection-matrix metres→window-depth step).
 *
 * The vertex shader maps the quad's NDC position to a `[0,1]` screen UV varying,
 * so the shader needs **no resolution uniform** (the interpolated UV *is* the
 * normalized screen coordinate). Mono AR (one `XRView`) — plan §3c.
 *
 * **Device-gated tuning** (the on-device gate, not CI): the depth-UV Y
 * orientation, the float-vs-packed default, and that `gl_FragDepth` is writable
 * on the target (it may need an extension/`glslVersion` on some renderers).
 */
export function buildFullscreenOcclusionShader(): {
  vertexShader: string;
  fragmentShader: string;
} {
  const vertexShader = `
varying vec2 vScreenUv;
void main() {
  // Fullscreen clip-space quad: 'position' (PlaneGeometry(2,2)) is already in
  // NDC [-1,1]; the interpolated [0,1] uv is the normalized screen coordinate,
  // so no resolution uniform is needed. View/projection are intentionally
  // ignored — this writes gl_FragDepth, not geometry depth.
  vScreenUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
  const fragmentShader = `
precision highp float;
uniform sampler2D uDepthTexture;
uniform float uRawValueToMeters;
uniform mat4 uDepthUvFromScreenUv;
uniform mat4 uProjectionMatrix;
uniform float uOccluderEnabled;
uniform float uPackedDepth;
varying vec2 vScreenUv;
void main() {
  // No valid depth this frame → write nothing (frame-level holes policy).
  if (uOccluderEnabled < 0.5) { discard; }
  // Normalized screen UV → depth-buffer UV (low-res / possibly rotated), then
  // perspective divide — mirrors screenUvToDepthUv.
  vec4 duv = uDepthUvFromScreenUv * vec4(vScreenUv, 0.0, 1.0);
  vec2 depthUv = duv.xy / duv.w;
  vec4 texel = texture2D(uDepthTexture, depthUv);
  // Reconstruct metres: packed luminance-alpha (lo + hi*256) or float R32F.
  float realDepthMeters = uPackedDepth > 0.5
    ? (texel.r * 255.0 + texel.g * 255.0 * 256.0) * uRawValueToMeters
    : texel.r * uRawValueToMeters;
  // Hole / invalid texel → never occlude (per-texel holes policy).
  if (!(realDepthMeters > 0.0)) { discard; }
  // metres → window depth via the WebXR projection matrix (column-major
  // [col][row]) — mirrors metricDepthToWindowDepth.
  float zClip = -realDepthMeters * uProjectionMatrix[2][2] + uProjectionMatrix[3][2];
  float wClip = -realDepthMeters * uProjectionMatrix[2][3] + uProjectionMatrix[3][3];
  gl_FragDepth = 0.5 * (zClip / wClip) + 0.5;
  // colorWrite is off on the material; this is only here to satisfy GLSL1.
  gl_FragColor = vec4(0.0);
}
`;
  return { vertexShader, fragmentShader };
}

/**
 * Manages the live occluder's GPU side: one small per-frame depth `DataTexture`,
 * the shared uniform block, and the full-screen depth-write mesh. Construct once
 * per AR session, `update(depthInfo)` each frame from the wrapped
 * `XRCPUDepthInformation`, mount {@link getOcclusionMesh} in the AR scene, and
 * `dispose()` on session end.
 *
 * The GLSL is a **device-gated first-light draft** (see the file header): its
 * CPU-observable effects are unit-tested, but the on-device occlusion must be
 * verified and tuned (plan §8 Iter 2–3) before `liveOcclusion` ships on.
 */
export class DepthOccluder {
  private readonly uniforms: DepthOccluderUniforms;
  private fullscreenMesh: THREE.Mesh | null = null;
  private texture: THREE.DataTexture | null = null;
  private textureFormat: DepthTextureFormat | null = null;
  private textureWidth = 0;
  private textureHeight = 0;
  private disposed = false;

  constructor() {
    this.uniforms = {
      uDepthTexture: { value: null },
      uRawValueToMeters: { value: 1 },
      uDepthUvFromScreenUv: { value: new THREE.Matrix4() },
      uProjectionMatrix: { value: new THREE.Matrix4() },
      // Disabled until the first valid depth frame lands, so the shader never
      // samples a null texture.
      uOccluderEnabled: { value: 0 },
      // Set per frame in update() from the resolved upload format.
      uPackedDepth: { value: 0 },
    };
  }

  /** Whether a usable depth texture has been uploaded (occlusion is live). */
  isEnabled(): boolean {
    return this.uniforms.uOccluderEnabled.value === 1;
  }

  /** The current upload format, or null before the first {@link update}. */
  getTextureFormat(): DepthTextureFormat | null {
    return this.textureFormat;
  }

  /**
   * The **full-screen depth-write occluder** mesh (v1 path) — lazily created and
   * cached. Add it to the AR scene (its vertex shader ignores transforms, so the
   * parent node is irrelevant; the recorder adds it under `arWorldGroup`). It is
   * `colorWrite:false` / `depthWrite:true` / `depthTest:true` at
   * {@link OCCLUDER_RENDER_ORDER}, so it lays the real-surface depth before
   * virtual content draws and composes with the persistent mesh (nearer wins).
   * Shares the live uniform block, so each {@link update} reaches it.
   */
  getOcclusionMesh(): THREE.Mesh {
    if (!this.fullscreenMesh) {
      const { vertexShader, fragmentShader } = buildFullscreenOcclusionShader();
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
        vertexShader,
        fragmentShader,
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      mesh.name = 'live-depth-occluder';
      mesh.frustumCulled = false; // covers the whole viewport in clip space
      mesh.renderOrder = OCCLUDER_RENDER_ORDER;
      this.fullscreenMesh = mesh;
    }
    return this.fullscreenMesh;
  }

  /**
   * Upload this frame's depth + metadata. No-op (and disables occlusion) when the
   * depth info lacks the occluder fields (`data` / `rawValueToMeters` /
   * `normDepthBufferFromNormView` / `projectionMatrix`) — e.g. a sparse-only
   * frame — so a degraded frame can never occlude with stale or absent depth.
   */
  update(depthInfo: DepthInfo): void {
    if (this.disposed) return;
    const { data, rawValueToMeters, normDepthBufferFromNormView } = depthInfo;
    if (
      !data ||
      typeof rawValueToMeters !== 'number' ||
      !normDepthBufferFromNormView ||
      !depthInfo.projectionMatrix
    ) {
      // Insufficient metadata → never occlude with this frame (holes policy at
      // the frame level; complements the shader's per-texel discard on holes).
      this.uniforms.uOccluderEnabled.value = 0;
      return;
    }

    const { width, height } = depthInfo;
    const format = selectDepthTextureFormat(width, height, data.byteLength);
    this.ensureTexture(width, height, format, data);

    this.uniforms.uPackedDepth.value = format === 'luminance-alpha' ? 1 : 0;
    this.uniforms.uRawValueToMeters.value = rawValueToMeters;
    this.uniforms.uDepthUvFromScreenUv.value.fromArray(
      normDepthBufferFromNormView
    );
    this.uniforms.uProjectionMatrix.value.fromArray(depthInfo.projectionMatrix);
    this.uniforms.uOccluderEnabled.value = 1;
  }

  /** (Re)create the DataTexture on a size/format change, else refresh its data. */
  private ensureTexture(
    width: number,
    height: number,
    format: DepthTextureFormat,
    data: ArrayBuffer
  ): void {
    const needNew =
      this.texture === null ||
      this.textureWidth !== width ||
      this.textureHeight !== height ||
      this.textureFormat !== format;
    if (needNew) {
      this.texture?.dispose();
      this.texture =
        format === 'r32f'
          ? new THREE.DataTexture(
              new Float32Array(data),
              width,
              height,
              THREE.RedFormat,
              THREE.FloatType
            )
          : new THREE.DataTexture(
              new Uint8Array(data),
              width,
              height,
              THREE.RGFormat,
              THREE.UnsignedByteType
            );
      this.texture.needsUpdate = true;
      this.textureWidth = width;
      this.textureHeight = height;
      this.textureFormat = format;
      this.uniforms.uDepthTexture.value = this.texture;
    } else if (this.texture) {
      // Reuse the texture; overwrite its backing data in place.
      const image = this.texture.image as { data: ArrayBufferView };
      image.data =
        format === 'r32f' ? new Float32Array(data) : new Uint8Array(data);
      this.texture.needsUpdate = true;
    }
  }

  /** Release the depth texture and the full-screen mesh. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.uniforms.uOccluderEnabled.value = 0;
    this.uniforms.uDepthTexture.value = null;
    this.texture?.dispose();
    this.texture = null;
    if (this.fullscreenMesh) {
      this.fullscreenMesh.removeFromParent();
      this.fullscreenMesh.geometry.dispose();
      (this.fullscreenMesh.material as THREE.Material).dispose();
      this.fullscreenMesh = null;
    }
  }
}
