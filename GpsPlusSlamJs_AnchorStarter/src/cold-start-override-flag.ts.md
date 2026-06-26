# `cold-start-override-flag.ts`

**Purpose:** Read the Stage-0 cold-start-override debug toggle from the page URL
(`?coldStartOverride=1`). A field tester can enable the experimental Phase-4
Stage-0 compass override without a rebuild; the value is passed to
`createSlamAppStore({ enableCompassColdStartOverride })`.

## Public API

- `coldStartOverrideEnabledFromSearch(search: string): boolean` — `true` only for
  `coldStartOverride=1` or `=true`; `false` for absent/empty/any other value.

## Invariants & assumptions

- Pure (no DOM access) — takes the search string so it is trivially unit-tested;
  `main.ts` passes `window.location.search`.
- Conservative: only the two explicit truthy spellings enable it, so the
  experimental override never turns on by accident.
- Default behaviour (no param) is OFF ⇒ the core alignment is unchanged. Keep it
  OFF while collecting field-calibration recordings (the override's thresholds
  are still field-untuned). See
  [`GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md`](../../../GpsPlusSlamJs_Docs/docs/2026-06-26-stage0-field-collection-and-enablement.md).

## Examples

```ts
store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
  enableCompassColdStartOverride: coldStartOverrideEnabledFromSearch(window.location.search),
});
```

## Tests

`cold-start-override-flag.test.ts` — accepts `=1`/`=true` (incl. alongside other
params); rejects absent/empty/`=0`/`=yes`.
