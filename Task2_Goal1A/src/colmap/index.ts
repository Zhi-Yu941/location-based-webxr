export type {
  CameraId,
  ColmapCamera,
  ColmapImage,
  ColmapPoint3D,
  ImageId,
  ImageObservation,
  PinholeCamera,
  PinholeIntrinsics,
  Point2DIndex,
  Point3DId,
  Point3DTrackElement,
  QuaternionWxyz,
  RecorderColmapModel,
  Rgb8,
  Vector3,
  WorldToCameraPose,
} from './model.js';

export {
  ColmapError,
  type ColmapFailureContext,
  type ColmapFailureKind,
} from './validate.js';

export {
  exactlyPreserved,
  semanticallyEqual,
  type ModelComparison,
} from './model-comparison.js';

export type {
  DatasetSummary,
  RecorderArchiveSource,
  RecorderDataset,
  RecorderRoundTripResult,
  RoundTripVerification,
} from './round-trip.js';
