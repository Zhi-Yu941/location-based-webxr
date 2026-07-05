# utf8.ts

## Purpose

UTF-8 encode/decode helpers shared by the QR payload codecs (benchmark plan
§6 P3). One shared fatal `TextDecoder` instead of per-call construction.

## Public API

- `utf8Encode(text: string) → Uint8Array`
- `utf8DecodeTotal(bytes: Uint8Array) → string | null` — **total**: invalid
  sequences yield `null` (fatal decoder, exception swallowed), never a
  lossy U+FFFD substitution — a silently mangled payload is worse than a
  rejected one.

## Invariants & assumptions

- The shared `TextDecoder` is safe to reuse: non-streaming `decode()` calls
  keep no state between invocations.

## Examples

```ts
utf8DecodeTotal(utf8Encode('Zürich')); // 'Zürich'
utf8DecodeTotal(new Uint8Array([0xff])); // null
```

## Tests

Covered through the codec suites (`codec-compression.test.ts`,
`codec-dictionary.test.ts`, `codec-binary-anchor.test.ts`,
`codecs.property.test.ts`) — every decode-total property exercises both
paths.
