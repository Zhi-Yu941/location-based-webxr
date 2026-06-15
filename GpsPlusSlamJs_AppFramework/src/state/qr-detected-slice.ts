/**
 * `qrDetected` Redux slice — Note 3 of the QR-tracking follow-up plan
 * (docs `2026-06-15-followup-qr-tracking-generalization-overlay-and-north.md`).
 *
 * A detection-agnostic, framework-level store of "what was detected, where, in
 * 3D" that overlay / trigger / anchor consumers subscribe to INDEPENDENTLY of
 * the GPS fusion. The QR-tracking controller dispatches into it on every lock
 * (alongside, or instead of, the synthetic GPS vote — the vote is optional, the
 * `qrDetected` emission is not). Both the QR-tracking demo and the Recorder
 * consume the SAME slice — it is not duplicated per app and does NOT live in the
 * closed-source fusion core (locked maintainer decision, 2026-06-15 interview).
 *
 * Shape (locked decision): a dictionary keyed by the decoded payload (text/URL),
 * value = a per-marker BOUNDED RING BUFFER of detections + a size-lifecycle
 * estimate. Identity is the payload itself (already unique, human-debuggable) —
 * two physically-distinct markers sharing a payload merge by design, and a
 * *moving* marker with one payload accumulates a motion path (also desired).
 * The ring buffer is bounded by {@link QrDetectedState.maxHistory} so a naive
 * consumer cannot leak; `pruneQrDetections` is the explicit custom-cleanup path.
 *
 * Detection-agnostic on purpose (Note 1): the same shape (world pose + label +
 * confidence + timestamp) generalizes to future object detection (YOLO etc.),
 * so the fields are deliberately not QR-specific beyond the payload key.
 *
 * This slice is OPT-IN: apps wire it via `createSlamAppStore({ extraReducers:
 * { qrDetected: qrDetectedReducer } })`. It is not a built-in of the store
 * factory, so framework consumers that never detect anything pay nothing.
 *
 * @see ../ar/qr-tracking-controller.ts — the producer (dispatches `recordQrDetection`).
 * @see ../ar/qr-pose.ts — `Pose` / `QrPoseSolution` (the per-detection geometry).
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Vector3 } from 'gps-plus-slam-js';
import type { Pose } from '../ar/qr-pose.js';
import type { QrSizeEstimate } from '../ar/qr-size-from-depth.js';

// Re-exported so consumers of the slice keep importing the size lifecycle types
// from one place. They are DEFINED in `ar/qr-size-from-depth.ts` (where size is
// measured) so this slice can use them without `ar` ever importing `state`.
export type { QrSizeStatus, QrSizeEstimate } from '../ar/qr-size-from-depth.js';

/**
 * Default ring-buffer cap per marker. Bounded so an overlay that never prunes
 * still cannot leak; large enough to support a robust median over a sliding
 * window and a short motion path. Override via {@link setQrMaxHistory}.
 */
export const DEFAULT_QR_MAX_HISTORY = 32;

/**
 * One detection observation. Detection-agnostic by design (Note 1): `text` is
 * the label/payload, `reprojectionErrorPx` the confidence proxy, the two poses
 * the 3D placement. `timestamp` is epoch ms.
 */
export interface QrDetectionEntry {
  /** Decoded payload (text/URL) — also the marker key. */
  text: string;
  /** QR pose in raw-WebXR/odom space (rides `arWorldGroup`). */
  qrPoseWorld: Pose;
  /** QR pose relative to the WebXR camera (pre-composition). */
  qrPoseInCamera: Pose;
  /** RMS reprojection error in pixels (lower = better fit). */
  reprojectionErrorPx: number;
  /** Epoch ms when the detection locked. */
  timestamp: number;
}

/** Per-marker state: a bounded detection history + the size lifecycle. */
export interface QrMarkerState {
  text: string;
  /** Bounded ring buffer, OLDEST first / NEWEST last. */
  detections: QrDetectionEntry[];
  size: QrSizeEstimate;
}

export interface QrDetectedState {
  /** Ring-buffer cap applied per marker on `recordQrDetection`. */
  maxHistory: number;
  /** Markers keyed by decoded payload. */
  markers: Record<string, QrMarkerState>;
}

const initialSize = (): QrSizeEstimate => ({
  status: 'unknown',
  estimateM: null,
  sampleCount: 0,
  spreadM: 0,
});

const initialState: QrDetectedState = {
  maxHistory: DEFAULT_QR_MAX_HISTORY,
  markers: {},
};

/** Trim a detection list to at most `cap`, dropping the oldest. */
function capDetections(
  detections: readonly QrDetectionEntry[],
  cap: number
): QrDetectionEntry[] {
  if (cap <= 0) return [];
  return detections.length > cap
    ? detections.slice(detections.length - cap)
    : detections.slice();
}

