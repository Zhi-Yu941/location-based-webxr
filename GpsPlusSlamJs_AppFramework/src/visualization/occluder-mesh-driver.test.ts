/**
 * OccluderMeshDriver — coalescing + synchronous-fallback tests.
 *
 * The driver is the main-thread half of the Web Worker occluder offload. These
 * pin the two policies that make it safe under a growing grid: at most one job
 * in flight with the NEWEST request winning (intermediates dropped), and a
 * synchronous fallback when no worker is available. A fake poster stands in for
 * a real Worker so the seam is unit-tested without a worker environment.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OccluderMeshDriver,
  type MeshWorkerPoster,
} from './occluder-mesh-driver';
import {
  runMeshRequest,
  type MeshWorkerRequest,
} from '../ar/occlusion-mesh-worker';
import { meshOccupiedCells } from '../ar/occupancy-mesher';
import type { GridCell } from '../ar/bresenham3d';

const CELL = 0.15;

function box(n: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) cells.push([x, 0, z]);
  return cells;
}

/** A fake worker: records posted requests; `respond(i)` runs one and fires onmessage. */
function makeFakePoster() {
  const posted: MeshWorkerRequest[] = [];
  const poster: MeshWorkerPoster = {
    postMessage: vi.fn((message: MeshWorkerRequest) => {
      posted.push(message);
    }),
    onmessage: null,
  };
  const respond = (i: number): void => {
    const { response } = runMeshRequest(posted[i]!);
    poster.onmessage?.({ data: response });
  };
  return { poster, posted, respond };
}

describe('OccluderMeshDriver', () => {
  it('meshes synchronously (matching a direct mesh) when constructed without a worker', () => {
    const driver = new OccluderMeshDriver(null);
    const cells = box(4);
    let positions: Float32Array | null = null;
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (p, i) => {
      positions = p;
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(Array.from(positions!)).toEqual(Array.from(direct.positions));
  });

  it('posts to the worker and delivers the geometry on response', () => {
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const cells = box(3);
    const results: number[] = [];
    driver.request(cells, CELL, 'greedy', undefined, (_p, i) => {
      results.push(i.length);
    });
    expect(posted).toHaveLength(1); // posted, not yet delivered
    expect(driver.busy).toBe(true);
    expect(results).toEqual([]);

    respond(0);
    expect(results).toHaveLength(1);
    expect(driver.busy).toBe(false);
  });

  it('coalesces to the LATEST request while a job is in flight (drops intermediates)', () => {
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const done: string[] = [];
    driver.request(box(2), CELL, 'per-face', undefined, () => done.push('A'));
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('B'));
    driver.request(box(4), CELL, 'per-face', undefined, () => done.push('C'));

    // Only A is in flight; B and C coalesced (C is the survivor).
    expect(posted).toHaveLength(1);

    respond(0); // A completes → its callback fires, then C is posted
    expect(done).toEqual(['A']);
    expect(posted).toHaveLength(2);

    respond(1); // C completes; B was dropped
    expect(done).toEqual(['A', 'C']);
    expect(posted).toHaveLength(2);
  });

  it('delivers nothing after dispose()', () => {
    const { poster, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const onMesh = vi.fn();
    driver.request(box(3), CELL, 'per-face', undefined, onMesh);
    driver.dispose();
    respond(0);
    expect(onMesh).not.toHaveBeenCalled();
    expect(poster.onmessage).toBeNull();
  });
});
