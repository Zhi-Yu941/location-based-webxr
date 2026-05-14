# webxr-session.ts

## Purpose

Manages WebXR AR session initialization, Three.js renderer setup, and the XR frame loop.

**ARCHITECTURE NOTE:** See `docs/architecture-ar-gps-pose-separation.md` for the scene hierarchy design.

## Scene Hierarchy

```
scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
├── cameraFollower (lerps to camera world position; rotation = identity; Issue 8)
│   └── GPS compass cubes, map mesh, etc.
└── arWorldGroup (local space = NUE; receives alignment matrix directly)
    └── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE matrix, matrixAutoUpdate=false)
        └── arpose (Object3D - AR pose; local space = WebXR)
            └── camera (PerspectiveCamera)
```

- `arWorldGroup` local space is **NUE** — objects added here use `[1,0,0]`=North, `[0,0,1]`=East.
  `applyAlignmentMatrix(m)` writes `m` directly to `arWorldGroup.matrix` (no WEBXR_TO_NUE composition).
- `basisChangeNode` is a static child of arWorldGroup holding the constant WEBXR_TO_NUE basis-change
  matrix. It is set once at scene creation and never modified. This ensures the full camera chain is:
  `camera_world = alignment × WEBXR_TO_NUE × arpose × camera_local` — mathematically identical to the
  previous runtime composition, but WEBXR_TO_NUE now lives in the scene graph instead of code.
- `arpose` local space is **WebXR** (X=East, Y=Up, Z=South):
  - **Recording:** stays at identity (transparent in transform chain)
  - **Replay:** receives recorded `odomPosition`/`odomRotation` from store subscriber (positions must
    be converted from NUE to WebXR via `nuePositionToWebXR()`, and rotations via `nueQuaternionToWebXR()`,
    before writing to `arpose.position` / `arpose.quaternion`)
- Camera's local transform = raw AR pose (recording) or user controls (replay)
- Camera's world transform = `arWorldGroup.matrix × basisChangeNode.matrix × arpose.matrix × camera.matrix`

## Public API

