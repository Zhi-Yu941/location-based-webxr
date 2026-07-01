/**
 * occluder-mesh-worker-client — the app-side glue that backs the driver with a
 * real Worker. Tested via an injectable worker factory: a throwing factory must
 * degrade to synchronous meshing (occluder still works), and a fake worker must
 * be driven (post → respond → callback) and terminated on dispose.
 */

import { describe, it, expect, vi } from 'vitest';
import { createOccluderMeshWorker } from './occluder-mesh-worker-client';
import { meshOccupiedCells } from 'gps-plus-slam-app-framework/ar/occupancy-mesher';
import {
  runMeshRequest,
  type MeshWorkerRequest,
} from 'gps-plus-slam-app-framework/ar/occlusion-mesh-worker';
import type { GridCell } from 'gps-plus-slam-app-framework/ar/bresenham3d';

const CELL = 0.15;
const CELLS: GridCell[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 0, 1],
  [1, 0, 1],
];

describe('createOccluderMeshWorker', () => {
  it('falls back to synchronous meshing when the worker cannot be created', () => {
    const { driver, dispose } = createOccluderMeshWorker(() => {
      throw new Error('no worker in this env');
    });
    let indices: Uint32Array | null = null;
    driver.request(CELLS, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(CELLS, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    dispose();
  });

  it('drives a real-ish worker: posts a request, applies the response, terminates on dispose', () => {
    const posted: MeshWorkerRequest[] = [];
    const fakeWorker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      postMessage: (message: MeshWorkerRequest): void => {
        posted.push(message);
      },
      terminate: vi.fn(),
    };
    const { driver, dispose } = createOccluderMeshWorker(
      () => fakeWorker as unknown as Worker
    );

    let done = 0;
    driver.request(CELLS, CELL, 'greedy', undefined, () => {
      done++;
    });
    expect(posted).toHaveLength(1);
    expect(done).toBe(0); // async — nothing delivered until the worker responds

    // Simulate the worker computing + posting back.
    const { response } = runMeshRequest(posted[0]!);
    fakeWorker.onmessage?.({ data: response });
    expect(done).toBe(1);

    dispose();
    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);
  });
});
