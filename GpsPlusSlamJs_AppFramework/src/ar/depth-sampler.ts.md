# Depth Sampler

## Purpose

Samples sparse depth points from the WebXR depth sensing API at a configurable interval (~1 Hz default). Captures a grid of depth values with the camera pose for 3D reconstruction and validation.

## Public API

### `DepthSampler` (class)

- **`constructor(callbacks: DepthSamplerCallbacks, config?: Partial<DepthSamplerConfig>)`** — creates a sampler with event callbacks and optional config overrides.
- **`start(): void`** — begins sampling; resets counters and timers.
- **`stop(): void`** — stops sampling.
- **`isRunning(): boolean`** — returns whether sampling is active.
- **`getSampleCount(): number`** — number of samples captured since last `start()`.
- **`getConfig(): DepthSamplerConfig`** — returns a copy of the current config.
- **`onFrame(timestamp: number, depthInfo: DepthInfo | null): void`** — call once per XR frame. Throttles sampling to `intervalMs`.

### `wrapXRDepthInfo(raw, projectionMatrix)` (function)

Wraps a raw browser `XRDepthInformation` object into a `DepthInfo`: copies `width`/`height`, binds `getDepthInMeters` to the source object (browser implementations are this-sensitive), and defensively copies the capturing view's projection matrix (`XRView.projectionMatrix`) into a plain serializable 16-tuple. Invalid matrix input (missing, wrong length, non-finite entries) yields a `DepthInfo` without a matrix — never an error. Called by `webxr-session.ts` in the frame loop.

### Interfaces

- **`DepthSamplerConfig`** — `{ intervalMs, gridSize, unavailabilityThresholdMs }`
- **`DepthSamplerCallbacks`** — `{ onSampleCaptured, getCurrentPose, onDepthUnavailable? }`
- **`DepthInfo`** — subset of `XRDepthInformation`: `{ width, height, getDepthInMeters, projectionMatrix? }`

## Invariants & Assumptions

1. **Raw WebXR coordinate convention** — `cameraPos` in each `DepthSample` is the raw WebXR local-floor position (X=East, Y=Up, Z=South); `extractOdomPosition()` performs no conversion. Consumers (e.g. the occupancy grid) work directly in this frame; anything needing NUE must convert itself.
2. **Epoch-ms timestamps** — `timestamp` in `DepthSample` is `performance.timeOrigin + xrFrameTime`, matching all other persisted action timestamps (GPS events, images, reference points).
3. **Camera rotation is raw WebXR** — `cameraRot` quaternion `[x, y, z, w]` is taken directly from `ARPose.orientation` (no NUE conversion for rotations).
4. **Interval gating** — successive samples require at least `intervalMs` between them; intervening frames are skipped.
5. **Pose required** — if `getCurrentPose()` returns null the frame is silently skipped.
6. **Unavailability detection** — if no depth data arrives within `unavailabilityThresholdMs` of `start()`, `onDepthUnavailable` fires once.
7. **Intrinsics travel with the sample** — when the `DepthInfo` carries a `projectionMatrix`, it is copied into the emitted `DepthSample` (additive persisted-format field). Samples without it (old recordings) stay byte-identical to the previous format; consumers must skip unprojection for them.

## Examples

```ts
const sampler = new DepthSampler({
  onSampleCaptured: (sample) => store.dispatch(recordDepthSample(sample)),
  getCurrentPose: () => xrSession.getCurrentPose(),
});
sampler.start();
// In XR frame loop:
sampler.onFrame(xrFrame.predictedDisplayTime, depthInfo);
```

## Tests

- `depth-sampler.test.ts` — covers:
  - Lifecycle (start/stop/isRunning)
  - Interval throttling
  - Grid sampling at various sizes (default 16×16)
  - Pose unavailability handling
  - Depth unavailability detection and callback
  - Raw-WebXR cameraPos convention
  - Epoch-ms timestamp conversion
  - projectionMatrix copy into samples + back-compat absence path
  - `wrapXRDepthInfo` binding, tuple copy, and defensive matrix validation
