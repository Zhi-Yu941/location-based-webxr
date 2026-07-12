# `scene/markers.ts` — raw-GPS uncertainty rings vs. fused-anchor pin

## Purpose

Builds the twin proof visuals of the fusion chapter: raw GPS as jittering
amber **uncertainty rings** (round-1 feedback replaced the unreadable gray
pin) and the fused anchor as a rock-solid red map pin. The contrast —
wandering fuzz vs. still pin — IS the product message ("GPS alone is
wobbly → fusion fixes it"); the chapter copy echoes both colors via
`.hl-raw` / `.hl-fused` spans in `index.html`.

## Public API

- `buildMarkerPair() → { raw: Group, fused: Group }` — groups named
  `MARKER_NODE.raw` (`"marker-raw"`, the ring stack) / `MARKER_NODE.fused`
  (`"marker-fused"`, the pin).
- `MARKER_NODE` — the names the story timeline uses (jitter the raw
  group, keep the fused one still).

## Invariants & assumptions

- **Disjoint palette roles** (`markerRaw` amber, glowing in dark theme vs
  `markerFused` brand red) — sharing a role would blur the contrast;
  test-pinned. Ring meshes are named `uncertainty-ring-<i>` (test-pinned).
- Both groups sit tip/rings-on-ground: placing one means setting the
  group position at ground level (y = 0); rings are height-staggered a
  few cm to avoid z-fighting with the ground.

## Examples

```ts
const pair = buildMarkerPair();
pair.raw.position.copy(WORLD_ANCHORS.markerPair).add(new Vector3(-1, 0, 0));
pair.fused.position.copy(WORLD_ANCHORS.markerPair).add(new Vector3(1, 0, 0));
```

## Tests

`props.test.ts` — names, role presence, and role disjointness.
