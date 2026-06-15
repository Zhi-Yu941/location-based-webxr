/**
 * `qrDetected` slice — unit tests.
 *
 * Why this test matters: this slice is the decoupling seam between detection
 * and the rest of the app (overlays/triggers/anchors subscribe here, not to the
 * fusion). The tests pin the locked-decision invariants: payload-keyed markers,
 * a per-marker BOUNDED ring buffer (no leak), the explicit prune path, the size
 * lifecycle, and that storing `Pose` (readonly tuples) survives the reducer.
 */

import { describe, it, expect } from 'vitest';
import {
  qrDetectedReducer,
  recordQrDetection,
  recordQrSizeEstimate,
  pruneQrDetections,
  clearQrMarker,
  clearAllQrMarkers,
  setQrMaxHistory,
  selectLatestQrDetection,
  selectQrMarker,
  selectQrSize,
  medianQrPosition,
  DEFAULT_QR_MAX_HISTORY,
  type QrDetectedState,
  type QrDetectionEntry,
} from './qr-detected-slice';

function entry(
  text: string,
  t: number,
  pos: [number, number, number] = [0, 0, 0]
): QrDetectionEntry {
  return {
    text,
    qrPoseWorld: { position: pos, rotation: [0, 0, 0, 1] },
    qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
    reprojectionErrorPx: 1.2,
    timestamp: t,
  };
}

function init(): QrDetectedState {
  return qrDetectedReducer(undefined, { type: '@@INIT' });
}

describe('qrDetectedReducer', () => {
  it('starts empty with the default ring cap', () => {
    const s = init();
    expect(s.markers).toEqual({});
    expect(s.maxHistory).toBe(DEFAULT_QR_MAX_HISTORY);
  });

  it('creates a marker on first detection and appends newest-last', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 2)));
    const marker = selectQrMarker({ qrDetected: s }, 'A');
    expect(marker?.detections.map((d) => d.timestamp)).toEqual([1, 2]);
    expect(selectLatestQrDetection({ qrDetected: s }, 'A')?.timestamp).toBe(2);
  });

  it('keys markers by payload — distinct payloads do not merge', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, recordQrDetection(entry('B', 1)));
    expect(Object.keys(s.markers).sort()).toEqual(['A', 'B']);
  });

  it('preserves the readonly Pose tuples through the reducer (no draft crash)', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1, [3, 4, 5])));
    expect(
      selectLatestQrDetection({ qrDetected: s }, 'A')?.qrPoseWorld.position
    ).toEqual([3, 4, 5]);
  });

  it('bounds each marker to maxHistory (ring buffer, drops oldest)', () => {
    let s = init();
    s = qrDetectedReducer(s, setQrMaxHistory(3));
    for (let t = 1; t <= 6; t++) {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', t)));
    }
    const ts = selectQrMarker({ qrDetected: s }, 'A')?.detections.map(
      (d) => d.timestamp
    );
    expect(ts).toEqual([4, 5, 6]);
  });

  it('re-trims existing markers when the cap shrinks', () => {
    let s = init();
    for (let t = 1; t <= 5; t++) {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', t)));
    }
    s = qrDetectedReducer(s, setQrMaxHistory(2));
    const ts = selectQrMarker({ qrDetected: s }, 'A')?.detections.map(
      (d) => d.timestamp
    );
    expect(ts).toEqual([4, 5]);
    expect(s.maxHistory).toBe(2);
  });

  it('prunes the oldest N on demand', () => {
    let s = init();
    for (let t = 1; t <= 4; t++) {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', t)));
    }
    s = qrDetectedReducer(s, pruneQrDetections({ text: 'A', count: 2 }));
    const ts = selectQrMarker({ qrDetected: s }, 'A')?.detections.map(
      (d) => d.timestamp
    );
    expect(ts).toEqual([3, 4]);
  });

  it('prune is a no-op for unknown markers / non-positive counts', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    const before = s;
    s = qrDetectedReducer(s, pruneQrDetections({ text: 'missing', count: 1 }));
    s = qrDetectedReducer(s, pruneQrDetections({ text: 'A', count: 0 }));
    expect(s).toEqual(before);
  });

  it('size lifecycle: defaults to unknown, then updates', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    expect(selectQrSize({ qrDetected: s }, 'A')).toEqual({
      status: 'unknown',
      estimateM: null,
      sampleCount: 0,
      spreadM: 0,
    });
    s = qrDetectedReducer(
      s,
      recordQrSizeEstimate({
        text: 'A',
        estimate: {
          status: 'estimated',
          estimateM: 0.2,
          sampleCount: 12,
          spreadM: 0.004,
        },
      })
    );
    expect(selectQrSize({ qrDetected: s }, 'A')?.status).toBe('estimated');
    // The detection history is preserved across a size update.
    expect(selectQrMarker({ qrDetected: s }, 'A')?.detections).toHaveLength(1);
  });

  it('size can be authored before any detection exists', () => {
    let s = init();
    s = qrDetectedReducer(
      s,
      recordQrSizeEstimate({
        text: 'A',
        estimate: {
          status: 'estimated',
          estimateM: 0.15,
          sampleCount: 1,
          spreadM: 0,
        },
      })
    );
    expect(selectQrMarker({ qrDetected: s }, 'A')?.detections).toEqual([]);
    expect(selectQrSize({ qrDetected: s }, 'A')?.estimateM).toBe(0.15);
  });

  it('clears one marker / all markers', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, recordQrDetection(entry('B', 1)));
    s = qrDetectedReducer(s, clearQrMarker({ text: 'A' }));
    expect(Object.keys(s.markers)).toEqual(['B']);
    s = qrDetectedReducer(s, clearAllQrMarkers());
    expect(s.markers).toEqual({});
  });
});

describe('medianQrPosition', () => {
  it('returns null for an empty window', () => {
    expect(medianQrPosition([])).toBeNull();
  });

  it('is robust to a minority of outliers', () => {
    const entries = [
      entry('A', 1, [1, 1, 1]),
      entry('A', 2, [1, 1, 1]),
      entry('A', 3, [1, 1, 1]),
      entry('A', 4, [1000, 1000, 1000]),
    ];
    expect(medianQrPosition(entries)).toEqual([1, 1, 1]);
  });
});
