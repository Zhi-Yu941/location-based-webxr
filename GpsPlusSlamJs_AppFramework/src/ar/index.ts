/**
 * AR module — WebXR session management, scene hierarchy, image/depth capture.
 */

// --- camera-blit-capture ---
export {
  type CameraBlitCaptureConfig,
  DEFAULT_BLIT_CONFIG,
  computeCaptureSize,
  computeAspectFitSize,
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

// --- depth-grid-lookup ---
export {
  createDepthGridLookup,
  type DepthGridLookup,
} from './depth-grid-lookup.js';

// --- qr-size-from-depth (Note 4 — measure the QR size from the depth map) ---
export {
  type QrSizeStatus,
  type QrSizeEstimate,
  type QrSizeObservation,
  type QrSizeAccumulatorOptions,
  type QrSizeAccumulator,
  estimateQrSizeFromDepth,
  createQrSizeAccumulator,
} from './qr-size-from-depth.js';

// --- qr-size-measurer (Part B — shared depth→size piece) ---
export {
  type QrSizeDepthContext,
  type ImageSize,
  type QrSizeMeasurement,
  type QrSizeMeasurer,
  createQrSizeMeasurer,
} from './qr-size-measurer.js';

// --- qr-size-depth-context (shared DepthSample → QrSizeDepthContext factory) ---
export { createQrSizeDepthContext } from './qr-size-depth-context.js';

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

// --- qr-derived-pose (decision D-A — derive size/pose from RAW on read) ---
export {
  type RawQrObservation,
  type DeriveQrPoseDeps,
  type DerivedQrPlacement,
  type IncrementalQrPlacement,
  deriveQrSizeM,
  solveQrPoseFromObservation,
  deriveSolvedQrPose,
  deriveQrPlacement,
  createIncrementalQrPlacement,
} from './qr-derived-pose.js';

// --- qr-debug-view (shared 3D debug axis+cube consumer, WS-5) ---
export { createQrDebugView, type QrDebugView } from './qr-debug-view.js';

// --- qr-detection-controller (the thin geo-less RAW producer, D-X) ---
export {
  type QrScanStatus,
  type RawObservationSink,
  type QrDetectionControllerDeps,
  type QrDetectionController,
  createQrDetectionController,
} from './qr-detection-controller.js';

// --- qr-pose-aggregation (sliding-window pose stabilization) ---
export {
  DEFAULT_ROTATION_INLIER_ANGLE_DEG,
  type AverageRotationOptions,
  type AverageRotationResult,
  type AggregateQrPoseResult,
  type QrPoseStabilityStatus,
  type QrPoseStabilityOptions,
  type QrPoseStability,
  averageRotation,
  aggregateQrPose,
  evaluateQrPoseStability,
} from './qr-pose-aggregation.js';

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
  type QrDetectionEvent,
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
  BarcodeDetectorFrontEnd,
  createBarcodeDetectorFrontEnd,
} from './qr-frontend.js';

// --- camera-frame-source (B2 — generic throttled RGBA feed for CV) ---
export {
  type CameraFrameSourceConfig,
  type CameraFrameSourceCallbacks,
  CameraFrameSource,
} from './camera-frame-source.js';

// --- planar-pnp (pure-JS IPPE; the OpenCV-free SolvePnpSquare) ---
export {
  type Mat3,
  type Homography,
  type PoseCandidate,
  solveLinear,
  homographyFromCorrespondences,
  nearestRotation3x3,
  ippePoseCandidates,
  rotationToRodrigues,
  PlanarPnpSquare,
} from './planar-pnp.js';

// --- detection-scheduler (generic; QR aliases kept for back-compat) ---
export {
  type DetectionSchedulerConfig,
  type DetectionScheduler,
  type QrDetectionSchedulerConfig,
  type QrDetectionScheduler,
  createDetectionScheduler,
  createQrDetectionScheduler,
} from './detection-scheduler.js';

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

// --- image-quality (pure blur/blackness metrics + drop/retry verdict policy) ---
export {
  type QualityFilterConfig,
  DEFAULT_QUALITY_FILTER,
  DEFAULT_SHARPNESS_HISTORY_SIZE,
  DEFAULT_SHARPNESS_MIN_SAMPLES,
  type QualityRejectReason,
  type QualityVerdict,
  sharpnessScore,
  rgbaToGrayscale,
  meanLuminance,
  ImageQualityGate,
} from './image-quality.js';

// --- image-capture ---
export {
  MIN_VALID_IMAGE_BYTES,
  type ImageCaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  type CapturedImage,
  type CapturedFrame,
  type FrameQualityVerdict,
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
  setImageQualityAnalyzer,
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
  setCameraFrameCallback,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  getCameraFrameCount,
  type CameraFrameCaptureConfig,
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
