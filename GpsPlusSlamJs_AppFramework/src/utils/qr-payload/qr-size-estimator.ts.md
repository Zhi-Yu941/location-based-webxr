# qr-size-estimator.ts

## Purpose

Pure QR footprint estimator — the _metric_ of the QR payload-compression
benchmark (`gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-0611-qr-payload-compression-benchmark-plan.md`,
§3): given a payload string and an error-correction level, it computes the
QR bit-stream size after **optimal mode segmentation**, the minimum QR
version (1–25) that holds it, and the module width. Character count is the
wrong metric for QR payloads — numeric/alphanumeric/byte segments cost
10/3, 11/2 and 8 bits per character respectively, so a _longer_ uppercase
string can be _cheaper_ than a shorter mixed-case one. Besides the
benchmark, [qr-launch-url.ts](qr-launch-url.ts.md) uses it in production
to pick the sparsest launch-URL form by measurement.

## Public API

- `estimateQrSize(payload: string, ecLevel: 'L'|'M'|'Q'|'H') → { bits, version, modules } | null`
  - `bits` — bit-stream size after optimal segmentation (mode indicators +
    character-count indicators + data bits).
  - `version` — smallest version whose data capacity holds `bits`;
    `modules` = `17 + 4·version`.
  - Returns `null` when the payload exceeds the v25 capacity table **or**
    `ecLevel` is invalid. Never throws (total function).
- `QR_ALPHANUMERIC_CHARSET` — the 45-char alphanumeric-mode charset in spec
  value order (`0–9`, `A–Z`, ` $%*+-./:`). Note `? = & # _` and all
  lowercase are absent — a conventional query string always drops at least
  partially to byte mode.
- Types: `QrEcLevel`, `QrSizeEstimate`.

## Invariants & assumptions

- Segmentation is Nayuki's per-character dynamic programme in 1/6-bit units
  (fractional per-char costs stay exact integers; switching modes rounds up
  to whole bits and pays the 4-bit mode indicator + CCI header).
- CCI widths differ per version group (v1–9: 10/9/8 bits, v10–26: 12/11/16),
  so bit cost is computed per group and versions are searched group by group.
- Kanji mode and ECI headers are **not** modelled — the benchmark corpus is
  ASCII/UTF-8 and the `qrcode` oracle agrees without them.
- Non-ASCII characters cost their UTF-8 byte length in byte mode (astral
  code points = 1 `for…of` unit = 4 bytes).
- The capacity table (data codewords v1–25 × L/M/Q/H) was **derived from
  the `qrcode` package** and every boundary is re-verified by the oracle
  test on each run — do not edit an entry without the oracle passing.
- Empty payload → `{ bits: 0, version: 1, modules: 21 }` (no segments).

## Examples

```ts
estimateQrSize('HELLO WORLD', 'Q'); // { bits: 74, version: 1, modules: 21 }
estimateQrSize('https://ABC', 'L')?.bits; // 98 — optimal split is
// byte("https") + alnum("://ABC"): ':' and '/' are alphanumeric-eligible.
estimateQrSize('a'.repeat(1300), 'L'); // null — beyond v25
```

## Tests

- `qr-size-estimator.test.ts` — hand-derived spec values (ISO worked
  example, remainder handling, optimal splits, UTF-8 costs, overflow/EC
  guards) plus the **oracle boundary test**: for every (version 1–25, EC,
  mode) the longest fitting single-mode string and its +1-char overflow must
  make the `qrcode` package pick exactly the same version (decision D6:
  strict equality), and mixed-mode corpus-like strings must agree too.
- `qr-size-estimator.property.test.ts` — totality/shape on arbitrary
  strings, append-monotonicity of bits and version, EC-level version
  monotonicity.
