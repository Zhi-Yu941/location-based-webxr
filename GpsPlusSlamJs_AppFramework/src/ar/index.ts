/**
 * AR module — WebXR session management, scene hierarchy, image/depth capture.
 */

// --- camera-blit-capture ---
export {
  type CameraBlitCaptureConfig,
  DEFAULT_BLIT_CONFIG,
  computeCaptureSize,
  CameraBlitCapture,
} from './camera-blit-capture.js';

// --- chromium-camera-access-workaround ---
export {
  type ChromiumProjectionLayerWorkaroundResult,
  applyChromiumProjectionLayerWorkaround,
} from './chromium-camera-access-workaround.js';

// --- capture-failure-tracker ---
export {
  type CaptureFailureTrackerConfig,
  DEFAULT_CAPTURE_TRACKER_CONFIG,
  CAPTURE_FAILURE_WARNING,
  type CaptureFailureTracker,
  createCaptureFailureTracker,
} from './capture-failure-tracker.js';

// --- depth-sampler ---
export {
  type DepthSamplerConfig,
  type DepthSamplerCallbacks,
  type DepthInfo,
  DepthSampler,
} from './depth-sampler.js';

// --- frame-loop ---
export { type FrameUpdate, registerFrameUpdate } from './frame-loop.js';

// --- image-capture ---
export {
  MIN_VALID_IMAGE_BYTES,
  type ImageCaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  type CapturedImage,
  type ImageCaptureCallbacks,
  ImageCaptureManager,
} from './image-capture.js';

// --- replay-scene ---
export {
  type CameraMode,
  type ReplaySceneState,
  initReplayScene,
  disposeReplayScene,
  getReplayState,
  updateOrbitTarget,
  getCameraMode,
  getCameraFollower,
  getAlignmentLerper,
  toggleCameraMode,
} from './replay-scene.js';

// --- scene-node-names ---
export { SCENE_NODE } from './scene-node-names.js';

// --- webxr-session ---
export {
  initAR,
  endARSession,
  setImageCaptureCallback,
  startImageCapture,
  stopImageCapture,
  getImageCaptureFrameCount,
  setTrackingCallbacks,
  setTrackingLostCallback,
  setTrackingStore,
  setDepthCaptureCallback,
  startDepthCapture,
  stopDepthCapture,
  getDepthSampleCount,
  setFrameCallback,
  getLiveCss3dManager,
} from './webxr-session.js';

// --- xr-camera-texture ---
export {
  type CameraTextureResult,
  type XRCameraLike,
  type RendererLike,
  acquireCameraTexture,
} from './xr-camera-texture.js';

// --- xr-error-handler ---
export {
  XR_ERROR_MESSAGES,
  XR_ERROR_MESSAGE_UNKNOWN,
  getXrErrorMessage,
} from './xr-error-handler.js';
