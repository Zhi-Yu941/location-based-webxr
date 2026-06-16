/**
 * QR detection front-ends — Phase 2 of the QR-code detection & tracking plan
 * (§3). The *detect + decode* hot path is abstracted behind {@link QrFrontEnd}.
 *
 * - {@link BarcodeDetectorFrontEnd} — the only implementation. Wraps the native
 *   Android-Chrome `BarcodeDetector` (GPU/SIMD-backed, zero WASM), returning the
 *   decoded URL + 4 corner pixels in one call.
 *
 * The OpenCV `QRCodeDetector` fallback was removed (the framework is now
 * OpenCV-free); the interim posture is **BarcodeDetector-only**. A pure-JS
 * decoder fallback for browsers without `BarcodeDetector` is a separate
 * dependency decision — see the follow-up
 * `GpsPlusSlamJs_Docs/docs/2026-06-17-followup-qr-decoder-fallback.md`.
 *
 * Corners are emitted in **pixel** coordinates (top-left origin); corner-order
 * normalization / winding validation lives downstream in `qr-pose.ts`
 * (`validateQuad`), so the pose path is front-end-agnostic. The corner order is
 * not contractually TL,TR,BR,BL — validate regardless.
 *
 * The native detector is INJECTED so this module and its tests need no DOM.
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
  readonly kind: 'barcode-detector';
  /** Detect the first QR in the frame, or `null` if none. */
  detect(image: RgbaImage): Promise<QrDetection | null>;
  /** Free any native resources. */
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
 * `BarcodeDetector` constructor; otherwise `null` (→ the caller must handle the
 * unsupported-browser case; there is no OpenCV fallback). `ctor` is injectable
 * for tests.
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
