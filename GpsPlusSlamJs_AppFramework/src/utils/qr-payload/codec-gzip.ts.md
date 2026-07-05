# codec-gzip.ts

## Purpose

Benchmark codec **A3** (plan §4): gzip + base64url. Exists SOLELY to
quantify gzip's container overhead versus `deflate-raw` (hypothesis H5 —
gzip is deflate plus an ≥ 18-byte header/trailer, so it can never win).
Expected to be pruned in P5; nothing outside the benchmark may depend on it.

## Public API

- `encodeGzipPayload(payload: string) → Promise<string>`
- `decodeGzipPayload(text: string) → Promise<string | null>` — total.

## Invariants & assumptions

Mirror of [codec-deflate.ts](codec-deflate.ts.md) with `'gzip'` format —
see that sidecar and [compression.ts](compression.ts.md).

## Tests

`codec-compression.test.ts` and `codecs.property.test.ts` (same matrix as
A2, plus the strict `gzip.length > deflate.length` framing pin).
