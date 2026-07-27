/**
 * Shared `MapData` builder.
 *
 * Single source of trajectory data for BOTH map renderers:
 * - the live/replay 3D Leaflet overlay (`LeafletMapOverlay`), and
 * - the 2D session-summary map (`createSummaryMap`).
 *
 * Before this builder existed the two maps were fed by separate code paths and
 * visibly diverged (see
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-user-feedback.md,
 * Findings 1–2). `buildMapData` is a PURE function: both consumers call it —
 * the summary once from the final store state, the live/replay path on every
 * relevant store change — and render the same `MapData` through the shared
 * overlay-drawing module.
 *
 * Key contract — **D2**: the fused path is ALWAYS recomputed from the latest
 * alignment matrix via `computeFusedPath` over ALL odometry positions. It is
 * never frozen per-event, so the live fused polyline "snaps" as the alignment
 * matrix improves, exactly matching the summary.
 *
 * SCOPE: this model owns only the genuinely-shared SLAM/GPS trajectory layers
 * (raw GPS + accuracy circles, fused path, alignment snapshots, optional user
 * position). Reference points are a RECORDER concept and are deliberately NOT
 * modelled here — the recorder draws them via its own helper
 * (`ui/draw-ref-point-markers.ts`) so the framework stays ref-point-agnostic
 * and the dependency direction (recorder → framework) is preserved. See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md
 * § Step 5.
 */

import type { LatLong, Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import { computeFusedPath } from '../utils/fused-path';
import { computeUserHeadingDeg } from '../utils/user-heading';
import type { GpsCoord, RawGpsSample } from '../types/geo-types';

// ============================================================================
// Types
// ============================================================================

/** Fully-resolved trajectory data ready to be drawn onto a Leaflet map. */
export interface MapData {
  /**
   * User position for the blue dot, or null when unknown/hidden. Unless the
   * caller provided an explicit value, this is the latest FUSED pose
   * (GPS-converted tip of `fusedPath`), so the dot keeps moving indoors where
   * the raw fix freezes; the last raw GPS fix is only the pre-alignment
   * fallback. See
   * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-06-1526-recorder-live-map-user-dot-fused-pose-user-feedback.md.
   */
  userPosition: GpsCoord | null;
  /** Raw GPS samples (yellow polyline + per-event accuracy circles). */
  rawGpsPath: RawGpsSample[];
  /** Fused SLAM+GPS positions (cyan polyline), recomputed from latest matrix. */
  fusedPath: GpsCoord[];
  /** Alignment-snapshot GPS positions (red). */
  alignmentSnapshots: GpsCoord[];
  /**
   * Absolute view-direction bearing (degrees clockwise from true geographic
   * north, `[0, 360)`) for the user-position heading line, or null when
   * undefined (no rotation/alignment yet, or camera near-vertical). See
   * Finding 2 of
   * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md.
   *
   * Optional only so pre-existing direct `MapData` literals (e.g. the static
   * summary map, which is out of scope and draws no heading line) keep
   * compiling. `buildMapData` ALWAYS sets it (to a bearing or null); a missing
   * value is treated by `drawMapData` exactly like null (no line).
   */
  userHeadingDeg?: number | null;
}

/**
 * Inputs to {@link buildMapData}, all optional so callers can supply only the
 * slices they have. Array inputs are read-only and defensively copied.
 */
export interface MapDataInput {
  /** Raw GPS samples in chronological order. */
  rawGpsPath?: readonly RawGpsSample[];
  /** Odometry positions (AR-local) used to derive the fused path. */
  odometryPositions?: ReadonlyArray<Vector3>;
  /**
   * Odometry rotations (NUE quaternions, as stored in
   * `gpsEvents.odometryRotations`). The LATEST entry drives the user heading
   * line; earlier entries are ignored here. Pass the `selectOdometryRotations`
   * value directly.
   */
  odometryRotations?: ReadonlyArray<Quaternion>;
  /** Latest alignment matrix from the solver (null until first solve). */
  alignmentMatrix?: Matrix4 | null;
  /** GPS origin for ENU→GPS conversion (null when no GPS yet). */
  zeroRef?: LatLong | null;
  /** Alignment-snapshot GPS positions. */
  alignmentSnapshots?: readonly GpsCoord[];
  /**
   * Explicit user position — including `null` to hide the dot (summary map).
   * When omitted, defaults to the last `fusedPath` point when the fused path
   * is non-empty, else the last `rawGpsPath` entry, else null (2026-07-06
   * fused-dot feedback).
   */
  userPosition?: GpsCoord | null;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Build a {@link MapData} snapshot from store-derived inputs.
 *
 * Pure and free of Leaflet/Three dependencies. The fused path is always
 * derived via {@link computeFusedPath} (D2); when the matrix or zero reference
 * is missing it is an empty array.
 *
 * @param input - Optional trajectory slices (see {@link MapDataInput}).
 * @returns A fully-resolved {@link MapData} with all arrays defensively copied.
 */
export function buildMapData(input: MapDataInput): MapData {
  const rawGpsPath = input.rawGpsPath ? [...input.rawGpsPath] : [];
  const alignmentSnapshots = input.alignmentSnapshots
    ? [...input.alignmentSnapshots]
    : [];

  const fusedPath = computeFusedPath({
    odometryPositions: input.odometryPositions ?? [],
    alignmentMatrix: input.alignmentMatrix ?? null,
    zeroRef: input.zeroRef ?? null,
  });

  // Default userPosition chain (2026-07-06 fused-dot feedback): the blue dot
  // sits on the tip of the fused polyline whenever an alignment exists —
  // reuse the just-computed fusedPath, no second odometry→GPS conversion.
  // Raw GPS is only the pre-alignment fallback (dot stays visible at startup).
  const lastFused = fusedPath[fusedPath.length - 1];
  const lastRaw = rawGpsPath[rawGpsPath.length - 1];
  const userPosition =
    input.userPosition !== undefined
      ? input.userPosition
      : lastFused
        ? { lat: lastFused.lat, lng: lastFused.lng }
        : lastRaw
          ? { lat: lastRaw.lat, lng: lastRaw.lng }
          : null;

  const rotations = input.odometryRotations ?? [];
  const latestRotation = rotations[rotations.length - 1] ?? null;
  const userHeadingDeg = computeUserHeadingDeg({
    odometryRotation: latestRotation,
    alignmentMatrix: input.alignmentMatrix ?? null,
  });

  return {
    userPosition,
    rawGpsPath,
    fusedPath,
    alignmentSnapshots,
    userHeadingDeg,
  };
}
