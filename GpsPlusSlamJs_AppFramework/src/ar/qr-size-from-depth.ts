/**
 * QR size from depth — Note 4 of the QR-tracking follow-up plan
 * (docs `2026-06-15-followup-qr-tracking-generalization-overlay-and-north.md`).
 *
 * MEASURE a QR's printed physical size directly from the depth map, so the
 * QR content + printed size are irrelevant and `qr.physicalSizeM` need not be
 * hand-authored. The 4 corner pixels (and a few interior samples to catch edge
 * depth-bleed) are unprojected to 3D via the existing `createDepthUnprojector`
 * (depth + projection + camera pose → raw-WebXR points); the pairwise side
 * lengths of the unprojected square give a per-observation size estimate WITH
 * metric scale from depth — no `solvePnP` scale assumption needed.
 *
 * Two pieces:
 * - {@link estimateQrSizeFromDepth} — one observation → `{ sizeM, quality }`.
 *   `quality ∈ [0,1]` falls as the 4 sides disagree, the diagonals deviate from
 *   `√2·side`, or the corners/interior points are non-planar (depth noise / not
 *   a planar square facing us). A caller rejects low-quality reads.
 * - {@link createQrSizeAccumulator} — a robust running MEDIAN over accepted
 *   observations, reporting the Note 3 size lifecycle (`unknown → measuring →
 *   estimated`). The median is robust to depth noise; the lifecycle gate
 *   (min sample count + low spread) is what later promotes a measured size to
 *   drive size-dependent features.
 *
 * The size-estimate VALUE types ({@link QrSizeStatus}, {@link QrSizeEstimate})
 * live here (not in the `qrDetected` state slice) so the slice can import them
 * WITHOUT the `ar` layer ever importing `state` — that would close a cycle.
 *
 * @see depth-unprojection.ts — `createDepthUnprojector` (the unprojection it composes).
 * @see ../state/qr-detected-slice.ts — consumes `QrSizeEstimate` (the size lifecycle).
 */

