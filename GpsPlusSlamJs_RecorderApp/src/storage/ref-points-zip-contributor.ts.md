# ref-points-zip-contributor.ts

## Purpose

Recorder-side `ZipExportContributor` that emits per-session ref-point
observations into the `refPoints/` subdir of an exported session ZIP.
Replaces the framework's previously hard-coded `streamSessionRefPointsToZip`
branch.

## Public API

- `createRefPointsZipContributor(scenarioHandle, sessionName): ZipExportContributor`
  - `scenarioHandle: FileSystemDirectoryHandle | null` — scenario dir owning
    `refPoints/`. `null` (flat-layout) yields a contributor that emits 0.
  - `sessionName: string` — only observations with `sessionId === sessionName`
    are kept; ref points with no surviving observations are skipped entirely.

## Invariants & assumptions

- Owns the `refPoints/` subdir of the ZIP. The framework prepends that prefix.
- Tolerates a missing `refPoints/` directory by returning 0.
- Per-file failures are logged and skipped (best-effort, matches framework
  legacy behavior).
- Reads each ref-point JSON in full; the recorder's ref-point files are small
  by design.

## Tests

- `ref-points-zip-contributor.test.ts` — covers:
  - includes observations of the current session
  - filters out observations from other sessions
  - excludes ref points with zero matching observations
  - works when `refPoints/` directory does not exist
  - emits 0 when `scenarioHandle` is null
  - preserves `id`, `name`, `createdAt` metadata

## Related docs

- `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md`
- `ref-point-loader.ts.md`
