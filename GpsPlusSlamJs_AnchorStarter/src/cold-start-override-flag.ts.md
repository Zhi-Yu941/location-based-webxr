# `cold-start-override-flag.ts`

**Purpose:** Read the Stage-0 cold-start-override toggle from the page URL.
Stage 0 is a default-ON feature, so this defaults to enabled; a field tester can
opt OUT without a rebuild via `?coldStartOverride=0`. The value is passed to
`createSlamAppStore({ enableCompassColdStartOverride })`.

## Public API

- `coldStartOverrideEnabledFromSearch(search: string): boolean` — `true` by
  default (absent/empty/any non-opt-out value); `false` only for the explicit
  opt-out spellings `coldStartOverride=0` or `=false`.

## Invariants & assumptions

- Pure (no DOM access) — takes the search string so it is trivially unit-tested;
  `main.ts` passes `window.location.search`.
- Default behaviour (no param) is ON ⇒ matches the framework default (Stage 0 is
  a field-validated default-on feature). Pass `?coldStartOverride=0` to disable —
  e.g. when collecting §6a field-calibration recordings so the captured compass
  behaviour is unmodified. See
  [`GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md`](../../../GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md).

## Examples

```ts
store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
  enableCompassColdStartOverride: coldStartOverrideEnabledFromSearch(
    window.location.search,
  ),
});
```

## Tests

`cold-start-override-flag.test.ts` — defaults to `true` (absent/empty/`=1`/`=yes`,
incl. alongside other params); returns `false` only for the explicit opt-out
`=0`/`=false`.
