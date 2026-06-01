# `url-anchor-state.ts`

Inline `?show=` URL-state codec — the single source of truth for the placed
anchor under decision **F1** (D1.1–D1.5). Replaces the deleted
`localStorage`-based `anchor-storage.ts`.

## Purpose

Encode/decode the persisted anchor(s) to and from the page URL so the link is
**shareable** across devices and people. The schema is intentionally minimal
and **multi-anchor-ready** even though the starter only ever places one anchor.

## Public API

- `encodeAnchorsToShowParam(anchors: readonly AnchorSpec[]): string` — returns
  the percent-escaped JSON value to place after `?show=`. Default-valued
  optional fields (`ui=1`, `s=1`, `r=0`, empty/absent name) are **omitted** to
  keep the link short.
- `decodeShowParam(raw: string | null | undefined): AnchorSpec[] | null` —
  **total** and tolerant. Returns `null` for any missing / malformed / empty /
  no-valid-anchor input (never throws). Accepts both the already-percent-decoded
  value (as `URLSearchParams.get` yields) and a still-escaped value.
- `AnchorSpec` — fully-resolved anchor (`lat`, `lon`, `alt`, optional `name`,
  plus always-present `ui`, `scale`, `rotationDeg`).
- `AnchorVisualization` (`1|2|3|4`), `ANCHOR_VISUALIZATIONS`,
  `DEFAULT_VISUALIZATION` (1), `DEFAULT_SCALE` (1), `DEFAULT_ROTATION_DEG` (0).

## Wire envelope

```jsonc
{
  "a": [
    {
      "lat": 47.37,
      "lon": 8.54,
      "alt": 12, // required
      "n": "Home", // optional name
      "ui": 3, // optional style 1..4 (default 1)
      "s": 2, // optional scale >0 (default 1)
      "r": 90,
    },
  ],
} // optional rotation° vs north 0..360 (default 0)
```

## Invariants & assumptions

- `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`, `alt` finite — anchors failing these
  are **dropped** (a single bad anchor never poisons valid neighbours; matches
  the recorder's per-mark filter precedent).
- `decode` applies the D1.1 defaults and normalises: unknown/invalid `ui` → 1,
  non-positive/non-finite `scale` → 1, `rotation` wrapped into `[0, 360)`.
- No version field (D1.5): forward-compat is purely additive — only ever add
  new optional keys, never repurpose or remove one.
- Round-trip: `decode(encode(specs))` deep-equals `specs` when `specs` are
  already resolved (rotation in range, scale > 0, ui in 1..4, name non-empty).

## Examples

```ts
const param = encodeAnchorsToShowParam([
  { lat: 47.37, lon: 8.54, alt: 12, ui: 1, scale: 1, rotationDeg: 0 },
]);
location.href = `${location.pathname}?show=${param}`;

const anchors = decodeShowParam(
  new URLSearchParams(location.search).get("show"),
);
// → [{ lat: 47.37, lon: 8.54, alt: 12, ui: 1, scale: 1, rotationDeg: 0 }] | null
```

## Tests

`url-anchor-state.test.ts` — robustness (null/malformed/empty → null),
validation & defaults (required alt, range-drop, ui/scale/rotation
normalisation, name handling, percent-escaped tolerance), compact-encoding
(short keys, default omission) and round-trip cases including multi-anchor.
