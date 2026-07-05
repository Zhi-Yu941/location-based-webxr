# codec-deflate.ts

## Purpose

Benchmark codec **A2** (plan §4): `deflate-raw` over the UTF-8 payload,
transported as unpadded base64url. The generic-compression candidate;
hypothesis H1 predicts it loses on short pointer URLs (no redundancy to
exploit, header overhead, +33 % base64url re-encoding) and only wins once
the inline JSON grows to a few hundred bytes.

## Public API

- `encodeDeflatePayload(payload: string) → Promise<string>` — may reject
  only on environment errors (missing `CompressionStream`).
- `decodeDeflatePayload(text: string) → Promise<string | null>` — total:
  malformed base64url, deflate stream or UTF-8 → `null`, never a throw.

## Invariants & assumptions

- `deflate-raw` (no container) per hypothesis H5 — gzip framing is measured
  separately in [codec-gzip.ts](codec-gzip.ts.md).
- Async signature by convention for ALL benchmark codecs (plan §6 P3), so
  the benchmark treats candidates uniformly.
- Runtime floor documented in [compression.ts](compression.ts.md).

## Examples

```ts
const wire = await encodeDeflatePayload('{"a":[…]}');
await decodeDeflatePayload(wire); // '{"a":[…]}'
await decodeDeflatePayload('AAAA'); // null (not a deflate stream)
```

## Tests

`codec-compression.test.ts` (round-trips, URL-safety, corrupt-input nulls,
gzip-vs-deflate framing) and `codecs.property.test.ts` (arbitrary-string
round-trip, decode totality).
