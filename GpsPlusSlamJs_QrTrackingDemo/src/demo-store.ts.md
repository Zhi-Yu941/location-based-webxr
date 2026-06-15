# demo-store.ts

**Purpose:** The demo's Redux store — `createSlamAppStore` with the opt-in
`qrDetected` slice wired via `extraReducers` (Note 3). Geo-less: the slice is
only observed (HUD + overlay); no GPS vote, nothing persisted
(`NullStorageBackend`).

## Public API

- `createQrDemoStore(): QrDemoStore` — the wired store.
- `QrDemoStore` — its type.

## Invariants

- The `qrDetected` reducer is the only extra slice; everything else is the
  framework default.

## Tests

`demo-store.test.ts` — the slice is present and a detection + size estimate
round-trips through `recordQrDetection` / `recordQrSizeEstimate` / selectors.
