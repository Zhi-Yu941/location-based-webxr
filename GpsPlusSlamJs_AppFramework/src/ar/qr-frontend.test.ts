/**
 * QR detection front-ends — unit tests.
 *
 * Why this test matters: both front-ends must emit a uniform {@link QrDetection}
 * (4 finite corner pixels + non-empty text) regardless of their very different
 * native APIs, reject malformed detector output, and — for the OpenCV path —
 * free every `cv.Mat` on both the hit and miss paths. Dependencies are injected
 * so no DOM/WASM is needed.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BarcodeDetectorFrontEnd,
  OpenCvQrFrontEnd,
  createBarcodeDetectorFrontEnd,
  type RgbaImage,
  type DetectedBarcodeLike,
  type CvQrDetectorLike,
  type CvImageMat,
  type CvPointsMat,
} from './qr-frontend';

const image: RgbaImage = {
  data: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

const fourCorners = [
  { x: 10, y: 10 },
  { x: 90, y: 12 },
  { x: 88, y: 92 },
  { x: 11, y: 90 },
];

describe('BarcodeDetectorFrontEnd', () => {
  const passthrough = (img: RgbaImage) => img; // avoid needing DOM ImageData

  it('returns the first decoded QR with its 4 corners and text', async () => {
    const detector = {
      detect: vi.fn(
        (): Promise<DetectedBarcodeLike[]> =>
          Promise.resolve([
            {
              rawValue: 'https://lvl/1',
              cornerPoints: fourCorners,
              format: 'qr_code',
            },
          ])
      ),
    };
    const fe = new BarcodeDetectorFrontEnd(detector, passthrough);
    const det = await fe.detect(image);
    expect(det).not.toBeNull();
    expect(det!.text).toBe('https://lvl/1');
    expect(det!.corners).toHaveLength(4);
    expect(det!.corners[1]).toEqual({ x: 90, y: 12 });
    expect(detector.detect).toHaveBeenCalledWith(image);
  });

  it('returns null when nothing is detected', async () => {
    const fe = new BarcodeDetectorFrontEnd(
      { detect: () => Promise.resolve([]) },
      passthrough
    );
    expect(await fe.detect(image)).toBeNull();
  });

  it('skips results with the wrong corner count or empty text', async () => {
    const fe = new BarcodeDetectorFrontEnd(
      {
        detect: () =>
          Promise.resolve([
            { rawValue: '', cornerPoints: fourCorners },
            { rawValue: 'x', cornerPoints: fourCorners.slice(0, 3) },
          ]),
      },
      passthrough
    );
    expect(await fe.detect(image)).toBeNull();
  });
});

describe('createBarcodeDetectorFrontEnd', () => {
  it('returns null when no BarcodeDetector constructor exists', () => {
    expect(createBarcodeDetectorFrontEnd(undefined)).toBeNull();
  });

  it('constructs a front-end with the qr_code format when a ctor is provided', () => {
    let capturedOpts: { formats: string[] } | undefined;
    class FakeBarcodeDetector {
      constructor(opts: { formats: string[] }) {
        capturedOpts = opts;
      }
      detect() {
        return Promise.resolve([]);
      }
    }
    const fe = createBarcodeDetectorFrontEnd(FakeBarcodeDetector);
    expect(fe).not.toBeNull();
    expect(capturedOpts).toEqual({ formats: ['qr_code'] });
  });
});

describe('OpenCvQrFrontEnd', () => {
  function makeDetector(opts: { text: string; corners?: number[] }) {
    const live = new Set<CvImageMat | CvPointsMat>();
    const detector: CvQrDetectorLike & { liveCount: () => number } = {
      liveCount: () => live.size,
      matFromRgba: () => {
        const m: CvImageMat = { delete: () => live.delete(m) };
        live.add(m);
        return m;
      },
      newPointsMat: () => {
        const m: CvPointsMat = {
          data32F: new Float32Array(
            opts.corners ?? [10, 10, 90, 12, 88, 92, 11, 90]
          ),
          delete: () => live.delete(m),
        };
        live.add(m);
        return m;
      },
      detectAndDecode: () => opts.text,
      delete: vi.fn(),
    };
    return detector;
  }

  it('returns the decoded text and corners, freeing both Mats', async () => {
    const detector = makeDetector({ text: 'https://lvl/2' });
    const fe = new OpenCvQrFrontEnd(detector);
    const det = await fe.detect(image);
    expect(det).not.toBeNull();
    expect(det!.text).toBe('https://lvl/2');
    expect(det!.corners[0]).toEqual({ x: 10, y: 10 });
    expect(detector.liveCount()).toBe(0); // img + points released
  });

  it('returns null and still frees both Mats when nothing decodes', async () => {
    const detector = makeDetector({ text: '' });
    const fe = new OpenCvQrFrontEnd(detector);
    expect(await fe.detect(image)).toBeNull();
    expect(detector.liveCount()).toBe(0);
  });

  it('dispose() frees the detector', () => {
    const detector = makeDetector({ text: '' });
    const fe = new OpenCvQrFrontEnd(detector);
    fe.dispose();
    expect(detector.delete).toHaveBeenCalled();
  });
});
