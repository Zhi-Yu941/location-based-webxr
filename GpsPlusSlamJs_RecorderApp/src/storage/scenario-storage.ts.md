# scenario-storage.ts

## Purpose

Recorder-owned **scenario** layer for OPFS storage: a named bucket grouping
multiple recordings of the same place, laid out as
`gps-plus-slam/scenarios/{name}/recording-{ts}/…`. Carved out of the framework's
`storage/file-system.ts` in **Iter 7** of the [AppFramework ↔ RecorderApp
boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)
so the framework no longer owns any scenario concept. It composes the
framework's _generic_ OPFS primitives — the framework never imports from the
recorder.

## Public API

- `initStorage(): Promise<string[]>` — init OPFS, return existing scenario
  folder names. Throws if OPFS is unsupported.
- `startSession(scenarioName?): Promise<{ scenarioPath, sessionPath }>` — create
  `scenarios/{name}/recording-{ts}/{actions,images}` and bridge its handles into
  the framework writer. Omitting `scenarioName` falls back to the framework's
  flat `sessions/` layout. Throws if `initStorage()` was not called.
- `getCurrentScenarioHandle(): FileSystemDirectoryHandle | null` — sync accessor
  for the cached current-scenario handle.
- `setCurrentScenario(name): Promise<handle | null>` — select an existing
  scenario; `null` if absent.
- `ensureScenarioDirectory(name): Promise<handle | null>` — create-on-demand,
  used during OPFS recovery after a browser data clear. ⚠️ Like
  `setCurrentScenario`, it repoints the module-level current-scenario state as
  a side effect.
- `getScenarioDirectoryHandle(name, {create?}): Promise<handle | null>` —
  side-effect-free variant that does NOT repoint the current scenario. Used by
  the eager ref-point indexing pass, which writes into many scenarios while
  the user's selection must stay current (2026-07-05 folder-import plan §3.2).
  Returns `null` when storage is uninitialized, or when the scenario is absent
  and `create` was not requested.
- `clearRefPointsCacheForAllScenarios(): Promise<ClearRefPointsCacheResult>` —
  delete every scenario's `refPoints/` cache so the next load re-imports from
  read-folder ZIPs. Per-scenario failures collected in `errors`; a missing cache
  is **not** an error. **Throws** if OPFS is unavailable (silent zero-count would
  mask the failure from the UI).
- `resetForNewSession()` — clear session-level state, keep `initStorage()` init.
- `resetScenarioStorage()` — **test-only** full reset.
- `ScenarioWrappingStorageBackend implements StorageBackend` —
  `createSession(timestamp, contextTag)` treats `contextTag` as the scenario
  name (`scenarios/{contextTag}/recording-{ts}/`); `listSessions()` lists the
  current scenario's sessions; `writeAction`/`writeFrame`/`writeSessionMetadata`
  delegate to the framework writer.

## Invariants & assumptions

- **Scenario state is module-level, not per-backend-instance.** The recorder
  builds a fresh store + backend per recording, while the current scenario is
  selected on a _previous_ store during setup. Per-instance state would drop
  that selection (Issue #12), so all `ScenarioWrappingStorageBackend` instances
  share this module's state.
- Byte-level writes are NOT reimplemented: `startSession` /
  `createSession` call the framework's `opfs-storage.setSessionHandles(...)` so
  all action/frame/metadata persistence stays in one place.
- OPFS available (`navigator.storage.getDirectory`); JSON-serializable actions;
  JPEG-blob frames; 1-based file indexing.

## Layout

```
/gps-plus-slam/
  ├── sessions/                 (framework flat default — not used by recorder)
  └── scenarios/                (this module)
      └── {scenarioName}/
          └── recording-{ts}/
              ├── session.json
              ├── actions/000001.json …
              └── images/frame-000001.jpg …   (legacy: frames/)
```

## Tests

- `scenario-storage.test.ts` — round-trip proving the
  `scenarios/{name}/recording-{ts}/{actions,images}` layout, scenario discovery,
  selection, recovery, cache-clear, and the `ScenarioWrappingStorageBackend`
  action/frame/metadata round-trip. Uses the framework's `installOPFSMocks`.
- Mock-fidelity note: the OPFS mock's `removeEntry` resolves for missing entries,
  so the production `NotFoundError` "skip" branch in
  `clearRefPointsCacheForAllScenarios` is not exercised in unit tests.
