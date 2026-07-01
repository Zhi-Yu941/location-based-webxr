# occluder-mesh-driver.ts

## Purpose

Main-thread orchestration for the occluder Web Worker offload — the glue between the occluder wiring and a worker running `runMeshRequest`. THREE-free + framework-owned; a consumer supplies a `Worker` adapter and applies the result (e.g. `OcclusionMesh.applyMeshData`).

## Public API

- `new OccluderMeshDriver(poster: MeshWorkerPoster | null)` — `null` ⇒ **synchronous fallback** (meshes inline, calls back immediately).
- `request(cells, cellSizeM, mode, getCellPoint, onMesh)` — pack + post a mesh job; `onMesh(positions, indices)` fires when it returns.
- `busy` — a job is in flight (worker path).
- `dispose()` — detach the worker handler, drop any pending job.
- `MeshWorkerPoster` — the minimal `Worker`-like surface (`postMessage(message, transfer)` + `onmessage`) the driver drives; `OnMesh` — the result callback.

## Invariants & assumptions

- **Coalesce to latest:** at most ONE job in flight. A `request` made while busy becomes the single `pending` job (newest wins); intermediates are dropped — so work never queues behind a growing grid. On response, the completed job's `onMesh` fires, then the pending job (if any) is posted.
- **Sync fallback delivers immediately** (no coalescing needed — each `request` completes before returning).
- **Post-dispose safety:** a response arriving after `dispose()` (or with a stale id) is ignored; no callback fires.
- The driver does not own the worker lifecycle — the consumer terminates the `Worker` (see the recorder's `occluder-mesh-worker-client.ts`).

## Tests

- `occluder-mesh-driver.test.ts` — sync fallback matches a direct mesh; posts + delivers on response; coalesces to the latest (drops intermediates); no delivery after dispose. Uses a fake poster (no worker env needed).
