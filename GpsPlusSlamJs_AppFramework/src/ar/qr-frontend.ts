/**
 * QR detection front-ends — Phase 2 of the QR-code detection & tracking plan
 * (§3). The *detect + decode* hot path is abstracted behind {@link QrFrontEnd}
 * with two implementations:
 *
 * - {@link BarcodeDetectorFrontEnd} — preferred. Wraps the native Android-Chrome
 *   `BarcodeDetector` (GPU/SIMD-backed, zero WASM), returning the decoded URL +
 *   4 corner pixels in one call.
 * - {@link OpenCvQrFrontEnd} — fallback for browsers without `BarcodeDetector`.
 *   Wraps OpenCV's `QRCodeDetector`, with `cv.Mat` lifetime discipline.
 *
 * Both emit corners in **pixel** coordinates (top-left origin); corner-order
 * normalization / winding validation lives downstream in `qr-pose.ts`
 * (`validateQuad`), so the pose path is front-end-agnostic. Neither corner order
 * is contractually TL,TR,BR,BL — validate regardless of front-end.
 *
 * External dependencies (the native detector, the OpenCV detector) are INJECTED
 * so this module and its tests need neither a DOM nor opencv.js WASM.
 */

import type { Point2 } from './qr-pose.js';

/** Raw RGBA pixels of the frame fed to detection (top-left origin). */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** One decoded QR: its 4 corner pixels and the decoded text (the level URL). */
export interface QrDetection {
  corners: [Point2, Point2, Point2, Point2];
  text: string;
}

/** Front-agnostic detect+decode contract. */
export interface QrFrontEnd {
  readonly kind: 'barcode-detector' | 'opencv';
  /** Detect the first QR in the frame, or `null` if none. */
  detect(image: RgbaImage): Promise<QrDetection | null>;
  /** Free any native/WASM resources. */
  dispose?(): void;
}

// --- Native BarcodeDetector ------------------------------------------------

/** The native-`BarcodeDetector` result shape we consume. */
export interface DetectedBarcodeLike {
  rawValue: string;
  cornerPoints: ReadonlyArray<{ x: number; y: number }>;
  format?: string;
}

/** The slice of `BarcodeDetector` we depend on. */
export interface BarcodeDetectorLike {
  detect(image: unknown): Promise<DetectedBarcodeLike[]>;
}

/**
 * Convert our `RgbaImage` into something `BarcodeDetector.detect` accepts
 * (`ImageData` is a valid `ImageBitmapSource`). Injected so tests need no DOM.
 */
export type ToImageBitmapSource = (image: RgbaImage) => unknown;

const defaultToImageData: ToImageBitmapSource = (image) =>
  new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);

export class BarcodeDetectorFrontEnd implements QrFrontEnd {
  readonly kind = 'barcode-detector';
  private readonly detector: BarcodeDetectorLike;
  private readonly toSource: ToImageBitmapSource;

  constructor(
    detector: BarcodeDetectorLike,
    toSource: ToImageBitmapSource = defaultToImageData
  ) {
    this.detector = detector;
    this.toSource = toSource;
  }

  async detect(image: RgbaImage): Promise<QrDetection | null> {
    const results = await this.detector.detect(this.toSource(image));
    for (const r of results) {
      const corners = toQuad(r.cornerPoints);
      if (corners && typeof r.rawValue === 'string' && r.rawValue.length > 0) {
        return { corners, text: r.rawValue };
      }
    }
    return null;
  }
}

/**
 * Build a {@link BarcodeDetectorFrontEnd} if the runtime exposes a
 * `BarcodeDetector` constructor; otherwise `null` (→ use the OpenCV fallback).
 * `ctor` is injectable for tests.
 */
export function createBarcodeDetectorFrontEnd(
  ctor?: new (opts: { formats: string[] }) => BarcodeDetectorLike
): BarcodeDetectorFrontEnd | null {
  const Ctor =
    ctor ??
    (
      globalThis as {
        BarcodeDetector?: new (opts: {
          formats: string[];
        }) => BarcodeDetectorLike;
      }
    ).BarcodeDetector;
  if (!Ctor) return null;
  return new BarcodeDetectorFrontEnd(new Ctor({ formats: ['qr_code'] }));
}

// --- OpenCV QRCodeDetector fallback ---------------------------------------

/** Output point Mat from `detectAndDecode` — corners as row-major floats. */
export interface CvPointsMat {
  delete(): void;
  readonly data32F: Float32Array;
}

/** Image Mat built from RGBA pixels. */
export interface CvImageMat {
  delete(): void;
}

/** The slice of OpenCV's QR detector we depend on. */
export interface CvQrDetectorLike {
  /** Build an image Mat from RGBA pixels (e.g. `cv.matFromImageData`). */
  matFromRgba(image: RgbaImage): CvImageMat;
  /** Allocate an empty Mat for the corner output. */
  newPointsMat(): CvPointsMat;
  /** Detect + decode; fills `points` and returns the decoded text (`''` if none). */
  detectAndDecode(image: CvImageMat, points: CvPointsMat): string;
  /** Free the detector itself. */
  delete?(): void;
}

export class OpenCvQrFrontEnd implements QrFrontEnd {
  readonly kind = 'opencv';
  private readonly detector: CvQrDetectorLike;

  constructor(detector: CvQrDetectorLike) {
    this.detector = detector;
  }

  detect(image: RgbaImage): Promise<QrDetection | null> {
    const img = this.detector.matFromRgba(image);
    const points = this.detector.newPointsMat();
    try {
      const text = this.detector.detectAndDecode(img, points);
      if (!text) return Promise.resolve(null);
      const corners = quadFromFloats(points.data32F);
      return Promise.resolve(corners ? { corners, text } : null);
    } finally {
      img.delete();
      points.delete();
    }
  }

  dispose(): void {
    this.detector.delete?.();
  }
}

// --- helpers ---------------------------------------------------------------

function toQuad(
  points: ReadonlyArray<{ x: number; y: number }>
): [Point2, Point2, Point2, Point2] | null {
  if (points.length !== 4) return null;
  const [a, b, c, d] = points;
  if (!a || !b || !c || !d) return null;
  const out: [Point2, Point2, Point2, Point2] = [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
    { x: c.x, y: c.y },
    { x: d.x, y: d.y },
  ];
  if (out.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return null;
  return out;
}

function quadFromFloats(
  data: Float32Array
): [Point2, Point2, Point2, Point2] | null {
  if (data.length < 8) return null;
  const pt = (i: number): Point2 | null => {
    const x = data[i * 2];
    const y = data[i * 2 + 1];
    return x !== undefined &&
      y !== undefined &&
      Number.isFinite(x) &&
      Number.isFinite(y)
      ? { x, y }
      : null;
  };
  const a = pt(0);
  const b = pt(1);
  const c = pt(2);
  const d = pt(3);
  return a && b && c && d ? [a, b, c, d] : null;
}
