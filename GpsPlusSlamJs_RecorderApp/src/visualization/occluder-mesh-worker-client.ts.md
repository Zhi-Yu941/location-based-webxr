# occluder-mesh-worker-client.ts

## Purpose

App-side glue that builds the framework `OccluderMeshDriver` backed by the real `occlusion-mesher.worker` Web Worker. Creates the `Worker`, adapts it to the driver's `MeshWorkerPoster` seam, and degrades to the driver's **synchronous fallback** if a worker can't be constructed.

## Public API

- `createOccluderMeshWorker(createWorker?) → { driver, dispose }` — returns the driver plus a `dispose` that also `terminate()`s the worker. `createWorker` is injectable (default = the real module worker); tests pass a fake or a throwing factory.

## Invariants & assumptions

- **Graceful degradation:** if `createWorker()` throws (no worker support / test env), `poster = null` ⇒ the driver meshes synchronously — the occluder still works, just on-thread.
- **Wiring:** the recorder (`main.ts` live, `replay-mode.ts` replay) creates one per active occluder and, in the occupancy-grid `refresh`, calls `driver.request(grid.getOccupiedCells(minConf), cellSize, mode, grid.getCellPoint, (pos, idx) => occlusionMesh.applyMeshData(pos, idx))`. `getOccupiedCells` + `getCellPoint` stay main-thread (the grid lives there); only `meshOccupiedCells` runs off-thread. Disposed with the occluder.
- A worker `onerror` is logged (the in-flight job just gets no result; the next refresh retries).

## Tests

- `occluder-mesh-worker-client.test.ts` — a throwing factory → synchronous meshing matches a direct mesh; a fake worker → post → respond → callback, and `terminate()` on dispose.
