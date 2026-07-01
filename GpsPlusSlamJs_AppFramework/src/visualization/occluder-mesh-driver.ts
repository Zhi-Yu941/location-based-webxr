/**
 * Occluder mesh driver — main-thread orchestration for the Web Worker offload.
 *
 * Drives {@link packMeshRequest} / {@link runMeshRequest} (see
 * `2026-07-01-occluder-worker-and-chunked-remesh-plan.md`): the occluder wiring
 * calls {@link OccluderMeshDriver.request} on each refresh with the occupied-cell
 * snapshot; the driver packs it, posts it to a worker, and invokes a callback
 * with the meshed geometry when it returns — so the expensive mesh runs
 * off-thread and never stalls the render.
 *
 * Policy (locked 2026-07-01):
 * - **Coalesce to latest** — at most one job in flight; a request made while busy
 *   is remembered (newest wins) and posted when the current one returns, so work
 *   never queues up behind a growing grid.
 * - **Synchronous fallback** — constructed with `poster = null` (no worker
 *   support), it meshes inline and calls back immediately (today's behaviour).
 *
 * Framework-owned + THREE-free: a consumer supplies a {@link MeshWorkerPoster}
 * adapting a real `Worker`, and applies the result (e.g. `OcclusionMesh.applyMeshData`).
 */

import {
  packMeshRequest,
  runMeshRequest,
  type MeshWorkerRequest,
  type MeshWorkerResponse,
} from '../ar/occlusion-mesh-worker.js';
import type { MeshMode } from '../ar/occupancy-mesher.js';
import type { GridCell } from '../ar/bresenham3d.js';
import type { Vector3 } from 'gps-plus-slam-js';

/** Called with the meshed geometry (typed arrays) when a job completes. */
export type OnMesh = (positions: Float32Array, indices: Uint32Array) => void;

/**
 * The minimal `Worker`-like surface the driver needs. A consumer adapts a real
 * `Worker`: `{ postMessage: (m, t) => worker.postMessage(m, t), onmessage: … }`.
 */
export interface MeshWorkerPoster {
  postMessage(message: MeshWorkerRequest, transfer: ArrayBufferLike[]): void;
  onmessage: ((event: { data: MeshWorkerResponse }) => void) | null;
}

interface Job {
  readonly cells: readonly GridCell[];
  readonly cellSizeM: number;
  readonly mode: MeshMode;
  readonly getCellPoint?: (cell: GridCell) => Vector3 | null;
  readonly onMesh: OnMesh;
}

export class OccluderMeshDriver {
  private readonly poster: MeshWorkerPoster | null;
  private nextId = 1;
  private inFlightId: number | null = null;
  private inFlightCallback: OnMesh | null = null;
  private pending: Job | null = null;
  private disposed = false;

  /** @param poster a worker adapter, or `null` for synchronous main-thread meshing. */
  constructor(poster: MeshWorkerPoster | null) {
    this.poster = poster;
    if (poster) {
      poster.onmessage = (event) => this.handleResponse(event.data);
    }
  }

  /** True while a mesh job is being computed (worker path only). */
  get busy(): boolean {
    return this.inFlightId !== null;
  }

  /**
   * Request a mesh of `cells`. If a job is already in flight, this becomes the
   * (single) pending job — the newest request wins; intermediates are dropped.
   */
  request(
    cells: readonly GridCell[],
    cellSizeM: number,
    mode: MeshMode,
    getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
    onMesh: OnMesh
  ): void {
    if (this.disposed) {
      return;
    }
    const job: Job = { cells, cellSizeM, mode, getCellPoint, onMesh };
    if (this.inFlightId !== null) {
      this.pending = job; // coalesce to latest
      return;
    }
    this.post(job);
  }

  private post(job: Job): void {
    const id = this.nextId++;
    this.inFlightId = id;
    this.inFlightCallback = job.onMesh;
    const { request, transfer } = packMeshRequest(
      id,
      job.cells,
      job.cellSizeM,
      job.mode,
      job.getCellPoint
    );
    if (this.poster) {
      this.poster.postMessage(request, transfer);
    } else {
      // Synchronous fallback: mesh inline and deliver immediately.
      const { response } = runMeshRequest(request);
      this.handleResponse(response);
    }
  }

  private handleResponse(response: MeshWorkerResponse): void {
    if (this.disposed || response.id !== this.inFlightId) {
      return; // stale (e.g. a response after dispose)
    }
    const callback = this.inFlightCallback;
    this.inFlightId = null;
    this.inFlightCallback = null;
    callback?.(response.positions, response.indices);
    // Post the coalesced latest, if one arrived while we were busy.
    if (!this.disposed && this.pending) {
      const next = this.pending;
      this.pending = null;
      this.post(next);
    }
  }

  /** Stop delivering results (detaches the worker handler; drops any pending). */
  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.inFlightCallback = null;
    this.inFlightId = null;
    if (this.poster) {
      this.poster.onmessage = null;
    }
  }
}
