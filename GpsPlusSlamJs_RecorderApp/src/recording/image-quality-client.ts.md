# `image-quality-client.ts`

- **Purpose:** main-thread client for the off-thread blur/blackness gate. Owns
  the init/ready handshake, id-correlated async `analyze` calls, and disposal —
  the shape the (removed) QR demo's `worker-pnp-client` had. The returned
  `analyze` is injected into the framework via `setImageQualityAnalyzer`, which
  forwards it to `ImageCaptureManager` as the `analyzeFrame` callback.

- **Public API:**
  - `WorkerLike` — the minimal `Worker` surface used (`postMessage`, `terminate`,
    `onmessage`, `onerror`), so a fake can be injected in tests.
  - `ImageQualityClient` — `{ analyze(frame): Promise<FrameQualityVerdict>, dispose() }`.
  - `createImageQualityClient(config, worker)` — transport-agnostic logic
    (unit-tested with a fake worker). Posts `init` on creation; queues `analyze`
    calls until the worker reports `ready`, then flushes them in order.
  - `createImageQualityAnalyzer(config)` — device seam: spawns the real
    Vite-bundled module worker (`new Worker(new URL('./image-quality.worker.ts',
import.meta.url), { type:'module' })`) and wraps it. NOT unit-tested.

- **Invariants & assumptions:**
  - **Fail-open everywhere.** A worker `error`/`messageerror`, or `dispose()`,
    resolves all pending (and future) verdicts as `{ accept:true, reason:'fail-open' }`
    so a flaky/torn-down worker can never lose a recording interval. The manager
    also has its own verdict safety timeout as a second backstop.
  - **Pre-ready queue.** `analyze` before `ready` is queued and flushed in order,
    so a verdict is never computed before the worker's gate is initialized.
    (Browsers also queue messages posted before a worker attaches its handler;
    the queue is the explicit, testable version of that guarantee.)
  - The client posts only the **encoded blob**, never pixels — all decode +
    analysis is off-thread.
  - Lifecycle is owned by `recording-session-handlers.ts`: created on
    `handleStartRecording` (only when `qualityFilter.enabled`), disposed on stop.

- **Tests:** `image-quality-client.test.ts` — init posted on creation; analyze
  queued-until-ready then flushed in order; verdict resolves the matching promise;
  immediate send once ready; fail-open on worker error; dispose terminates +
  fails open + short-circuits later calls; unknown-id verdict ignored.

- **Related docs:** `image-quality.worker.ts.md`, `image-quality-protocol.ts.md`,
  `recording-session-handlers.ts.md`,
  `GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md` (§3, §8).
