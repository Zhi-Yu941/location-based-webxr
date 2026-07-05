# compression.ts

## Purpose

Thin `CompressionStream`/`DecompressionStream` byte helpers shared by the
QR payload codecs ([codec-deflate.ts](codec-deflate.ts.md),
[codec-gzip.ts](codec-gzip.ts.md),
[codec-dictionary.ts](codec-dictionary.ts.md)) — benchmark plan §6 P3.

## Public API

- `compressBytes(bytes: Uint8Array, format: CompressionFormat) → Promise<Uint8Array>`
  — rejects only on programming errors (unknown format).
- `decompressBytes(bytes: Uint8Array, format: CompressionFormat) → Promise<Uint8Array | null>`
  — **total** over byte input: corrupt streams yield `null`, never a throw.

## Invariants & assumptions

- Runtime floor: browsers Safari 16.4 / Chrome 103 (for `deflate-raw`) /
  Firefox 113; Node ≥ 21.2 for `'deflate-raw'` — hence the package's
  `engines: >=22` (benchmark decision D3). Older-Safari fallback is an open
  P5 topic (plan §8).
- Implementation routes through `Blob → stream → Response` so the same code
  runs in browsers and Node without `node:zlib`.

## Examples

```ts
const packed = await compressBytes(
  new TextEncoder().encode('…'),
  'deflate-raw'
);
const bytes = await decompressBytes(packed, 'deflate-raw'); // Uint8Array
await decompressBytes(new Uint8Array([1, 2, 3]), 'deflate-raw'); // null
```

## Tests

Covered through the codec suites: `codec-compression.test.ts` (round-trips,
corrupt-stream nulls, H5 framing check) and `codecs.property.test.ts`.
