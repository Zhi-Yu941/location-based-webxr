/**
 * `createGpsAnchor` — GPS-anchored placement of a single `THREE.Object3D`.
 *
 * See the colocated sidecar (`gps-anchor.ts.md`) and the port plan at
 * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md`
 * for the full design, state machine, and test matrix.
 *
 * This file implements sub-steps 2 (bootstrap phase), 3 (steady-state
 * `'snap-every-tick'` + distance-scaled threshold gate), and 4
 * (`'snap-when-offscreen'` mode gate + alignment-matrix large-jump
 * bypass). Floor-Y correction is sub-step 6 and remains deferred.
 */
import * as THREE from 'three';
import {
  calcRelativeCoordsInMeters,
  type LatLong,
  type LatLongAlt,
} from '../core/index.js';
import { registerFrameUpdate } from '../ar/frame-loop.js';
import { isObjectInCameraFrustum } from './frustum-visibility.js';
import { nueToArLocal } from './frame-conversions.js';

export type GpsAnchorMode = 'snap-when-offscreen' | 'snap-every-tick';
export type GpsAnchorPhase = 'bootstrap' | 'anchored';

/**
 * The minimum shape needed for the bootstrap median — a `LatLong` with
 * optional altitude. Re-exported as a named alias so the sidecar and
 * tests can refer to "the kind of point the anchor samples" without
 * importing core types.
 */
export type GpsAnchorSamplePoint = LatLong | LatLongAlt;

export interface GpsAnchorOptions {
  readonly object3D: THREE.Object3D;
  readonly arWorldGroup: THREE.Object3D;
  readonly camera: THREE.Camera;
  readonly gpsPoint: LatLong | LatLongAlt;
  readonly skipBootstrap?: boolean;
  readonly getAlignmentMatrix: () => readonly number[] | null;
  readonly getGpsZeroRef: () => LatLong | null;
  /** Returns the current GPS reading at "now", or null when no fix yet. */
  readonly getCurrentGpsPoint: () => GpsAnchorSamplePoint | null;
  /**
   * Optional callback invoked whenever the bootstrap median is committed (the
   * anchor's GPS reference is (re)assigned). Receives the exact committed point
   * — the same value assigned to `gpsPoint`. Fires once after the initial
   * bootstrap and again after every re-bootstrap (`markMovedExternally` →
   * re-accumulate → commit). Never fires when `skipBootstrap` is true (there is
   * no bootstrap to complete). Lets a host persist the committed reference (e.g.
   * AnchorStarter writing `?show=`) so the persisted link equals the committed
   * reference by construction.
   */
  readonly onBootstrapComplete?: (gpsPoint: LatLong | LatLongAlt) => void;
  readonly mode?: GpsAnchorMode;
  readonly floorY?: () => number | null;
  readonly distanceThreshold?: number;
  readonly angleThresholdInDegrees?: number;
  readonly targetPosRefreshRateInSec?: number;
  /** Number of 1 Hz samples collected during bootstrap. Default 7. */
  readonly secondsToAccumulateGpsPose?: number;
  /** Wait window (seconds) at phase entry during which no samples are taken. Default 0. */
  readonly settlingSeconds?: number;
  readonly heightAboveGround?: number | null;
}

export interface GpsAnchor {
  readonly phase: GpsAnchorPhase;
  readonly isFullyAnchored: boolean;
  /** Current target GPS pose; during `bootstrap` this is the seed, post-bootstrap the median. */
  readonly gpsPoint: LatLong | LatLongAlt;
  markMovedExternally(): void;
  setGpsPoint(point: LatLong | LatLongAlt): void;
  dispose(): void;
  /** @internal — testing seam; exposed in lieu of pumping `runFrameUpdates`. */
  __tickForTests(dt: number, elapsed: number): void;
}

/**
 * Module-level registry of objects currently owned by a `GpsAnchor`.
 * Used to detect nested anchors (parent + child both anchored) which
 * we explicitly forbid; mirrors the C# invariant.
 */
const anchoredObjects = new WeakSet<THREE.Object3D>();

