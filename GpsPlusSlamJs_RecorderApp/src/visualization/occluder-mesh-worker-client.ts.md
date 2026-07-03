# occluder-mesh-worker-client.ts

## Purpose

App-side glue that builds the framework `OccluderMeshDriver` backed by the real `occlusion-mesher.worker` Web Worker. Creates the `Worker`, adapts it to the driver's `MeshWorkerPoster` seam, and degrades to the driver's **synchronous fallback** if a worker can't be constructed.

## Public API

- `createOccluderMeshWorker(createWorker?) → { driver, dispose }` — returns the driver plus a `dispose` that also `terminate()`s the worker. `createWorker` is injectable (default = the real module worker); tests pass a fake or a throwing factory.

## Invariants & assumptions

- **Graceful degradation (construction):** if `createWorker()` throws (no worker support / test env), `poster = null` ⇒ the driver meshes synchronously — the occluder still works, just on-thread.
- **Graceful degradation (async load failure):** `worker.onerror` **and** `worker.onmessageerror` are forwarded to `poster.onerror` so the driver can recover. On the driver's `onWorkerUnusable` (a worker that errored before ever meshing — almost always a module load failure) this client **terminates** the dead worker; the driver has already switched to synchronous meshing. A worker error is logged via the driver's `onError`. Net: a broken worker degrades to on-thread meshing instead of freezing the occluder.
- **Freshness instrumentation:** the driver's `onMeshStats` is wired to a `log.debug` line per completed mesh (`Meshed <n> cells (<mode>) in <ms> ms [sync]?`) so the Phase-2 gate's on-device walk reads the occluder refresh latency off the log panel instead of estimating by feel (see `2026-07-01-occluder-worker-and-chunked-remesh-plan.md` §"Next step"). The settled-skip suppresses refreshes on an unchanged grid, so this only logs while new surface is being meshed.
- **Wiring:** the recorder (`main.ts` live, `replay-mode.ts` replay) creates one per active occluder and, in the occupancy-grid `refresh`, calls `driver.request(grid.getOccupiedCells(minConf), cellSize, mode, grid.getCellPoint, (pos, idx) => occlusionMesh.applyMeshData(pos, idx))`. `getOccupiedCells` + `getCellPoint` stay main-thread (the grid lives there); only `meshOccupiedCells` runs off-thread. Disposed with the occluder.

## Tests

- `occluder-mesh-worker-client.test.ts` — a throwing factory → synchronous meshing matches a direct mesh; a fake worker → post → respond → callback, and `terminate()` on dispose; a pre-mesh `worker.onerror` → worker terminated and the next request meshes synchronously; a completed mesh logs one `OccluderMeshWorker` entry with cell count, mode and duration (asserted via the logger ring buffer).
