/** Shared contextual failure contract for the COLMAP boundary. */
import type { RecorderColmapModel } from './model.js';

export type ColmapFailureKind =
  | 'archive'
  | 'unsupported-profile'
  | 'syntax'
  | 'validation'
  | 'reference';

export interface ColmapFailureContext {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;
}

/**
 * The one public error class used by expected 1A input and archive failures.
 */
export class ColmapError extends Error {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;

  constructor(
    message: string,
    context: ColmapFailureContext,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ColmapError';
    this.kind = context.kind;
    this.path = context.path;
    this.line = context.line;
    this.field = context.field;
  }
}

export function validateRecorderColmapModel(model: RecorderColmapModel): void {
  if (model.cameras.length !== 1) {
    fail('validation', 'cameras', 'Exactly one camera is required');
  }

  const camera = model.cameras[0]!;
  requirePositiveSafeInteger(camera.cameraId, 'cameras[0].cameraId');
  if (camera.model !== 'PINHOLE') {
    fail(
      'unsupported-profile',
      'cameras[0].model',
      'Only PINHOLE camera model is supported'
    );
  }
  requirePositiveSafeInteger(camera.width, 'cameras[0].width');
  requirePositiveSafeInteger(camera.height, 'cameras[0].height');
  requirePositiveFiniteNumber(camera.intrinsics.fx, 'cameras[0].intrinsics.fx');
  requirePositiveFiniteNumber(camera.intrinsics.fy, 'cameras[0].intrinsics.fy');
  if (!Number.isFinite(camera.intrinsics.cx)) {
    fail('validation', 'cameras[0].intrinsics.cx', 'cx must be finite');
  }
  if (!Number.isFinite(camera.intrinsics.cy)) {
    fail('validation', 'cameras[0].intrinsics.cy', 'cy must be finite');
  }

  const imageIds = new Set<number>();
  const imageNames = new Set<string>();
  if (model.images.length === 0) {
    fail('validation', 'images', 'At least one image is required');
  }

  for (const image of model.images) {
    requirePositiveSafeInteger(image.imageId, 'imageId');
    if (imageIds.has(image.imageId)) {
      fail('validation', 'imageId', 'Duplicate image ID');
    }
    if (imageNames.has(image.name)) {
      fail('validation', 'name', 'Duplicate image name');
    }
    imageIds.add(image.imageId);
    imageNames.add(image.name);

    if (image.cameraId !== camera.cameraId) {
      fail('reference', 'cameraId', 'Referenced camera does not exist');
    }

    if (
      image.name.length === 0 ||
      image.name === '.' ||
      image.name === '..' ||
      [...image.name].some(
        (character) =>
          character <= ' ' ||
          character === '\x7f' ||
          `/\\'"`.includes(character)
      )
    ) {
      fail('validation', 'name', 'Image name is invalid');
    }

    const qvec = image.pose.qvec;
    requireFiniteArray(qvec, 'pose.qvec');
    if (qvec.length !== 4) {
      fail('validation', 'pose.qvec', 'Quaternion must have length 4');
    }
    const norm = Math.hypot(...qvec);
    if (Math.abs(norm - 1) > 1e-6) {
      fail('validation', 'pose.qvec', 'Quaternion must have unit length');
    }

    const tvec = image.pose.tvec;
    requireFiniteArray(tvec, 'pose.tvec');
    if (tvec.length !== 3) {
      fail('validation', 'pose.tvec', 'Translation vector must have length 3');
    }

    if (image.observations.length !== 0) {
      fail(
        'unsupported-profile',
        'observations',
        'Image observations are not supported'
      );
    }
  }

  const point3DIds = new Set<number>();
  for (const point3D of model.points3D) {
    requirePositiveSafeInteger(point3D.point3DId, 'point3DId');
    if (point3DIds.has(point3D.point3DId)) {
      fail('validation', 'point3DId', 'Duplicate point3D ID');
    }
    point3DIds.add(point3D.point3DId);

    requireFiniteArray(point3D.xyz, 'xyz');
    if (point3D.xyz.length !== 3) {
      fail('validation', 'xyz', 'Point3D coordinates must have length 3');
    }
    requireFiniteArray(point3D.rgb, 'rgb');
    if (point3D.rgb.length !== 3) {
      fail('validation', 'rgb', 'Point3D RGB values must have length 3');
    }
    if (
      point3D.rgb.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255
      )
    ) {
      fail(
        'validation',
        'rgb',
        'Point3D RGB values must be integers in the range [0, 255]'
      );
    }
    if (!Number.isFinite(point3D.error) || point3D.error < 0) {
      fail(
        'validation',
        'error',
        'Point3D error must be a non-negative finite number'
      );
    }
    if (point3D.track.length !== 0) {
      fail('unsupported-profile', 'track', 'Point3D tracks are not supported');
    }
  }
}

function fail(kind: ColmapFailureKind, field: string, message: string): never {
  throw new ColmapError(message, { kind, field });
}

function requirePositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('validation', field, `${field} must be a positive safe integer`);
  }
}

function requirePositiveFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    fail('validation', field, `${field} must be a positive finite number`);
  }
}

function requireFiniteArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || !value.every(Number.isFinite)) {
    fail('validation', field, `${field} must be a finite list of numbers`);
  }
}