function isObjectInAnchoredChain(object: THREE.Object3D): boolean {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (anchoredObjects.has(cursor)) return true;
    cursor = cursor.parent;
  }
  return false;
}

/**
 * Returns true iff `object` is `arWorldGroup` itself or a descendant of it.
 * The anchor's `object3D` MUST satisfy this: only then does it ride the
 * alignment applied to `arWorldGroup.matrix` (the node the camera also lives
 * under) via scene-graph propagation. An anchor parented to the scene root
 * instead never receives the alignment, so each steady-state re-registration
 * snaps the full alignment delta and the object visibly slides as the user
 * moves — the exact instability the anchor exists to prevent.
 */
function isDescendantOf(
  object: THREE.Object3D,
  arWorldGroup: THREE.Object3D
): boolean {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (cursor === arWorldGroup) return true;
    cursor = cursor.parent;
  }
  return false;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function medianPoint(
  samples: readonly GpsAnchorSamplePoint[]
): LatLong | LatLongAlt {
  const lat = median(samples.map((s) => s.lat));
  const lon = median(samples.map((s) => s.lon));
  const alts = samples
    .map((s) => ('altitude' in s ? s.altitude : undefined))
    .filter((a): a is number => typeof a === 'number');
  if (alts.length > 0) {
    return { lat, lon, altitude: median(alts) };
  }
  return { lat, lon };
}