import { vec3 } from 'gl-matrix';
import type { Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../types/ar-types.js';
import type { DepthUnprojector } from './depth-unprojection.js';

/** Where the size lifecycle currently sits for one marker (Note 3 / Note 4). */
export type QrSizeStatus =
  /** No size authored and none measured yet — size-dependent features blocked. */
  | 'unknown'
  /** Measurements are accumulating but the estimate has not converged. */
  | 'measuring'
  /** A reliably-estimated (or authored) size — size-dependent features unlock. */
  | 'estimated';

/** Per-marker physical-size estimate (drives the Note 3 size lifecycle). */
export interface QrSizeEstimate {
  status: QrSizeStatus;
  /** Running median side length, meters, or `null` while unknown. */
  estimateM: number | null;
  /** How many accepted samples back the estimate. */
  sampleCount: number;
  /** Spread (max−min) of the accepted samples, meters — 0 when <2 samples. */
  spreadM: number;
}

/** One per-observation size read from a single detection's depth samples. */
export interface QrSizeObservation {
  /** Median of the 4 unprojected edge lengths, meters. */
  sizeM: number;
  /** Consistency score in [0,1]; 1 = a perfect planar square facing the camera. */
  quality: number;
}

const EPS = 1e-9;

function dist(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Median of a numeric list (mean of the middle two for even n). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Estimate a QR's physical side length from one detection's depth samples.
 *
 * @param corners - the 4 corner depth samples, ordered TL, TR, BR, BL (matching
 *   `buildObjectPoints` / the detector corner-order normalization).
 * @param interiorSamples - a few interior depth samples (may be empty); used
 *   only to strengthen the planarity check against corner edge depth-bleed.
 * @param unprojector - built once per depth sample via `createDepthUnprojector`.
 * @returns `{ sizeM, quality }`, or `null` when a corner cannot be unprojected
 *   or the quad is degenerate (collinear / zero-area).
 */
export function estimateQrSizeFromDepth(
  corners: readonly [DepthPoint, DepthPoint, DepthPoint, DepthPoint],
  interiorSamples: readonly DepthPoint[],
  unprojector: DepthUnprojector
): QrSizeObservation | null {
  const world: Vector3[] = [];
  for (const c of corners) {
    const p = unprojector.unproject(c);
    if (!p) return null;
    world.push(p);
  }
  const [c0, c1, c2, c3] = world as [Vector3, Vector3, Vector3, Vector3];

  // Consecutive edges (TL-TR, TR-BR, BR-BL, BL-TL) and the two diagonals.
  const edges: [number, number, number, number] = [
    dist(c0, c1),
    dist(c1, c2),
    dist(c2, c3),
    dist(c3, c0),
  ];
  const meanEdge = (edges[0] + edges[1] + edges[2] + edges[3]) / 4;
  if (!(meanEdge > EPS)) return null; // degenerate / zero-size

  // Plane through three adjacent corners (c0 as origin, c1 & c3 as in-plane
  // axes). A collinear triple has a zero-length normal → degenerate quad.
  const u = vec3.subtract(
    vec3.create(),
    [c1[0], c1[1], c1[2]],
    [c0[0], c0[1], c0[2]]
  );
  const v = vec3.subtract(
    vec3.create(),
    [c3[0], c3[1], c3[2]],
    [c0[0], c0[1], c0[2]]
  );
  const normal = vec3.cross(vec3.create(), u, v);
  const normalLen = vec3.length(normal);
  if (!(normalLen > EPS)) return null;
  vec3.scale(normal, normal, 1 / normalLen);

  const planeOffset = (p: Vector3): number =>
    Math.abs(
      normal[0] * (p[0] - c0[0]) +
        normal[1] * (p[1] - c0[1]) +
        normal[2] * (p[2] - c0[2])
    );

  // Planarity: c2 (the corner NOT on the defining plane) plus every interior
  // sample should lie on the plane; the largest offset bounds the error.
  let maxPlaneOffset = planeOffset(c2);
  for (const s of interiorSamples) {
    const p = unprojector.unproject(s);
    if (!p) continue; // a single bad interior read shouldn't void the estimate
    maxPlaneOffset = Math.max(maxPlaneOffset, planeOffset(p));
  }

  // Relative-error components, all normalized by the mean edge so `quality` is
  // scale-free: edge agreement, diagonal ≈ √2·edge, and planarity.
  const edgeErr =
    Math.max(...edges.map((e) => Math.abs(e - meanEdge))) / meanEdge;
  const expectedDiag = meanEdge * Math.SQRT2;
  const diagErr =
    Math.max(
      Math.abs(dist(c0, c2) - expectedDiag),
      Math.abs(dist(c1, c3) - expectedDiag)
    ) / expectedDiag;
  const planeErr = maxPlaneOffset / meanEdge;

  const relErr = Math.max(edgeErr, diagErr, planeErr);
  const quality = Math.max(0, Math.min(1, 1 - relErr));

  return { sizeM: median(edges), quality };
}

// --- Running-median accumulator (the Note 3 size lifecycle) ------------

export interface QrSizeAccumulatorOptions {
  /** Minimum observation quality to ACCEPT a sample. Default 0.8. */
  qualityThreshold?: number;
  /** Accepted samples required before the estimate can be `estimated`. Default 8. */
  minSamples?: number;
  /** Max spread (max−min, m) allowed for the `estimated` status. Default 0.01. */
  maxSpreadM?: number;
  /** Ring cap on retained accepted sizes (robust median window). Default 64. */
  maxSamples?: number;
}

export interface QrSizeAccumulator {
  /**
   * Offer one observation (or `null` for a failed read). Low-quality / null
   * observations are ignored. Returns the updated {@link QrSizeEstimate}.
   */
  add(observation: QrSizeObservation | null): QrSizeEstimate;
  /** The current estimate without adding a sample. */
  current(): QrSizeEstimate;
  /** Drop all samples back to `unknown`. */
  reset(): void;
}

const UNKNOWN: QrSizeEstimate = {
  status: 'unknown',
  estimateM: null,
  sampleCount: 0,
  spreadM: 0,
};

export function createQrSizeAccumulator(
  options: QrSizeAccumulatorOptions = {}
): QrSizeAccumulator {
  const {
    qualityThreshold = 0.8,
    minSamples = 8,
    maxSpreadM = 0.01,
    maxSamples = 64,
  } = options;

  let sizes: number[] = [];

  function estimate(): QrSizeEstimate {
    if (sizes.length === 0) return { ...UNKNOWN };
    const med = median(sizes);
    const spreadM = Math.max(...sizes) - Math.min(...sizes);
    const converged = sizes.length >= minSamples && spreadM <= maxSpreadM;
    return {
      status: converged ? 'estimated' : 'measuring',
      estimateM: med,
      sampleCount: sizes.length,
      spreadM,
    };
  }

  return {
    add(observation: QrSizeObservation | null): QrSizeEstimate {
      if (
        observation &&
        Number.isFinite(observation.sizeM) &&
        observation.sizeM > 0 &&
        observation.quality >= qualityThreshold
      ) {
        sizes.push(observation.sizeM);
        if (sizes.length > maxSamples) sizes = sizes.slice(-maxSamples);
      }
      return estimate();
    },
    current: estimate,
    reset(): void {
      sizes = [];
    },
  };
}
