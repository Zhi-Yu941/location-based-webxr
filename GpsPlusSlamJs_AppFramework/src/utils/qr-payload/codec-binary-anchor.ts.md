# codec-binary-anchor.ts

## Purpose

Benchmark codec **A5** (plan §4): fixed binary layout for the
`?show=`-style anchor envelope (see the AnchorStarter's
`url-anchor-state.ts`) — the inline variant's "maximum effort" density
bound, built unconditionally per decision D8 so "inline loses" is actually
tested rather than assumed.

## Public API

- `encodeBinaryAnchorPayload(payload: string) → Promise<string>` — packs
  the envelope JSON; **throws `TypeError`** when the payload is not a valid
  envelope (boundary validation: JSON shape, 1–255 anchors, lat/lon range,
  |alt| ≤ 3276.7 m, name ≤ 255 UTF-8 bytes, ui u8 integer,
  s ∈ (0, 655.35], r finite).
- `decodeBinaryAnchorPayload(text: string) → Promise<string | null>` —
  TOTAL: malformed base64url, wrong version, truncation, trailing garbage,
  out-of-range coordinates or invalid UTF-8 names → `null`. Returns the
  **canonical re-serialisation** (short keys, key order lat/lon/alt/n/ui/s/r).

## Invariants & assumptions

- Wire v0x01, little-endian: `[version u8][count u8]`, per anchor
  `[flags u8][lat i32·1e7][lon i32·1e7][alt i16·10]` + optional
  `name(u8 len + UTF-8)`, `ui(u8)`, `s(u16·100)`, `r(u16·10, wrapped mod 360)`;
  flags bit0..3 = name/ui/s/r. Minimal anchor = 13 bytes.
- **Deliberately lossy**: 1e-7° (≈ 1.1 cm), 0.1 m alt, 0.01 scale, 0.1°
  rotation. Consequence: `decode(encode(x))` is canonical, and
  encode→decode→encode is idempotent (property-tested).
- Empty names are treated as absent (matches the `?show=` wire form).
- Like every wire version: v0x01's layout is frozen once printed; changes
  require a new version byte.

## Examples

```ts
await encodeBinaryAnchorPayload('{"a":[{"lat":47.3769,"lon":8.5417,"alt":2}]}');
// 18-char base64url string (13 bytes)
```

## Tests

`codec-binary-anchor.test.ts` (exact round-trip of quantisation-stable
values, optional fields, idempotence, 13-byte density pin, TypeError
boundary cases, decode-total cases) and `codecs.property.test.ts`
(tolerance-based round-trip over arbitrary envelopes, idempotence,
decode totality).
