# `frame-tile-visualizer.ts`

## Purpose

3D-scene visualizer for captured camera frames. Each entry surfaced
by the framework's `selectFrameTilesInWebXR` selector (one per
accepted `gpsData/add2dImage` action) becomes a textured square in
the WebXR scene, anchored at the WebXR pose recorded at capture
time. (Step 5.7a-2 deleted the legacy `framesInScene` mirror — the
selector is now the sole source.)

Part of F3 of
[2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-26-tracking-quality-regression-and-replay-gaps-user-feedback.md).

## Public API

```ts
class FrameTileVisualizer {
  constructor(scene: THREE.Scene, options?: { sizeMeters?: number });
  // `FrameTile` is a local alias for the framework's `ArImageCapture`
  // (the shape `selectFrameTilesInWebXR` produces).
  addTile(frame: FrameTile, texture: THREE.Texture): void;
  clear(): void;
  dispose(): void;
  getCount(): number;
}
```

## Design notes

- **Scene is injected** (no `getScene()` call). Same P3 rule as
  `syncGpsAnchoredMeshes` and `ref-point-visualizer`.
- **Shared geometry** — one `PlaneGeometry(1, 1)` at module scope,
  reused by every tile. Per-tile size comes from `mesh.scale`.
- **Per-tile material + texture** — captured frames cannot share a
  texture, so each tile owns its `MeshBasicMaterial({ map: texture })`.
  Materials and textures are disposed by `clear()` / `dispose()`. The
  shared geometry is never disposed (it lives for the module's
  lifetime, matching the resource model in `syncGpsAnchoredMeshes`).
- **Texture decoding lives outside this class.** `addTile` accepts a
  pre-built `THREE.Texture` so the class is jsdom-testable. F3.4's
  `wireFrameTileSubscribers` owns the `Blob → Texture` decode plus
  any broken-frame filtering.
- **Append-only by `imageFile` key.** A second `addTile` call with
  the same `imageFile` is a no-op, mirroring the slice's append-only
  semantics; frames are never re-published.
- **Coordinate space.** WebXR pose is applied directly because the
  scene is the live WebXR scene. The library's `webxrToNUE`
  conversion is only relevant to the serialized `odometryPath`
  inside `gpsDataSlice` and does not apply here.
  - **⚠️ Known issue — this claim is wrong (frame bug, fix pending).**
    The visualizer is parented at the **scene root**, which is the
    GPS-world NUE frame, not a WebXR-frame node — so the raw-WebXR
    poses land axis-swapped (missing `WEBXR_TO_NUE`) and detached from
    the alignment matrix. Confirmed by code review; same wrong-node
    class as the hit-test reticle and the occupancy cubes (Iter 7).
    Tracked, with the failing-test-first resolution path, in
    [2026-06-12-followup-frame-tile-visualizer-frame-check.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-12-followup-frame-tile-visualizer-frame-check.md).
    This note (and the header comment) will be rewritten when the fix
    lands.
