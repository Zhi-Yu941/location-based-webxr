import type {
  ColmapImage,
  PinholeCamera,
  RecorderColmapModel,
} from './model.js';

/** Opaque archive state. Only readRecorderZip will create values of this type. */
declare const recorderArchiveSourceBrand: unique symbol;

export interface RecorderArchiveSource {
  readonly [recorderArchiveSourceBrand]: true;
}

export interface RecorderDataset {
  readonly model: RecorderColmapModel;
  /** Passed unchanged to writeRecorderZip so opaque entries survive. */
  readonly sourceArchive: RecorderArchiveSource;
}

export interface DatasetSummary {
  readonly imageCount: number;
  readonly point3DCount: number;
  readonly camera: PinholeCamera;
  readonly image1: ColmapImage;
  readonly referencedImageCount: number;
}

export interface RoundTripVerification {
  readonly semanticModel: true;
  readonly exactNoOpModel: true;
  readonly untouchedEntries: true;
  readonly replacementPaths: readonly [
    'sparse/0/cameras.txt',
    'sparse/0/images.txt',
    'sparse/0/points3D.txt',
  ];
}

export interface RecorderRoundTripResult {
  readonly dataset: RecorderDataset;
  readonly summary: DatasetSummary;
  readonly outputZipBytes: Uint8Array;
  readonly verification: RoundTripVerification;
}
