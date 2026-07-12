# `scene/markers.ts` — raw-GPS vs. fused-anchor proof markers

## Purpose

Builds the twin map-pin markers of the fusion chapter: the raw-GPS pin
that jitters meters around its spot and the fused anchor that sits
rock-solid. The visual contrast between them IS the product message
("GPS alone is wobbly → fusion fixes it").

## Public API

- `buildMarkerPair() → { raw: Group, fused: Group }` — pins named
  `MARKER_NODE.raw` (`"marker-raw"`) / `MARKER_NODE.fused`
  (`"marker-fused"`).
- `MARKER_NODE` — the names the story timeline uses (jitter the raw pin,
  keep the fused one still).

## Invariants & assumptions

- Identical geometry, **disjoint palette roles** (`markerRaw` gray/dim vs
  `markerFused` brand red, glowing in dark theme) — sharing a role would
  blur the contrast; test-pinned.
- Pins stand tip-on-ground: placing a marker means setting the group
  position at ground level (y = 0).

## Examples

```ts
const pair = buildMarkerPair();
pair.raw.position.copy(WORLD_ANCHORS.markerPair).add(new Vector3(-1, 0, 0));
pair.fused.position.copy(WORLD_ANCHORS.markerPair).add(new Vector3(1, 0, 0));
```

## Tests

`props.test.ts` — names, role presence, and role disjointness.