const qrDetectedSlice = createSlice({
  name: 'qrDetected',
  initialState,
  reducers: {
    /**
     * Append a detection to its marker's ring buffer (creating the marker on
     * first sight), enforcing `maxHistory`. Returns a fresh state object rather
     * than mutating the immer draft: the entry's `Pose` carries readonly
     * `Vector3`/`Quaternion` tuples that immer's `WritableDraft` rejects (same
     * reason `tracking-slice.originReset` returns new state).
     */
    recordQrDetection(state, action: PayloadAction<QrDetectionEntry>) {
      const entry = action.payload;
      const existing = state.markers[entry.text] as QrMarkerState | undefined;
      const detections = capDetections(
        existing ? [...existing.detections, entry] : [entry],
        state.maxHistory
      );
      const marker: QrMarkerState = {
        text: entry.text,
        detections,
        size: existing?.size ?? initialSize(),
      };
      return {
        ...state,
        markers: { ...state.markers, [entry.text]: marker },
      };
    },

    /**
     * Set a marker's size estimate (the Note 3 size lifecycle). Creates the
     * marker with an empty history if it has no detections yet (a size can be
     * authored before any detection).
     */
    recordQrSizeEstimate(
      state,
      action: PayloadAction<{ text: string; estimate: QrSizeEstimate }>
    ) {
      const { text, estimate } = action.payload;
      const existing = state.markers[text] as QrMarkerState | undefined;
      const marker: QrMarkerState = {
        text,
        detections: existing ? existing.detections.slice() : [],
        size: estimate,
      };
      return { ...state, markers: { ...state.markers, [text]: marker } };
    },

    /**
     * Drop the oldest `count` detections from one marker (explicit custom
     * cleanup, beyond the automatic ring-buffer cap). No-op for an unknown
     * marker or `count <= 0`.
     */
    pruneQrDetections(
      state,
      action: PayloadAction<{ text: string; count: number }>
    ) {
      const { text, count } = action.payload;
      const existing = state.markers[text] as QrMarkerState | undefined;
      if (!existing || count <= 0) return state;
      const marker: QrMarkerState = {
        ...existing,
        detections: existing.detections.slice(count),
      };
      return { ...state, markers: { ...state.markers, [text]: marker } };
    },

    /** Remove one marker entirely. */
    clearQrMarker(state, action: PayloadAction<{ text: string }>) {
      const { [action.payload.text]: _removed, ...rest } = state.markers;
      return { ...state, markers: rest };
    },

    /** Remove every marker (e.g. on session reset). */
    clearAllQrMarkers(state) {
      return { ...state, markers: {} };
    },

    /**
     * Change the ring-buffer cap. Existing markers are re-trimmed immediately
     * so the invariant "no marker exceeds `maxHistory`" holds at all times.
     */
    setQrMaxHistory(state, action: PayloadAction<number>) {
      const next = Math.max(0, Math.floor(action.payload));
      const markers: Record<string, QrMarkerState> = {};
      for (const [key, marker] of Object.entries(state.markers)) {
        markers[key] = {
          ...marker,
          detections: capDetections(marker.detections, next),
        };
      }
      return { ...state, maxHistory: next, markers };
    },
  },
});

export const {
  recordQrDetection,
  recordQrSizeEstimate,
  pruneQrDetections,
  clearQrMarker,
  clearAllQrMarkers,
  setQrMaxHistory,
} = qrDetectedSlice.actions;

export const qrDetectedReducer = qrDetectedSlice.reducer;

// --- Selectors ---------------------------------------------------------

/** Minimal root shape the selectors need (avoids a store import cycle). */
export interface RootWithQrDetected {
  qrDetected: QrDetectedState;
}

export function selectQrMarkers(
  state: RootWithQrDetected
): Record<string, QrMarkerState> {
  return state.qrDetected.markers;
}

export function selectQrMarker(
  state: RootWithQrDetected,
  text: string
): QrMarkerState | undefined {
  return state.qrDetected.markers[text];
}

/**
 * The newest detection for a marker (the natural overlay-persistence source —
 * an overlay reads this and keeps the last pose across detection misses rather
 * than unmounting/flickering).
 */
export function selectLatestQrDetection(
  state: RootWithQrDetected,
  text: string
): QrDetectionEntry | undefined {
  const marker = state.qrDetected.markers[text];
  if (!marker || marker.detections.length === 0) return undefined;
  return marker.detections[marker.detections.length - 1];
}

export function selectQrSize(
  state: RootWithQrDetected,
  text: string
): QrSizeEstimate | undefined {
  return state.qrDetected.markers[text]?.size;
}

// --- Derived helpers ---------------------------------------------------

/** Per-axis median of a numeric list (returns the lower-middle for even n). */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted[mid] as number;
}

/**
 * Robust per-axis median of the world positions across a marker's detection
 * window — the "running estimate" the bounded buffer enables (Note 3). Outliers
 * in fewer than half the samples cannot move the result outside the inlier
 * range. Returns `null` for an empty window.
 */
export function medianQrPosition(
  entries: readonly QrDetectionEntry[]
): Vector3 | null {
  if (entries.length === 0) return null;
  const xs = entries.map((e) => e.qrPoseWorld.position[0]);
  const ys = entries.map((e) => e.qrPoseWorld.position[1]);
  const zs = entries.map((e) => e.qrPoseWorld.position[2]);
  return [medianOf(xs), medianOf(ys), medianOf(zs)];
}
