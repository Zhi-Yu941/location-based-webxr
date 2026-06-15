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

// --- capability-checker ---
export {
  type CapabilitySupport,
  type CapabilityMessageOptions,
  isFullySupported,
  capabilityMessage,
} from './capability-checker.js';

// --- chromium-camera-access-workaround ---
export {
  type ChromiumProjectionLayerWorkaroundResult,
  type ChromeVersion,
  BASELAYER_WINDOW_MIN,
  BASELAYER_WINDOW_MAX,
  applyChromiumProjectionLayerWorkaround,
  parseChromeVersion,
  needsBaseLayerPersistence,
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
  wrapXRDepthInfo,
} from './depth-sampler.js';

// --- depth-unprojection ---
export {
  unprojectDepthPoint,
  createDepthUnprojector,
  type DepthUnprojector,
} from './depth-unprojection.js';

// --- qr-pose ---
export {
  type Point2,
  type CameraIntrinsics,
  type Pose,
  type OpenCvPnpResult,
  type SolvePnpSquare,
  type SolveQrPoseInput,
  type QrPoseSolution,
  type QuadValidation,
  buildObjectPoints,
  intrinsicsFromProjection,
  projectViewPoint,
  qrInCameraFromOpenCv,
  composePose,
  invertPose,
  transformPoint,
  signedQuadArea,
  validateQuad,
  reprojectionErrorPx,
  solveQrPose,
} from './qr-pose.js';

// --- qr-level ---
export {
  type QrLevel,
  type FetchLike,
  type FetchQrLevelOptions,
  QrLevelValidationError,
  parseQrLevel,
  fetchQrLevel,
} from './qr-level.js';

// --- qr-tracking-controller ---
export {
  type QrTrackingStatus,
  type QrSolvePoseInput,
  type QrTrackingControllerConfig,
  type QrTrackingController,
  createQrTrackingController,
} from './qr-tracking-controller.js';

// --- qr-frontend ---
export {
  type RgbaImage,
  type QrDetection,
  type QrFrontEnd,
  type DetectedBarcodeLike,
  type BarcodeDetectorLike,
  type ToImageBitmapSource,
  type CvPointsMat,
  type CvImageMat,
  type CvQrDetectorLike,
  BarcodeDetectorFrontEnd,
  OpenCvQrFrontEnd,
  createBarcodeDetectorFrontEnd,
} from './qr-frontend.js';

// --- opencv-pnp ---
export { type CvMat, type CvLike, OpenCvPnpSquare } from './opencv-pnp.js';

// --- qr-detection-scheduler ---
export {
  type QrDetectionSchedulerConfig,
  type QrDetectionScheduler,
  createQrDetectionScheduler,
} from './qr-detection-scheduler.js';

// --- qr-gps-vote ---
export {
  METERS_PER_DEG_LAT,
  type QrGeoPose,
  type QrGpsVoteInput,
  type Enu,
  localPlaneToEnu,
  offsetGeo,
  buildQrGpsVotes,
} from './qr-gps-vote.js';

// --- qr-occupancy-check ---
export {
  type OccupancySurface,
  type QrPlausibilityVerdict,
  type QrPlausibility,
  type QrPlausibilityOptions,
  checkQrPlausibility,
} from './qr-occupancy-check.js';

// --- bresenham3d ---
export { bresenham3d, type GridCell } from './bresenham3d.js';

// --- occupancy-grid ---
export { OccupancyGrid, type OccupancyGridOptions } from './occupancy-grid.js';

// --- frame-loop ---
export { type FrameUpdate, registerFrameUpdate } from './frame-loop.js';

// --- xr-frame-loop ---
export {
  type XrFrameContext,
  type XrFrameUpdate,
  registerXrFrameUpdate,
} from './xr-frame-loop.js';

// --- enable-gps-ar ---
export {
  type EnableGpsArStatus,
  type EnableGpsArState,
  type EnableGpsArConfig,
  type EnableGpsArResult,
  type EnableGpsArDeps,
  type EnableGpsArController,
  createEnableGpsArController,
} from './enable-gps-ar.js';

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
  getScene,
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  type SessionFeatureOptions,
} from './webxr-session.js';

// --- webxr-nue-basis ---
export { WEBXR_TO_NUE } from './webxr-nue-basis.js';

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