| Export                           | Type                                                 | Description                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ARPose`                         | interface                                            | Extracted pose data (position + orientation)                                                                                                                                         |
| `extractPoseFromViewer()`        | `(XRViewerPose \| null) => ARPose \| null`           | Extract pose from XR frame (pure function)                                                                                                                                           |
| `isXRCameraLike()`               | `(unknown) => value is XRCameraLike`                 | Runtime guard for `XRView.camera` candidates; accepts only finite positive `width`/`height` values used by the capture pipeline                                                      |
| `getCurrentArPose()`             | `() => ARPose \| null`                               | Get latest raw AR pose (for GPS callback)                                                                                                                                            |
| `buildSessionOptions()`          | `(Element \| null) => XRSessionInit`                 | Build XR session options (throws if null)                                                                                                                                            |
| `createSceneHierarchy()`         | `() => { scene, arWorldGroup, arpose, camera }`      | Create scene with correct hierarchy                                                                                                                                                  |
| `isWebXRSupported()`             | `async () => boolean`                                | Check if immersive-ar is available                                                                                                                                                   |
| `initAR()`                       | `async (container: HTMLElement) => void`             | Start AR session and Three.js renderer                                                                                                                                               |
| `getScene()`                     | `() => THREE.Scene \| null`                          | Get current Three.js scene                                                                                                                                                           |
| `getArWorldGroup()`              | `() => THREE.Group \| null`                          | Get AR world group (for AR content)                                                                                                                                                  |
| `getCamera()`                    | `() => THREE.PerspectiveCamera \| null`              | Get current camera                                                                                                                                                                   |
| `getArPose()`                    | `() => THREE.Object3D \| null`                       | Get arpose node (for replay odom updates)                                                                                                                                            |
| `setScene()`                     | `(s: THREE.Scene \| null) => void`                   | Set scene externally (for replay mode)                                                                                                                                               |
| `setArWorldGroup()`              | `(g: THREE.Group \| null) => void`                   | Set AR world group externally (for replay mode)                                                                                                                                      |
| `setCamera()`                    | `(c: THREE.PerspectiveCamera \| null) => void`       | Set camera externally (for replay mode)                                                                                                                                              |
| `setArPose()`                    | `(a: THREE.Object3D \| null) => void`                | Set arpose externally (for replay mode)                                                                                                                                              |
| `applyAlignmentMatrix()`         | `(matrix: number[]) => void`                         | Write alignment directly to arWorldGroup.matrix                                                                                                                                      |
| `nuePositionToWebXR()`           | `(nue: number[]) => [n, n, n]`                       | Convert NUE position to WebXR (for replay arpose)                                                                                                                                    |
| `nueQuaternionToWebXR()`         | `(nue: readonly number[]) => [n, n, n, n]`           | Convert NUE quaternion to WebXR `[z, y, -x, w]` (for replay arpose rotation)                                                                                                         |
| `endARSession()`                 | `async () => void`                                   | Full AR cleanup: stops animation loop, ends XR session, disposes CSS3D manager, removes canvas from DOM, disposes renderer, cleans blit resources                                    |
| `setImageCaptureCallback()`      | `(cb, getRotation) => void`                          | Set callback for when images are captured                                                                                                                                            |
| `startImageCapture()`            | `(config?: Partial<ImageCaptureConfig>) => void`     | Start periodic image capture with optional config                                                                                                                                    |
| `stopImageCapture()`             | `() => void`                                         | Stop periodic image capture                                                                                                                                                          |
| `setTrackingLostCallback()`      | `(cb: () => void) => void`                           | Register callback for tracking loss events                                                                                                                                           |
| `setTrackingCallbacks()`         | `(cb: (payload) => void) => void`                    | Register callback for tracking restart (Case 2: origin reset). Activates store-backed tracking pipeline and `XRReferenceSpace` reset listener.                                       |
| `setTrackingRecoveredCallback()` | `(cb: () => void) => void`                           | Register callback for seamless tracking recovery (Case 1: same coordinate frame). Clears UI warning without alignment correction.                                                    |
| `setTrackingStore()`             | `(store: TrackingSubscribableStore \| null) => void` | Inject the Redux store used to drive tracking-phase callbacks. Must be called before `initAR()` whenever any tracking callback is wired. Passing `null` tears down the subscription. |

## Invariants & Assumptions

- Requires browser with WebXR support (`navigator.xr`)
- Three.js renderer runs in XR mode with `renderer.xr.enabled = true`
- Session uses `local-floor` reference space
- DOM overlay optional (for HUD visibility during AR)
- Depth sensing optional (for depth point capture)
- Camera-access optional (for blit-based image capture; falls back to canvas.toBlob)
- **Container element must be provided** — `initAR(container)` no longer queries the DOM internally; the caller passes the container element
- `ARPose` is a plain object suitable for JSON serialization
- **Camera MUST be parented under arpose (which is under basisChangeNode under arWorldGroup)** for pose separation to work
- **arpose is identity during recording** — transparent in the transform chain
- **arpose in replay** receives NUE odom positions converted to WebXR via `nuePositionToWebXR()` so the
  composed `alignment × WEBXR_TO_NUE` chain produces the correct GPS world position
- **basisChangeNode holds WEBXR_TO_NUE permanently** (`matrixAutoUpdate=false`). `applyAlignmentMatrix()`
  writes the alignment directly to `arWorldGroup.matrix` without any matrix multiplication. The
  WEBXR_TO_NUE effect is achieved through the scene graph, not code — zero runtime cost per call.
- **arWorldGroup local space is NUE** — any child added directly to arWorldGroup can use NUE coordinates:
  `[1,0,0]`=North, `[0,0,1]`=East, `[0,1,0]`=Up. No WebXR↔NUE conversion needed.
- **Lighting is in scene** (GPS world space), not arWorldGroup (AR local space)
- When `camera-access` is granted, each XR frame extracts the camera texture via `renderer.xr.getCameraTexture()` for the blit capture pipeline
- `isXRCameraLike()` accepts only finite, positive numeric dimensions so downstream capture sizing never consumes `0`, negative, `NaN`, or infinite camera sizes
- **Tracking loss handling:** When `setTrackingCallbacks()` is called, `initAR()` requires a tracking store to have been injected via `setTrackingStore(store)`. It then subscribes to the store, listens for `XRReferenceSpace` `reset` events, and dispatches `originResetAction(transform)` (serializing `XRReferenceSpaceEvent.transform`'s `position`/`orientation` to tuple arrays as `ResetTransformData`, or `null` if the runtime can't determine the delta). The store subscription translates tracking-phase transitions into the legacy callback contract: `tracking→lost` invokes `onTrackingLost` and clears `latestArPose`; `lost→tracking` with a non-null `lastRestartedPayload` invokes `onTrackingRestarted(payload)` (Case 2) and dispatches `clearLastRestartedPayloadAction`; `lost→tracking` with a null payload invokes `onTrackingRecovered` (Case 1, seamless). On every XR frame, `updateTrackingState()` dispatches `poseReceivedAction({pose, sensorOrientation})` or `poseLostAction()` against the store. See `state/tracking-slice.ts.md` and `docs/2026-04-08-ar-tracking-loss-review.md`.
- **Replay mode:** `setScene()`, `setArWorldGroup()`, `setCamera()`, `setArPose()` allow non-WebXR code paths (e.g., `initReplayScene()`) to register scene objects so that existing visualizers and `applyAlignmentMatrix()` work without `initAR()` having run. `resetWebXRState()` clears both AR and setter-provided values.
- **`resetWebXRState()` performs full renderer cleanup:** stops the animation loop (`setAnimationLoop(null)`), removes the canvas from the DOM, and calls `renderer.dispose()` before nulling module state.
- **No hardcoded DOM IDs:** the renderer canvas is never assigned an `id` attribute — callers must hold their own reference.

## Internal State

- `renderer` - THREE.WebGLRenderer instance
- `scene` - THREE.Scene with lights (GPS world frame)
- `arWorldGroup` - THREE.Group for AR content (transformed by alignment)
- `arPoseNode` - THREE.Object3D between arWorldGroup and camera (identity during recording, odom pose during replay)
- `camera` - THREE.PerspectiveCamera (child of arPoseNode)
- `xrSession` - Current XRSession
- `latestArPose` - Most recent raw AR pose (updated every frame)

## Frame Loop

`onXRFrame()` is called each animation frame:

1. Get viewer pose from `frame.getViewerPose()`
2. Extract position/orientation via `extractPoseFromViewer()`
3. Store in `latestArPose` for `getCurrentArPose()`
4. If `camera-access` is granted, acquire camera texture via `acquireCameraTexture()` (wraps `renderer.xr.getCameraTexture()`) and store with native dimensions for blit capture
5. Trigger image capture / depth sampling if active
6. Render scene

## Examples

```typescript
import {
  isWebXRSupported,
  initAR,
  getCurrentArPose,
  getArWorldGroup,
  applyAlignmentMatrix,
} from './ar/webxr-session';

