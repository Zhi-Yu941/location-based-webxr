# `image-quality-protocol.ts`

- **Purpose:** the message shapes exchanged between the main thread and the
  image-quality Web Worker. A pure, dependency-light module (only a framework
  type import) so both the worker entry and the main-thread client share one
  definition and a test can build messages without importing the worker.

- **Public API (only the unions are exported):**
  - `WorkerInbound` = `init` (`{ type:'init', config }`, (re)initialize the gate +
    thresholds for a new recording) | `analyze` (`{ type:'analyze', id, blob }`,
    analyze one encoded JPEG; `id` correlates the reply).
  - `WorkerOutbound` = `ready` (`{ type:'ready' }`, gate initialized) | `verdict`
    (`{ type:'verdict', id, accept, reason }`, the verdict for a prior analyze).
  - The individual member interfaces are intentionally non-exported (consumers
    narrow on `type`; exporting them would be dead public surface knip flags).

- **Invariants & assumptions:**
  - `config` is the framework's `QualityFilterConfig` (deep-imported). `enabled`
    is irrelevant inside the worker (the worker is only spawned when the gate is
    on); the worker reads `blurRelativeThreshold` + `minMeanLuminance`. `maxWaitMs`
    is enforced by the manager, not the worker.
  - `id` is a per-client monotonic counter; the client matches verdicts to
    pending analyses by it.

- **Tests:** exercised indirectly via `image-quality-client.test.ts` (the client
  builds/consumes these messages against a fake worker).

- **Related docs:** `image-quality-client.ts.md`, `image-quality.worker.ts.md`,
  `GpsPlusSlamJs_Docs/docs/2026-06-24-image-quality-gate-plan.md`.