export function createGpsAnchor(options: GpsAnchorOptions): GpsAnchor {
  if (isObjectInAnchoredChain(options.object3D)) {
    throw new Error(
      'createGpsAnchor: nested GpsAnchors are not supported — ' +
        'the supplied object3D is already inside an anchored parent chain.'
    );
  }
  if (!isDescendantOf(options.object3D, options.arWorldGroup)) {
    throw new Error(
      'createGpsAnchor: object3D must be a descendant of arWorldGroup ' +
        '(the alignment-bearing node the camera lives under); parenting an ' +
        'anchor to the scene root defeats AR stability.'
    );
  }
  anchoredObjects.add(options.object3D);

  const sampleCount = options.secondsToAccumulateGpsPose ?? 7;
  if (sampleCount < 1) {
    // A sub-1 sample count would commit the bootstrap median after the
    // first received sample (best case) or never make sense at all;
    // `0` in particular implies "median of zero samples". Fail fast and
    // point the caller at the supported bypass instead of silently
    // degrading the accumulation phase.
    anchoredObjects.delete(options.object3D);
    throw new Error(
      'createGpsAnchor: secondsToAccumulateGpsPose must be >= 1 — ' +
        'use skipBootstrap:true to bypass the accumulation phase.'
    );
  }
  const settlingSeconds = options.settlingSeconds ?? 0;
  const distanceThreshold = options.distanceThreshold ?? 2;
  // Reserved for sub-step 4 (rotation-delta gate). Kept here so the
  // option is honoured the moment that code lands without re-touching
  // the constructor.
  void (options.angleThresholdInDegrees ?? 15);
  const mode: GpsAnchorMode = options.mode ?? 'snap-when-offscreen';

  // Large-jump thresholds (mirror the C# `ApplyAlignmentMatrixToArOrigin`
  // constants). When the alignment matrix changes by more than any of
  // these between two consecutive ticks, the on-screen mode gate is
  // bypassed for that tick.
  const LARGE_JUMP_TRANSLATION_M = 4;
  const LARGE_JUMP_Y_M = 20;
  const LARGE_JUMP_ROTATION_DEG = 2;

  // Scratch vectors / matrices / quaternions — reused across ticks to
  // avoid per-frame allocs.
  const scratchTarget = new THREE.Vector3();
  const scratchCamWorld = new THREE.Vector3();
  const scratchObjWorld = new THREE.Vector3();
  const scratchPrevMatrix = new THREE.Matrix4();
  const scratchCurrMatrix = new THREE.Matrix4();
  const scratchPrevTrans = new THREE.Vector3();
  const scratchCurrTrans = new THREE.Vector3();
  const scratchPrevQuat = new THREE.Quaternion();
  const scratchCurrQuat = new THREE.Quaternion();

  let phase: GpsAnchorPhase =
    options.skipBootstrap === true ? 'anchored' : 'bootstrap';
  let isFullyAnchored = phase === 'anchored';
  let gpsPoint: LatLong | LatLongAlt = options.gpsPoint;
  let phaseEnteredAtElapsed: number | null = null;
  let lastSampleAtElapsed: number | null = null;
  const samples: GpsAnchorSamplePoint[] = [];
  /**
   * Snapshot of the previous tick's alignment matrix. `null` until the
   * first steady-state tick in which `getAlignmentMatrix()` returned a
   * non-null value. Used by the large-jump bypass to compare against
   * the current tick's matrix.
   */
  let prevAlignmentMatrix: readonly number[] | null = null;

  /**
   * Returns true iff the alignment matrix has jumped by more than the
   * configured large-jump thresholds between `prev` and `curr`. A
   * `null` `prev` (first tick) is treated as "no jump".
   */
  const detectLargeAlignmentJump = (
    prev: readonly number[] | null,
    curr: readonly number[] | null
  ): boolean => {
    if (prev === null || curr === null) return false;
    scratchPrevMatrix.fromArray(prev);
    scratchCurrMatrix.fromArray(curr);
    scratchPrevTrans.setFromMatrixPosition(scratchPrevMatrix);
    scratchCurrTrans.setFromMatrixPosition(scratchCurrMatrix);
    const dTrans = scratchPrevTrans.distanceTo(scratchCurrTrans);
    const dY = Math.abs(scratchCurrTrans.y - scratchPrevTrans.y);
    scratchPrevQuat.setFromRotationMatrix(scratchPrevMatrix);
    scratchCurrQuat.setFromRotationMatrix(scratchCurrMatrix);
    const dRotRad = scratchPrevQuat.angleTo(scratchCurrQuat);
    const dRotDeg = (dRotRad * 180) / Math.PI;
    return (
      dTrans > LARGE_JUMP_TRANSLATION_M ||
      dY > LARGE_JUMP_Y_M ||
      dRotDeg > LARGE_JUMP_ROTATION_DEG
    );
  };

  const enterBootstrap = (): void => {
    phase = 'bootstrap';
    isFullyAnchored = false;
    phaseEnteredAtElapsed = null;
    lastSampleAtElapsed = null;
    samples.length = 0;
    // Reset the large-jump baseline so the first steady-state tick
    // after the re-bootstrap doesn't compare against a stale matrix
    // from before the move.
    prevAlignmentMatrix = null;
  };

  const commitMedian = (): void => {
    gpsPoint = medianPoint(samples);
    phase = 'anchored';
    isFullyAnchored = true;
    samples.length = 0;
    // Hand the host the exact committed reference so it can persist it (the
    // persisted value equals the committed `gpsPoint` by construction). Re-fires
    // after every re-bootstrap because this is the only place `gpsPoint` is
    // assigned from a median.
    options.onBootstrapComplete?.(gpsPoint);
  };

  /**
   * Steady-state: compute the GPS-world NUE target from the stored
   * `gpsPoint` and the current `zeroRef`, map it into `arWorldGroup`'s
   * AR-local frame via the inverse alignment matrix, and commit it to
   * `object3D.position` iff the (AR-local) position delta exceeds the
   * distance-scaled threshold AND the mode gate (with optional large-jump
   * bypass) allows it.
   *
   * Frame note: `arWorldGroup.matrix` IS the alignment matrix, which maps
   * **AR-odometry NUE → GPS-world NUE**. `object3D.position` is a *local*
   * transform in that AR-odometry frame. To make the object's *world*
   * position equal the GPS-world `nue`, the local target must be
   * `alignment⁻¹ · nue` — writing raw `nue` would double-apply the
   * alignment (world = `alignment · nue`). See
   * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md`.
   *
   * Returns silently on missing inputs (no `zeroRef`, or no alignment
   * matrix yet — an AR-local object cannot be placed without knowing the
   * AR↔NUE transform).
   */
  const maybeCommitSteadyState = (): void => {
    const zero = options.getGpsZeroRef();
    if (zero === null || zero === undefined) return;
    const currentAlignment = options.getAlignmentMatrix();
    const largeJump = detectLargeAlignmentJump(
      prevAlignmentMatrix,
      currentAlignment
    );
    // Update the snapshot for the next tick BEFORE any early-returns so
    // jump detection on subsequent ticks compares against the most
    // recent matrix the anchor actually saw.
    prevAlignmentMatrix = currentAlignment;

    // Without an alignment matrix we cannot map the GPS-world NUE target
    // into `arWorldGroup`'s AR-local frame. Skip the commit and leave the
    // object at its last local pose until an alignment exists. (Previously
    // this path committed raw NUE, which placed the object in the wrong
    // frame — see the alignment-frame bug doc referenced above.)
    if (currentAlignment === null || currentAlignment === undefined) return;

    const targetAlt =
      'altitude' in gpsPoint && typeof gpsPoint.altitude === 'number'
        ? gpsPoint.altitude
        : 0;
    const nue = calcRelativeCoordsInMeters(zero, gpsPoint, targetAlt, 0);
    // GPS-world NUE → AR-local: `alignment⁻¹ · nue`. Centralised in
    // `nueToArLocal` so the frame conversion has one tested home (see its
    // sidecar). Writes into the reused `scratchTarget` to avoid per-tick
    // allocation.
    nueToArLocal(currentAlignment, [nue[0], nue[1], nue[2]], scratchTarget);

    // Distance-scaled threshold: `scale = 1 + 10 × distanceFromCamera/100`.
    options.camera.getWorldPosition(scratchCamWorld);
    options.object3D.getWorldPosition(scratchObjWorld);
    const distFromCamera = scratchCamWorld.distanceTo(scratchObjWorld);
    const scale = 1 + (10 * distFromCamera) / 100;
    const posDelta = options.object3D.position.distanceTo(scratchTarget);

    // Commit gate: the distance-scaled threshold, the `snap-when-offscreen`
    // frustum suppression, and the large-jump bypass. When the gate accepts a
    // correction the object snaps instantly to the target. Smoothing is NOT
    // done per-anchor: alignment is lerped once at `arWorldGroup`
    // (`enableArWorldGroupAlignment`), so all anchored content shifts together
    // and each accepted commit here is only a small off-screen residual.
    if (posDelta >= distanceThreshold * scale) {
      const blockedByMode =
        mode === 'snap-when-offscreen' &&
        !largeJump &&
        isObjectInCameraFrustum(options.camera, options.object3D);
      if (!blockedByMode) {
        options.object3D.position.copy(scratchTarget);
      }
    }
  };

  const tick = (dt: number, elapsed: number): void => {
    if (phase === 'anchored') {
      maybeCommitSteadyState();
      return;
    }
    if (phaseEnteredAtElapsed === null) {
      phaseEnteredAtElapsed = elapsed;
      lastSampleAtElapsed = elapsed - 1; // allow a sample on the next tick if no settling
    }
    // Settling window: ignore samples until it elapses.
    if (elapsed - phaseEnteredAtElapsed < settlingSeconds) return;
    // Sample at most once per second.
    if (lastSampleAtElapsed !== null && elapsed - lastSampleAtElapsed < 1)
      return;
    const sample = options.getCurrentGpsPoint();
    if (sample === null || sample === undefined) return;
    samples.push(sample);
    lastSampleAtElapsed = elapsed;
    if (samples.length >= sampleCount) {
      commitMedian();
    }
  };

  const unregister = registerFrameUpdate(tick);

  return {
    get phase() {
      return phase;
    },
    get isFullyAnchored() {
      return isFullyAnchored;
    },
    get gpsPoint() {
      return gpsPoint;
    },
    markMovedExternally(): void {
      enterBootstrap();
    },
    setGpsPoint(point: LatLong | LatLongAlt): void {
      gpsPoint = point;
    },
    dispose(): void {
      unregister();
      anchoredObjects.delete(options.object3D);
    },
    __tickForTests(dt: number, elapsed: number): void {
      tick(dt, elapsed);
    },
  };
}