if (await isWebXRSupported()) {
  await initAR();

  // Add AR content to arWorldGroup
  const arGroup = getArWorldGroup();
  arGroup?.add(myARObject);

  // Read current pose (for recording)
  const pose = getCurrentArPose();

  // Apply alignment from library
  applyAlignmentMatrix(alignmentMat4);
}
```

## Tests

Unit tests in `webxr-session.test.ts` cover:

**`buildSessionOptions()`:**

- Validates session features (local-floor, dom-overlay, depth-sensing)
- Null-safety regression test
- DOM overlay root binding

**`extractPoseFromViewer()`:**

- Extracts position and orientation from valid pose
- Returns null for null/empty poses
- Produces serializable plain objects

**`isXRCameraLike()`:**

- Accepts finite positive camera dimensions
- Rejects zero, negative, `NaN`, and infinite dimensions before capture sizing

**`createSceneHierarchy()`:**

- Scene contains arWorldGroup as direct child
- Camera is parented under arWorldGroup
- Correct hierarchy depth (scene → arWorldGroup → camera)
- arWorldGroup starts with identity transform
- Lighting is in scene, not arWorldGroup

**`setScene()` / `setArWorldGroup()` / `setCamera()` (replay mode setters):**

- `setScene(mockScene)` → `getScene()` returns it
- `setArWorldGroup(mockGroup)` → `getArWorldGroup()` returns it
- `setCamera(mockCamera)` → `getCamera()` returns it
- `resetWebXRState()` clears setter-provided values
- `setScene(null)` clears the scene explicitly

**DOM hardcoding audit regressions (P1/P2):**

- P1: source code grep confirms no hardcoded `ar-canvas` ID on the renderer canvas
- P2: `resetWebXRState()` stops animation loop, removes canvas, disposes renderer
- P2: `endARSession()` performs full cleanup (stops loop, ends session, disposes CSS3D, removes canvas, disposes renderer)
- P2: `endARSession()` is safe to call when no AR session is active

Full integration testing requires an Android device with WebXR support.

**Tracking callbacks:**

- `setTrackingCallbacks()` registers without throwing
- `setTrackingRecoveredCallback()` registers without throwing
- `resetWebXRState()` clears the recovered callback
