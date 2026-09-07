# `scene/markers.ts` — scattered GPS sample rings, averaging connectors, fused pin

## Purpose

Builds the proof visuals of the fusion chapter (round-2 R5/R8): raw GPS
as **static, scattered amber sample rings** whose center offsets sum to
zero — so the average of the ring centers is exactly the group origin,
where the rock-solid red pin stands — plus **connector lines** from each
ring center to that average point. The spatial relationship IS the
product message ("average the scatter"); the chapter copy echoes the
colors via `.hl-raw` / `.hl-fused` spans in `index.html`.

## Public API

- `buildMarkerPair() → { raw, fused, connectors }` — groups named
  `MARKER_NODE.raw` / `MARKER_NODE.fused` / `MARKER_NODE.connectors`.
- `RING_OFFSETS` — the ring-center (x, z) offsets; scattered AND summing
  to exactly zero (test-pinned).
- `buildPin(name, role)` — classic map pin, tip on the ground (also used
  for the AR POI markers).
- `MARKER_NODE` — the names the story timeline uses.

## Invariants & assumptions

- **Nothing in this trio ever moves** — the stage puts all three groups
  on ONE anchor (on the path edge); the fusion chapter only reveals the
  connectors (scale) and pulses the pin (uniform scale). Test-pinned.
- **Disjoint palette roles** (`markerRaw` amber, glowing in dark theme vs
  `markerFused` brand red) — sharing a role would blur the contrast;
  test-pinned. Ring meshes are named `uncertainty-ring-<i>`.
- Connector bars: long axis = local +X, yawed from the ring offset toward
  the origin (orientation test-pinned).
- Groups sit on the ground (y = 0 at placement). Rings are **flat
  `RingGeometry` annuli** (round-4 V1: a flat-shaded torus tube rendered
  as "thin ring + thick ring" bands and its underside sank into the path
  slabs), thin band ≤ 0.1, placed ABOVE the path slab top (y > 0.12) and
  height-staggered a few cm against z-fighting; shadows off both ways so
  the band stays uniform. Test-pinned.

## Examples

```ts
const pair = buildMarkerPair();
pair.raw.position.copy(WORLD_ANCHORS.markerPair).add(new Vector3(-1, 0, 0));
pair.fused.position.copy(WORLD_ANCHORS.markerPair).add(new Vector3(1, 0, 0));
```

## Tests

`props.test.ts` — names, role presence, role disjointness, zero-sum
scatter, connector aim, and the flat-thin-ring-above-path pin (round-4
V1).
